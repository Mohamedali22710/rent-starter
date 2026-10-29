/**
 * "Amount due now" (brief section 5), shared by the gateway-bills endpoint
 * and the tenant portal UI: the unpaid amounts of the lease's invoices due on
 * or before today's Malaysia date.
 */
export interface DueNowInvoice {
  dueDate: string
  amountSen: number
  paidSen: number
}

export function dueNowSen(invoices: DueNowInvoice[], todayMy: string): number {
  return invoices
    .filter((i) => i.dueDate <= todayMy)
    .map((i) => i.amountSen - i.paidSen)
    .filter((unpaid) => unpaid > 0)
    .reduce((sum, unpaid) => sum + unpaid, 0)
}
