import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Check, Truck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errMsg } from '@/lib/errors'
import { toast } from '@/store/toast.store'
import { usePermission } from '@/hooks/usePermission'
import { useMainWarehouse } from '@/hooks/useLookups'
import { fmtDateTime, fmtNum } from '@/lib/formatters'
import { REQUEST_STATUS } from '@/lib/status'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatusBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Spinner'
import { askConfirm } from '@/store/confirm.store'

export default function RequestDetailPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const { can } = usePermission()
  const { data: main } = useMainWarehouse()
  const [approved, setApproved] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)

  const { data: req, isLoading } = useQuery({
    queryKey: ['requests', 'detail', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_requests')
        .select('*, branch:branches(name), creator:profiles!created_by(full_name), approver:profiles!approved_by(full_name), items:stock_request_items(*, product:products(name,barcode))')
        .eq('id', id!).single()
      if (error) throw error
      return data
    },
  })
  const { data: log } = useQuery({
    queryKey: ['requests', 'log', id],
    queryFn: async () => {
      const { data } = await supabase.from('stock_request_status_log').select('*, user:profiles!changed_by(full_name)').eq('request_id', id!).order('changed_at')
      return data ?? []
    },
  })
  // رصيد المخزن الرئيسي لعرض المتاح بجانب كل بند
  const { data: mainStock } = useQuery({
    queryKey: ['requests', 'main-stock', main?.id], enabled: !!main,
    queryFn: async () => {
      const { data } = await supabase.from('stock_balances').select('product_id,qty_on_hand,qty_reserved').eq('branch_id', main!.id)
      const m: Record<string, number> = {}
      data?.forEach((r) => { m[r.product_id] = Number(r.qty_on_hand) - Number(r.qty_reserved) })
      return m
    },
  })

  useEffect(() => {
    if (req) setApproved(Object.fromEntries(req.items.map((i: any) => [i.id, Number(i.qty_approved ?? i.qty_requested)])))
  }, [req])

  if (isLoading || !req) return <Spinner />

  const canDecide = can('requests', 'approve') && ['new', 'under_review'].includes(req.status)
  const canTransfer = can('transfers', 'create') && ['approved', 'partially_approved'].includes(req.status)

  const refresh = () => qc.invalidateQueries({ queryKey: ['requests'] })

  const approve = async () => {
    setBusy(true)
    const items = req.items.map((i: any) => ({ item_id: i.id, qty_approved: approved[i.id] ?? 0 }))
    const { data, error } = await supabase.rpc('fn_approve_request', { p_request: req.id, p_items: items })
    setBusy(false)
    if (error) return toast.error(errMsg(error))
    toast.success(`تم القرار: ${REQUEST_STATUS[data]?.[0] ?? data}`)
    refresh()
  }

  const reject = async () => {
    if (!(await askConfirm({ title: 'رفض الطلب بالكامل؟', description: 'سيُبلَّغ الفرع بالرفض.', confirmLabel: 'ارفض الطلب', tone: 'danger', hold: true }))) return
    setBusy(true)
    const items = req.items.map((i: any) => ({ item_id: i.id, qty_approved: 0 }))
    const { error } = await supabase.rpc('fn_approve_request', { p_request: req.id, p_items: items })
    setBusy(false)
    if (error) return toast.error(errMsg(error))
    toast.success('تم رفض الطلب'); refresh()
  }

  const createTransfer = async () => {
    if (!main) return toast.error('لم يتم العثور على المخزن الرئيسي')
    const items = req.items.filter((i: any) => Number(i.qty_approved) > 0).map((i: any) => ({ product_id: i.product_id, qty: Number(i.qty_approved) }))
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_create_transfer', { p: { from_branch_id: main.id, to_branch_id: req.branch_id, request_id: req.id, items } })
    setBusy(false)
    if (error) return toast.error(errMsg(error))
    toast.success(`تم إنشاء التحويل ${data.transfer_no}`)
    qc.invalidateQueries({ queryKey: ['transfers'] })
    nav(`/transfers/${data.id}`)
  }

  return (
    <>
      <PageHeader title={`طلب ${req.request_no}`} subtitle={`${req.branch?.name} · ${fmtDateTime(req.created_at)}`}
        actions={<><Link to="/requests" className="btn border border-stone-300 bg-white text-stone-700"><ArrowRight className="h-4 w-4" /> رجوع</Link>
          <StatusBadge map={REQUEST_STATUS} value={req.status} /></>} />

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-cream-200 text-xs text-brand-700"><tr>
              <th className="px-3 py-2.5 text-start">المنتج</th><th className="px-3 text-start">المطلوب</th>
              <th className="px-3 text-start">متاح بالمخزن</th><th className="px-3 text-start">المعتمد</th><th className="px-3 text-start">ملاحظة</th></tr></thead>
            <tbody className="divide-y divide-cream-200">
              {req.items.map((i: any) => (
                <tr key={i.id}>
                  <td className="px-3 py-2.5 font-semibold">{i.product?.name}</td>
                  <td className="px-3">{fmtNum(i.qty_requested)}</td>
                  <td className="px-3 text-stone-500">{fmtNum(mainStock?.[i.product_id] ?? 0)}</td>
                  <td className="px-3">
                    {canDecide
                      ? <Input type="number" min={0} max={Number(i.qty_requested)} step="any" className="!w-24" value={approved[i.id] ?? 0}
                          onChange={(e) => setApproved({ ...approved, [i.id]: Math.min(Number(e.target.value), Number(i.qty_requested)) })} />
                      : <b>{i.qty_approved == null ? '—' : fmtNum(i.qty_approved)}</b>}
                  </td>
                  <td className="px-3 text-stone-500">{i.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap justify-end gap-2 border-t border-cream-200 p-3">
            {canDecide && <><Button variant="danger" loading={busy} onClick={reject}>رفض</Button><Button variant="success" loading={busy} onClick={approve}><Check className="h-4 w-4" /> اعتماد</Button></>}
            {canTransfer && <Button loading={busy} onClick={createTransfer}><Truck className="h-4 w-4" /> إنشاء تحويل من المخزن الرئيسي</Button>}
          </div>
        </div>

        <div className="card p-4">
          <h3 className="mb-3 text-sm font-bold">سجل الإجراءات</h3>
          <ol className="space-y-3 border-s-2 border-brand-200 ps-4">
            {log?.map((l: any) => (
              <li key={l.id} className="relative">
                <span className="absolute -start-[21px] top-1 h-2.5 w-2.5 rounded-full bg-brand-600" />
                <StatusBadge map={REQUEST_STATUS} value={l.status} />
                <div className="mt-0.5 text-xs text-stone-500">{l.user?.full_name ?? '—'} · {fmtDateTime(l.changed_at)}</div>
              </li>
            ))}
          </ol>
          {req.note && <div className="mt-4 rounded-lg bg-cream-100 p-3 text-sm"><b>ملاحظات:</b> {req.note}</div>}
        </div>
      </div>
    </>
  )
}
