select i.kind, i.period_index, i.due_date, i.amount_sen,
       coalesce((select sum(a.amount_sen) from payment_allocations a where a.invoice_id = i.id),0) as paid
from invoices i join leases l on l.id = i.lease_id
join units u on u.id = l.unit_id
where u.name = 'A-12-3' order by i.due_date, i.kind desc, i.period_index;