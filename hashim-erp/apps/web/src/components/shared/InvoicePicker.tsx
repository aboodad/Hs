import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { fmtDate, fmtMoney } from '@/lib/formatters'

interface Row { id: string; invoice_no: string; invoice_date: string; total: number; party: string | null }

/** اختيار فاتورة (بيع أو شراء): بحث بالرقم/الاسم وتحته قائمة بآخر الفواتير */
export function InvoicePicker({ kind, onPick, maxHeight = 'max-h-56' }: {
  kind: 'sales' | 'purchase'; onPick: (invoiceNo: string) => void; maxHeight?: string
}) {
  const [q, setQ] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['invoice-picker', kind],
    staleTime: 30_000,
    queryFn: async (): Promise<Row[]> => {
      if (kind === 'sales') {
        const { data, error } = await supabase.from('sales_invoices')
          .select('id,invoice_no,invoice_date,total,customer:customers(name)')
          .neq('status', 'cancelled').order('invoice_date', { ascending: false }).limit(300)
        if (error) throw error
        return (data ?? []).map((r: any) => ({ id: r.id, invoice_no: r.invoice_no, invoice_date: r.invoice_date, total: r.total, party: r.customer?.name ?? 'نقدي' }))
      }
      const { data, error } = await supabase.from('purchase_invoices')
        .select('id,invoice_no,invoice_date,total,supplier:suppliers(name)')
        .eq('status', 'posted').order('invoice_date', { ascending: false }).limit(300)
      if (error) throw error
      return (data ?? []).map((r: any) => ({ id: r.id, invoice_no: r.invoice_no, invoice_date: r.invoice_date, total: r.total, party: r.supplier?.name ?? null }))
    },
  })

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return data ?? []
    return (data ?? []).filter((r) => r.invoice_no.toLowerCase().includes(s) || (r.party ?? '').toLowerCase().includes(s))
  }, [data, q])

  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  return (
    <div onClick={stop} onMouseDown={stop}>
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-2.5 h-4 w-4 text-stone-400" />
        <input className="input ps-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث في الفواتير (رقم الفاتورة / الاسم)..." />
      </div>
      <div className={`mt-2 overflow-y-auto rounded-xl border border-cream-300 bg-white ${maxHeight}`}>
        {isLoading && <div className="p-3 text-center text-sm text-stone-400">جارٍ التحميل...</div>}
        {!isLoading && rows.length === 0 && <div className="p-3 text-center text-sm text-stone-400">لا توجد فواتير</div>}
        <ul className="divide-y divide-cream-200">
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-start text-sm hover:bg-brand-50 active:bg-brand-100"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPick(r.invoice_no) }}>
                <span className="min-w-0 flex-1 truncate"><b dir="ltr">{r.invoice_no}</b> <span className="text-xs text-stone-400">{r.party ?? ''} · {fmtDate(r.invoice_date)}</span></span>
                <span className="shrink-0 text-xs text-stone-500">{fmtMoney(r.total)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
