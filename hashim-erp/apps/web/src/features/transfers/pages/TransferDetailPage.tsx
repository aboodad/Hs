import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, PackageCheck, Send, Truck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errMsg } from '@/lib/errors'
import { toast } from '@/store/toast.store'
import { useAuth } from '@/store/auth.store'
import { usePermission } from '@/hooks/usePermission'
import { fmtDateTime, fmtMoney, fmtNum } from '@/lib/formatters'
import { TRANSFER_STATUS } from '@/lib/status'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatusBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Spinner'

export default function TransferDetailPage() {
  const { id } = useParams()
  const qc = useQueryClient()
  const { can, seesAllBranches } = usePermission()
  const myBranch = useAuth((s) => s.profile?.branch_id)
  const [received, setReceived] = useState<Record<string, number>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const { data: t, isLoading } = useQuery({
    queryKey: ['transfers', 'detail', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_transfers')
        .select('*, from_b:branches!from_branch_id(name), to_b:branches!to_branch_id(name), issuer:profiles!issued_by(full_name), receiver:profiles!received_by(full_name), items:stock_transfer_items(*, product:products(name,barcode))')
        .eq('id', id!).single()
      if (error) throw error
      return data
    },
  })

  useEffect(() => {
    if (t) setReceived(Object.fromEntries(t.items.map((i: any) => [i.id, Number(i.qty_received ?? i.qty_sent)])))
  }, [t])

  if (isLoading || !t) return <Spinner />

  const refresh = () => { qc.invalidateQueries({ queryKey: ['transfers'] }); qc.invalidateQueries({ queryKey: ['requests'] }) }
  const run = async (fn: string, args: Record<string, any>, ok: string) => {
    setBusy(true)
    const { error } = await supabase.rpc(fn, args)
    setBusy(false)
    if (error) return toast.error(errMsg(error))
    toast.success(ok); refresh()
  }

  const canIssue = can('transfers', 'approve') && t.status === 'created'
  const canTransit = can('transfers', 'update') && t.status === 'issued' && (seesAllBranches || myBranch === t.from_branch_id)
  const canReceive = can('transfers', 'update') && ['issued', 'in_transit'].includes(t.status) && (seesAllBranches || myBranch === t.to_branch_id)
  const receiving = canReceive

  const receive = () => {
    const items = t.items.map((i: any) => ({ item_id: i.id, qty_received: received[i.id] ?? 0, diff_note: notes[i.id] || null }))
    run('fn_receive_transfer', { p_transfer: t.id, p_items: items }, 'تم تأكيد الاستلام')
  }

  return (
    <>
      <PageHeader title={`تحويل ${t.transfer_no}`} subtitle={`${t.from_b?.name} ← ${t.to_b?.name}`}
        actions={<><Link to="/transfers" className="btn border border-stone-300 bg-white text-stone-700"><ArrowRight className="h-4 w-4" /> رجوع</Link>
          <StatusBadge map={TRANSFER_STATUS} value={t.status} /></>} />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[['قيمة البضاعة (جملة)', fmtMoney(t.total_wholesale_value)], ['تاريخ التحويل', fmtDateTime(t.created_at)],
          ['صرفه', t.issuer?.full_name ?? '—'], ['استلمه', t.receiver ? `${t.receiver.full_name} · ${fmtDateTime(t.received_at)}` : '—']].map(([l, v]) => (
          <div key={l} className="card p-3"><div className="text-xs text-stone-500">{l}</div><div className="mt-1 font-semibold">{v}</div></div>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-cream-200 text-xs text-brand-700"><tr>
            <th className="px-3 py-2.5 text-start">المنتج</th><th className="px-3 text-start">المرسل</th><th className="px-3 text-start">المستلم فعلياً</th>
            <th className="px-3 text-start">الفرق</th><th className="px-3 text-start">سعر الجملة</th><th className="px-3 text-start">ملاحظة</th></tr></thead>
          <tbody className="divide-y divide-cream-200">
            {t.items.map((i: any) => {
              const rec = receiving ? (received[i.id] ?? 0) : Number(i.qty_received ?? i.qty_sent)
              const diff = Number(i.qty_sent) - rec
              return (
                <tr key={i.id}>
                  <td className="px-3 py-2.5 font-semibold">{i.product?.name}{i.lot_price != null && can('pricing', 'view') && <div className="text-[11px] font-normal text-gold-700">دفعة بسعر شراء {fmtMoney(i.lot_price)}</div>}</td>
                  <td className="px-3">{fmtNum(i.qty_sent)}</td>
                  <td className="px-3">{receiving
                    ? <Input type="number" min={0} max={Number(i.qty_sent)} step="any" className="!w-24" value={received[i.id] ?? 0} onChange={(e) => setReceived({ ...received, [i.id]: Math.min(Number(e.target.value), Number(i.qty_sent)) })} />
                    : (i.qty_received == null ? '—' : fmtNum(i.qty_received))}</td>
                  <td className={`px-3 font-semibold ${diff !== 0 && (receiving || i.qty_received != null) ? 'text-red-600' : 'text-stone-400'}`}>{receiving || i.qty_received != null ? fmtNum(diff) : '—'}</td>
                  <td className="px-3">{fmtMoney(i.wholesale_price)}</td>
                  <td className="px-3">{receiving && diff !== 0
                    ? <Input placeholder="سبب الاختلاف" value={notes[i.id] ?? ''} onChange={(e) => setNotes({ ...notes, [i.id]: e.target.value })} />
                    : (i.diff_note ?? '')}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="flex flex-wrap justify-end gap-2 border-t border-cream-200 p-3">
          {canIssue && <Button loading={busy} onClick={() => run('fn_issue_transfer', { p_transfer: t.id }, 'تم صرف البضاعة من المخزن')}><Send className="h-4 w-4" /> صرف البضاعة</Button>}
          {canTransit && <Button variant="secondary" loading={busy} onClick={() => run('fn_set_transfer_in_transit', { p_transfer: t.id }, 'التحويل قيد النقل')}><Truck className="h-4 w-4" /> قيد النقل</Button>}
          {canReceive && <Button variant="success" loading={busy} onClick={receive}><PackageCheck className="h-4 w-4" /> تأكيد الاستلام</Button>}
        </div>
      </div>
    </>
  )
}
