-- =============================================================================
-- 0001: rent collection schema (doc/brief.md section 8), grants, RLS, storage
--
-- Plain SQL is the source of truth for the schema.
-- Prisma only introspects it (`prisma db pull`); never add `prisma migrate`.
--
-- Money is integer sen (bigint). Calendar dates are `date`; instants are
-- `timestamptz`. Business timezone is Asia/Kuala_Lumpur; towers store UTC.
--
-- Access rules (brief section 6):
--   * anon: nothing. No INSERT/UPDATE/DELETE grants at all for anyone.
--   * authenticated tenants: read rows of their own leases; update own phone.
--   * authenticated staff/managers: read everything of their own organization.
--   * audit_log: managers only; append-only for every role.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------
create extension if not exists btree_gist; -- exclusion constraint on uuid + daterange

-- -----------------------------------------------------------------------------
-- Private helper schema. Deliberately NOT exposed to PostgREST: it only
-- carries SECURITY DEFINER helpers used by RLS policies, which grant EXECUTE
-- on the specific functions to the exact roles that need them.
-- =============================================================================
create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Tables (section 8)
-- =============================================================================

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  role text not null check (role in ('manager', 'staff')),
  created_at timestamptz not null default now(),
  -- A staff member or manager belongs to exactly one organization.
  unique (user_id)
);

create table public.units (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  full_name text not null,
  email text not null,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.gateway_bills (
  id uuid primary key default gen_random_uuid(), -- unguessable; this IS the bill id
  org_id uuid not null references public.organizations (id) on delete cascade,
  lease_id uuid not null, -- references leases (declared below)
  amount_sen bigint not null check (amount_sen > 0),
  status text not null check (status in ('pending', 'paid', 'failed')),
  created_at timestamptz not null default now()
);

create table public.leases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  unit_id uuid not null references public.units (id),
  tenant_id uuid not null references public.tenants (id),
  start_date date not null,
  end_date date not null,
  monthly_rent_sen bigint not null check (monthly_rent_sen > 0),
  deposit_sen bigint not null default 0 check (deposit_sen >= 0),
  created_at timestamptz not null default now(),
  check (end_date >= start_date),
  -- Leases on the same unit never overlap (both dates inclusive).
  constraint leases_no_unit_overlap
    exclude using gist (
      unit_id with =,
      daterange(start_date, end_date, '[]') with &&
    )
);

alter table public.gateway_bills
  add constraint gateway_bills_lease_fk foreign key (lease_id) references public.leases (id) on delete cascade;

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  lease_id uuid not null references public.leases (id) on delete cascade,
  kind text not null check (kind in ('deposit', 'rent')),
  period_index integer, -- null for the deposit
  period_start date,    -- null for the deposit
  period_end date,      -- null for the deposit
  due_date date not null,
  amount_sen bigint not null check (amount_sen > 0),
  created_at timestamptz not null default now(),
  check ((kind = 'rent' and period_index is not null and period_start is not null and period_end is not null)
      or (kind = 'deposit' and period_index is null and period_start is null and period_end is null))
);

-- One deposit and one rent invoice per period index, per lease.
create unique index invoices_one_deposit_per_lease
  on public.invoices (lease_id) where kind = 'deposit';
