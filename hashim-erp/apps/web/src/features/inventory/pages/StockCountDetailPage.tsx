import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, CheckCheck, Save, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errMsg } from '@/lib/errors'
import { toast } from '@/store/toast.store'
import { usePermission } from '@/hooks/usePermission'
import { fmtMoney, fmtNum } from '@/lib/formatters'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatusBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Spinner'
import { COUNT_STATUS } from './StockCountsPage'
import { askConfirm } from '@/store/confirm.store'

export default function StockCountDetailPage() {
  const { id } = useParams()
  const qc = useQueryClient()
  const { can } = usePermission()
  const [actual, setActual] = useState<Record<string, string>>({})
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)

  const { data: count } = useQuery({
    queryKey: ['stock-counts', 'detail', id],
    queryFn: async () => (await supabase.from('stock_counts').select('*, branch:branches(name)').eq('id', id!).single()).data,
  })
  const { data: items, isLoading } = useQuery({
    queryKey: ['stock-counts', 'items', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_count_items').select('*, product:products(name,barcode,sku)').eq('count_id', id!).order('created_at')
      if (error) throw error
      return data ?? []
    },
  })

  useEffect(() => {
    if (items) {
      setActual(Object.fromEntries(items.map((i: any) => [i.id, i.actual_qty == null ? '' : String(i.actual_qty)])))
      setReasons(Object.fromEntries(items.map((i: any) => [i.id, i.reason ?? ''])))
    }
  }, [items])

  const editable = count?.status === 'in_progress' && can('stock_counts', 'update')
  const rows = useMemo(() => (items ?? []).filter((i: any) =>
    !search || `${i.product?.name} ${i.product?.barcode ?? ''} ${i.product?.sku}`.toLowerCase().includes(search.toLowerCase())), [items, search])

  const filled = (items ?? []).filter((i: any) => actual[i.id] !== '' && actual[i.id] != null).length

  const save = async () => {
    setBusy(true)
    const changed = (items ?? []).filter((i: any) => {
      const a = actual[i.id] === '' ? null : Number(actual[i.id])
      return a !== (i.actual_qty == null ? null : Number(i.actual_qty)) || (reasons[i.id] || null) !== (i.reason ?? null)
    })
    for (const i of changed) {
      const { error } = await supabase.from('stock_count_items')
        .update({ actual_qty: actual[i.id] === '' ? null : Number(actual[i.id]), reason: reasons[i.id] || null }).eq('id', i.id)
      if (error) { setBusy(false); return toast.error(errMsg(error)) }
    }
    setBusy(false)
    toast.success(`تم حفظ ${changed.length} بند`)
    qc.invalidateQueries({ queryKey: ['stock-counts', 'items', id] })
  }

  const approve = async () => {
    if (!(await askConfirm({ title: 'اعتماد نتيجة الجرد؟', description: 'ستُنشأ حركات تسوية للمخزون ولا يمكن التراجع.', confirmLabel: 'اعتمد الجرد', tone: 'brand', hold: true }))) return
    await save()
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_approve_stock_count', { p_count: id })
    setBusy(false)
    if (error) return toast.error(errMsg(error))
    toast.success(`تم الاعتماد — ${data.adjusted_items} بند مُسوّى، صافي الفرق ${fmtMoney(data.net_diff_value)}`)
    qc.invalidateQueries({ queryKey: ['stock-counts'] })
    qc.invalidateQueries({ queryKey: ['stock-status'] })
  }

  if (isLoading || !count) return <Spinner />

  return (
    <>
      <PageHeader title={`جرد ${count.count_no}`} subtitle={`${count.branch?.name} · ${filled} / ${items?.length ?? 0} بند مُدخل`}
        actions={<>
          <Link to="/inventory/counts" className="btn border border-cream-400 bg-white text-brand-700"><ArrowRight className="h-4 w-4" /> رجوع</Link>
          <StatusBadge map={COUNT_STATUS} value={count.status} />
          {editable && <Button variant="secondary" loading={busy} onClick={save}><Save className="h-4 w-4" /> حفظ</Button>}
          {editable && can('stock_counts', 'approve') && <Button variant="gold" loading={busy} onClick={approve}><CheckCheck className="h-4 w-4" /> اعتماد النتيجة</Button>}
        </>} />

      <div className="relative mb-3 max-w-sm"><Search className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-brand-300" />
        <Input className="ps-10" placeholder="بحث بالاسم أو الباركود..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-cream-200 text-xs text-brand-700"><tr>
            {['المنتج', 'الباركود', 'كمية النظام', 'الكمية الفعلية', 'الفرق', 'قيمة الفرق', 'السبب'].map((h) => <th key={h} className="px-3 py-2.5 text-start">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-cream-200">
            {rows.map((i: any) => {
              const a = actual[i.id]
              const diff = a === '' || a == null ? null : Number(a) - Number(i.system_qty)
              return (
                <tr key={i.id}>
                  <td className="px-3 py-2 font-semibold">{i.product?.name}</td>
                  <td className="px-3 text-xs" dir="ltr">{i.product?.barcode ?? '—'}</td>
                  <td className="px-3">{fmtNum(i.system_qty)}</td>
                  <td className="px-3">{editable
                    ? <Input type="number" min={0} step="any" className="!w-28" value={a ?? ''} onChange={(e) => setActual({ ...actual, [i.id]: e.target.value })} />
                    : (i.actual_qty == null ? '—' : fmtNum(i.actual_qty))}</td>
                  <td className={`px-3 font-bold ${diff == null || diff === 0 ? 'text-brand-300' : diff < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{diff == null ? (i.diff_qty == null ? '—' : fmtNum(i.diff_qty)) : fmtNum(diff)}</td>
                  <td className="px-3">{i.diff_value == null ? '—' : fmtMoney(i.diff_value)}</td>
                  <td className="px-3">{editable && diff !== 0 && diff != null
                    ? <Input placeholder="سبب الفرق" value={reasons[i.id] ?? ''} onChange={(e) => setReasons({ ...reasons, [i.id]: e.target.value })} />
                    : (i.reason ?? '')}</td>
                </tr>
              )
            })}
            {!rows.length && <tr><td colSpan={7} className="p-10 text-center text-brand-300">لا توجد بنود</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
