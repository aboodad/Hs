import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Spinner } from '@/components/ui/Spinner'

export interface Column<T> {
  key: string
  header: string
  render?: (row: T) => ReactNode
  className?: string
}

export function DataTable<T extends { id?: string | number }>({
  columns, rows, loading, onRowClick, empty = 'لا توجد بيانات', rowKey,
}: {
  columns: Column<T>[]; rows: T[] | undefined; loading?: boolean
  onRowClick?: (row: T) => void; empty?: string; rowKey?: (row: T, i: number) => string | number
}) {
  if (loading) return <div className="card"><Spinner /></div>
  return (
    <div className="card fade-up overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gradient-to-b from-cream-200 to-cream-100 text-xs text-brand-700">
          <tr>{columns.map((c) => <th key={c.key} className={clsx('whitespace-nowrap px-4 py-3 text-start font-bold', c.className)}>{c.header}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-cream-200">
          {(rows ?? []).map((r, i) => (
            <tr key={rowKey ? rowKey(r, i) : (r.id ?? i)} onClick={() => onRowClick?.(r)}
                className={clsx('transition-colors', onRowClick ? 'cursor-pointer hover:bg-gold-50' : 'hover:bg-cream-50')}>
              {columns.map((c) => (
                <td key={c.key} className={clsx('px-4 py-3 align-middle', c.className)}>
                  {c.render ? c.render(r) : String((r as any)[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
          {!rows?.length && <tr><td colSpan={columns.length} className="p-14 text-center"><div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-cream-200 text-xl text-brand-300">∅</div><div className="text-sm text-brand-300">{empty}</div></td></tr>}
        </tbody>
      </table>
    </div>
  )
}
