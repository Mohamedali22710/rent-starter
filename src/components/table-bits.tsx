import { humanizeStatus } from '@/lib/format'

const STATUS_STYLES: Record<string, string> = {
  paid: 'bg-green-100 text-green-800',
  approved: 'bg-green-100 text-green-800',
  partially_paid: 'bg-amber-100 text-amber-800',
  unpaid: 'bg-zinc-100 text-zinc-700',
  overdue: 'bg-red-100 text-red-800',
  pending_verification: 'bg-amber-100 text-amber-800',
  rejected: 'bg-red-100 text-red-800',
  voided: 'bg-zinc-200 text-zinc-700',
  pending: 'bg-amber-100 text-amber-800',
  failed: 'bg-red-100 text-red-800',
}

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? 'bg-zinc-100 text-zinc-700'
  return (
    <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${style}`}>
      {humanizeStatus(status)}
    </span>
  )
}

export function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left text-xs font-medium text-muted-foreground ${className}`}>{children}</th>
}

export function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 align-middle ${className}`}>{children}</td>
}

export function DataTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  )
}
