# Code review: late-fees and webhook PR

Line numbers refer to the PR snippet as given in the brief. Ordered from most to least severe.

## 1. Critical: role taken from `user_metadata` (late-fees route, L309)
`user_metadata` is editable by the user (`supabase.auth.updateUser({ data: { role: 'manager' } })`).
Any logged-in tenant can make themselves "manager" and add fees to invoices.
Fix: read the role from the `memberships` table by `user.id`, never from user-editable data.

## 2. Critical: no organization check, so cross-org access (late-fees, L314-318)
The lease is loaded by id only, and Prisma bypasses RLS. A manager of Beta Realty can add late fees to a Northwind lease.
Fix: load the lease with `where: { id: leaseId, orgId: caller.orgId }` and return 404 when not found,
so the existence of other organizations' records is not revealed.

## 3. Critical: webhook race creates two payments (webhook, L371-389)
The "already paid" check (L373) is a plain read outside the transaction. Two concurrent deliveries both see `pending`,
both enter the transaction, and L376 updates unconditionally, so two approved payments are created and the tenant is credited twice.
Fix: inside the transaction run `UPDATE gateway_bills SET status='paid' WHERE id=$1 AND status<>'paid'`
and only create the payment when one row was updated. Back it with `UNIQUE(gateway_bill_id)` on `payments`.

## 4. Critical: unauthenticated `getCollections` leaks any organization's data (actions, L394-406)
A `'use server'` export is a public POST endpoint. `orgId` comes from the client and there is no authentication,
so anyone can read any organization's collections.
Fix: authenticate with `getUser()`, derive the org from `memberships`, require staff or manager, and do not accept `orgId` as a parameter.

## 5. High: signature and payload logged (webhook, L366)
`console.error` prints the whole callback and the `expected` signature. Logs now contain a valid signature for that payload
(replayable or forgeable by anyone with log access), and the brief forbids logging callback payloads.
Fix: log only a generic message and the bill id, never the fields or the signature.

## 6. High: collections month uses the database timezone (actions, L400, L403)
`date_trunc('month', received_at)` and the range bounds use the session timezone (UTC). A payment received 2026-03-01 00:30 Malaysia time
(2026-02-28 16:30 UTC) is counted in February.
Fix: group by `received_at AT TIME ZONE 'Asia/Kuala_Lumpur'` and build the bounds as
`(from || '-01')::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur'`.

## 7. High: months without payments are missing (actions, L399-406)
The query only returns months that have rows. The report must contain one entry per month, with `collectedSen: 0` for empty ones.
Fix: generate the month series (e.g. `generate_series`) and left join, or fill gaps in code.

## 8. High: late-fee references are duplicated (late-fees, L337, L346-349)
Prisma queries are lazy: `prisma.invoice.create(...)` runs only when awaited in `Promise.all` (L342), but `await nextReference()` (L337)
runs inside the loop before any create has executed. Every fee in one request therefore gets the same reference.
Concurrent requests race the same way.
Fix: use a per-organization sequence or a `UNIQUE(org_id, reference)` constraint with a locked counter row,
and create the fees inside one transaction.

## 9. High: late fees are not idempotent or atomic (late-fees, L324-343)
Calling the endpoint twice charges the tenant twice (no check for an existing fee for that invoice).
`Promise.all` outside a transaction can also leave only some fees created if one insert fails.
Fix: lock the lease (`SELECT ... FOR UPDATE`), skip invoices that already have a fee, and use one `$transaction`.

## 10. High: webhook does not validate `paid_amount` and trusts raw input (webhook, L383)
The brief requires 422 when `paid=true` and `paid_amount` differs from the bill amount. Here any amount is credited.
`BigInt(fields.paid_amount)` also throws on non-numeric input, which returns a 500.
Fix: parse strictly, compare with `bill.amountSen`, return 422 on mismatch.

## 11. Medium: payment `received_at` uses server time (webhook, L384)
The payment should use the gateway's `paid_at`. A delayed or retried callback would land in the wrong collections month.
Fix: parse `paid_at` (`YYYY-MM-DD HH:mm:ss +0800`) into an instant.

## 12. Medium: failed payments are never recorded (webhook, L369)
`paid=false` returns 200 and changes nothing. A pending bill must become `failed`, and a paid bill must stay paid.
The early return also happens before the bill lookup, so an unknown bill gets 200 instead of 404.
Fix: look up the bill first (404), then apply the state table: pending to failed, paid stays paid.

## 13. Medium: signature compare is not constant time (webhook, L365)
`!==` on strings can leak the signature through timing differences. A missing `x_signature` also compares against `undefined`.
Fix: compare equal-length buffers with `crypto.timingSafeEqual` and return 401 when the field is missing.

## 14. Medium: arbitrary 0.5% tolerance and float math on money (late-fees, L327-328)
`paid / amount >= 0.995` treats an invoice that is still 0.5% unpaid as paid (RM 7.50 on RM 1,500), and `Number()` plus `Math.round` is float arithmetic on money.
Fix: skip only when `paid >= amount`, and compute the fee in integer sen with explicit half-up rounding.

## 15. Medium: 403 instead of 401, no audit log (late-fees, L308-311)
A missing login (`user` is null) should return 401, not 403. Creating fees also writes no `audit_log` row, which the brief requires for state changes.

## 16. Medium: `late_fee` is not an allowed invoice kind (late-fees, L334)
The brief defines `deposit | rent`. A new kind breaks the schedule, status and allocation assumptions, and the CHECK constraint if present.

## Looks suspicious but is correct
- `todayMyt` (L320) is correct: UTC now plus 8 hours gives the Malaysia calendar date, independent of the server timezone.
- `invoice.dueDate >= cutoff` (L325) is correct for "more than 7 days after due": an invoice due exactly 7 days ago is not yet charged,
  and `Date.parse('YYYY-MM-DD')` and the `date` column are both UTC midnight, so the comparison is consistent.