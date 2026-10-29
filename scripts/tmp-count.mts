import { prisma } from '../src/lib/prisma'

const tenants = await prisma.tenant.count()
const leases = await prisma.lease.count()
const pays = await prisma.payment.count()
const bills = await prisma.gatewayBill.count()
console.log({ tenants, leases, pays, bills })
await prisma.$disconnect()