create unique index invoices_one_rent_per_period
  on public.invoices (lease_id, period_index) where kind = 'rent';

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  lease_id uuid not null references public.leases (id) on delete cascade,
  amount_sen bigint not null check (amount_sen > 0),
  unapplied_sen bigint not null default 0 check (unapplied_sen >= 0),
  method text not null check (method in ('cash', 'bank_transfer', 'online')),
  status text not null check (status in ('pending_verification', 'approved', 'rejected', 'voided')),
  received_at timestamptz not null,
  slip_path text,          -- Payment file in the private payment-slips bucket, org folder first
  gateway_bill_id uuid references public.gateway_bills (id) on delete set null, -- set only by the webhook
  rejected_reason text,    -- manager-provided reason for rejection/void
  voided_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  -- A bill settles at most once, ever (webhook idempotency, brief section 5).
  unique (gateway_bill_id)
);

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  payment_id uuid not null references public.payments (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  amount_sen bigint not null check (amount_sen > 0),
  created_at timestamptz not null default now(),
  unique (payment_id, invoice_id)
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  actor_id uuid, -- auth.users id, null for system (webhook) actions
  action text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Indexes
-- =============================================================================
create index memberships_org_idx on public.memberships (org_id);
create index units_org_idx on public.units (org_id);
create index tenants_org_idx on public.tenants (org_id);
create index tenants_user_idx on public.tenants (user_id);
create index leases_org_idx on public.leases (org_id);
create index leases_unit_idx on public.leases (unit_id);
create index invoices_lease_idx on public.invoices (lease_id);
create index invoices_org_idx on public.invoices (org_id);
create index invoices_due_idx on public.invoices (due_date);
create index payments_lease_idx on public.payments (lease_id);
create index payments_org_idx on public.payments (org_id);
create index allocations_payment_idx on public.payment_allocations (payment_id);
create index allocations_invoice_idx on public.payment_allocations (invoice_id);
create index gateway_bills_lease_idx on public.gateway_bills (lease_id);
create index audit_log_org_created_idx on public.audit_log (org_id, created_at desc);

-- -----------------------------------------------------------------------------
-- audit_log is append-only for EVERY role (including service role and the
-- database owner): triggers raise on UPDATE, DELETE and TRUNCATE.
-- =============================================================================

create function private.protect_audit_log()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only: % is not allowed', tg_op;
end;
$$;

create trigger audit_log_no_update
  before update on public.audit_log
  for each row execute function private.protect_audit_log();

create trigger audit_log_no_delete
  before delete on public.audit_log
  for each row execute function private.protect_audit_log();

create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for statement execute function private.protect_audit_log();

-- -----------------------------------------------------------------------------
-- updated_at hygiene for tenants (the only row users may update)
-- =============================================================================
create function private.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tenants_set_updated_at
  before update on public.tenants
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row-level-security helpers (SECURITY DEFINER, in the non-exposed `private`
-- schema). Everything is fully qualified because the search_path is emptied.
-- =============================================================================

-- The caller's organization: from memberships (staff/manager) or tenants.
create function private.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select m.org_id from public.memberships m where m.user_id = auth.uid() limit 1),
    (select t.org_id from public.tenants t where t.user_id = auth.uid() limit 1)
  )
$$;

-- The caller's organization when they are staff/manager; null otherwise.
create function private.staff_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.org_id from public.memberships m where m.user_id = auth.uid() limit 1
$$;

-- True when the caller is a manager of the given organization.
create function private.is_org_manager(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.org_id = p_org_id
      and m.role = 'manager'
  )
$$;

-- True when the caller (a tenant) owns the given lease.
create function private.tenant_owns_lease(p_lease_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.leases l
    where l.id = p_lease_id
      and exists (
        select 1 from public.tenants t
        where t.id = l.tenant_id
          and t.user_id = auth.uid()
      )
  )
$$;

-- True when the caller is staff/manager of the organization that owns the
-- upload folder (first path segment of the object name).
create function private.owns_slip_folder(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.role in ('manager', 'staff')
      and m.org_id::text = (storage.foldername(p_object_name))[1]
  )
$$;

-- -----------------------------------------------------------------------------
-- Lock down everything first: no implicit access for anon or authenticated.
-- (Some Supabase templates grant ALL on public tables by default.)
-- =============================================================================
revoke all on all tables in schema public from anon, authenticated, public;
revoke all on all sequences in schema public from anon, authenticated, public;
revoke all on all functions in schema public from anon, authenticated, public;
revoke all on all functions in schema private from anon, authenticated, public;

alter default privileges in schema public revoke all on tables from anon, authenticated, public;
alter default privileges in schema public revoke all on sequences from anon, authenticated, public;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;

-- -----------------------------------------------------------------------------
-- Row Level Security: enabled on EVERY table. Only SELECT policies are
-- created, so no insert/update/delete can ever pass the Data API; the
-- tenant phone column is the only granted UPDATE.
-- =============================================================================
alter table public.organizations        enable row level security;
alter table public.memberships          enable row level security;
alter table public.units                enable row level security;
alter table public.tenants              enable row level security;
alter table public.leases               enable row level security;
alter table public.invoices             enable row level security;
alter table public.payments             enable row level security;
alter table public.payment_allocations  enable row level security;
alter table public.gateway_bills        enable row level security;
alter table public.audit_log            enable row level security;

