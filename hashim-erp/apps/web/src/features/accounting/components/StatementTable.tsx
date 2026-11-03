import clsx from 'clsx'
import { fmtMoney } from '@/lib/formatters'

export type StmtRow = { label: string; value?: number; kind?: 'head' | 'item' | 'sub' | 'total'; indent?: number }

/** جدول قائمة مالية: عناوين، بنود، مجاميع */
export function StatementTable({ rows }: { rows: StmtRow[] }) {
  return (
    <div className="card mx-auto max-w-2xl divide-y divide-cream-200">
      {rows.map((r, i) => (
        <div key={i} style={{ paddingInlineStart: 20 + (r.indent ?? 0) * 18 }}
          className={clsx('flex items-center justify-between py-2.5 pe-5 text-sm',
            r.kind === 'head' && 'bg-cream-100 font-bold text-brand-800', r.kind === 'sub' && 'bg-cream-50 font-bold',
            r.kind === 'total' && 'bg-brand-50 text-base font-bold')}>
          <span>{r.label}</span>
          {r.value !== undefined && <span dir="ltr" className={clsx(r.value < 0 && 'text-red-600', r.kind === 'total' && r.value > 0 && 'text-emerald-700')}>{fmtMoney(r.value)}</span>}
        </div>
      ))}
    </div>
  )
}
