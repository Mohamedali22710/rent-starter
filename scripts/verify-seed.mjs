import { prisma } from '../src/lib/prisma'

const allocations = await prisma.paymentAllocation.findMany({
  include: { invoice: true, payment: true },
})
console.log(
  JSON.stringify(
    allocations.map((x) => ({
      paymentMethod: x.payment.method,
      invoice: `${x.invoice.kind} period ${x.invoice.periodIndex ?? '-'}`,
      amountSen: x.amountSen.toString(),
    })),
    null,
    1,
  ),
)
const payments = await prisma.payment.findMany({
  select: { method: true, status: true, amountSen: true, unappliedSen: true, receivedAt: true },
})
console.log(payments)
console.log('gateway bills:', await prisma.gatewayBill.count())
console.log('audit rows:', await prisma.auditLog.count())
process.exit(0)