-- organizations: read own organization (staff, manager and tenants).
create policy organizations_select on public.organizations
  for select to authenticated
  using (id = private.current_org_id());

-- memberships: read own organization (staff/manager only; tenants have no membership row,
-- but do not even reveal org-shaped rows to them through this table).
create policy memberships_select on public.memberships
  for select to authenticated
  using (org_id = private.staff_org_id());

-- units: staff/manager read own organization; tenants read units of own leases.
create policy units_select on public.units
  for select to authenticated
  using (
    org_id = private.staff_org_id()
    or exists (
      select 1 from public.leases l
      where l.unit_id = units.id
        and private.tenant_owns_lease(l.id)
    )
  );

-- tenants: read own row, or own organization (staff/manager).
create policy tenants_select on public.tenants
  for select to authenticated
  using (user_id = auth.uid() or org_id = private.staff_org_id());

-- tenants: a tenant may update ONLY their own row. The role's column grant
-- (UPDATE (phone)) makes it a phone-only update at the privilege level.
create policy tenants_update_own on public.tenants
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- leases / invoices / payments / gateway_bills: read own organization, or the
-- tenant's own leases.
create policy leases_select on public.leases
  for select to authenticated
  using (org_id = private.staff_org_id() or private.tenant_owns_lease(id));

create policy invoices_select on public.invoices
  for select to authenticated
  using (org_id = private.staff_org_id() or private.tenant_owns_lease(lease_id));

create policy payments_select on public.payments
  for select to authenticated
  using (org_id = private.staff_org_id() or private.tenant_owns_lease(lease_id));

create policy gateway_bills_select on public.gateway_bills
  for select to authenticated
  using (org_id = private.staff_org_id() or private.tenant_owns_lease(lease_id));

-- payment_allocations inherit access from the payment (the policy subquery is
-- itself RLS-filtered through payments_select, which is same-role and cheap).
create policy payment_allocations_select on public.payment_allocations
  for select to authenticated
  using (
    org_id = private.staff_org_id()
    or exists (
      select 1 from public.payments p
      where p.id = payment_allocations.payment_id
    )
  );

-- audit_log: managers of the organization only.
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (private.is_org_manager(org_id));

-- -----------------------------------------------------------------------------
-- Minimal grants (brief section 6 table). Everything else stays revoked.
-- =============================================================================
grant select on public.organizations       to authenticated;
grant select on public.memberships         to authenticated;
grant select on public.units               to authenticated;
grant select, update (phone) on public.tenants to authenticated;
grant select on public.leases              to authenticated;
grant select on public.invoices            to authenticated;
grant select on public.payments            to authenticated;
grant select on public.payment_allocations to authenticated;
grant select on public.gateway_bills       to authenticated;
grant select on public.audit_log           to authenticated; -- RLS shows managers only

-- EXECUTE on the RLS helper functions: only the roles whose policies need them.
grant execute on function private.current_org_id() to authenticated;
grant execute on function private.staff_org_id() to authenticated;
grant execute on function private.is_org_manager(uuid) to authenticated;
grant execute on function private.tenant_owns_lease(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Storage: private payment-slips bucket, 5 MB, JPEG/PNG/PDF (brief section 6)
-- Slips live under <org_id>/... Only staff/managers of that organization may
-- upload, read (for signed URLs) or manage them. Tenants, other orgs and
-- anonymous callers get nothing.
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-slips',
  'payment-slips',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'application/pdf']
)
on conflict (id) do update
  set public = false,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'application/pdf'];

create policy payment_slips_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'payment-slips'
    and private.owns_slip_folder(name)
  );

create policy payment_slips_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'payment-slips'
    and private.owns_slip_folder(name)
  );

create policy payment_slips_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'payment-slips'
    and private.owns_slip_folder(name)
  )
  with check (
    bucket_id = 'payment-slips'
    and private.owns_slip_folder(name)
  );

create policy payment_slips_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'payment-slips'
    and private.owns_slip_folder(name)
  );

commit;
