import { PrismaClient } from '@prisma/client'

// A single PrismaClient per server process, stored on globalThis in dev so
// hot reloads do not open a new pool per request.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Prisma connects to Postgres as the database owner (superuser), so it
    // bypasses RLS: every query in this app enforces org + role itself.
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
