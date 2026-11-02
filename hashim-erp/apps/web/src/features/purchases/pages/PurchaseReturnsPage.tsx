import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errMsg } from '@/lib/errors'
import { toast } from '@/store/toast.store'
import { usePermission } from '@/hooks/usePermission'
import { fmtDate, fmtMoney, fmtNum } from '@/lib/formatters'
import { DOC_STATUS } from '@/lib/status'
import { PageHeader } from '@/components/shared/PageHeader'
import { DataTable, type Column } from '@/components/data/DataTable'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { Field, Input } from '@/components/ui/Field'

export default function PurchaseReturnsPage() {
  const qc = useQueryClient()
  const { can } = usePermission()
  const [open, setOpen] = useState(false)
  const [invNo, setInvNo] = useState('')
  const [inv, setInv] = useState<any | null>(null)
  const [qty, setQty] = useState<Record<string, number>>({})
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['purchase-returns'],
    queryFn: async () => (await supabase.from('purchase_returns').select('*, supplier:suppliers(name), invoice:purchase_invoices(invoice_no)').order('created_at', { ascending: false }).limit(200)).data ?? [],
  })

  const find = async () => {
    const { data: i } = await supabase.from('purchase_invoices').select('id,invoice_no,supplier:suppliers(name),items:purchase_invoice_items(product_id,qty,line_total,product:products(name))').eq('invoice_no', invNo.trim()).eq('status', 'posted').maybeSingle()
    if (!i) return toast.error('لم يتم العثور على فاتورة شراء مرحّلة بهذا الرقم')
    setInv(i); setQty({})
  }
  const submit = async () => {
    const items = Object.entries(qty).filter(([, q]) => q > 0).map(([product_id, q]) => ({ product_id, qty: q }))
    if (!items.length) return toast.error('حدد كمية بند واحد على الأقل')
    setBusy(true)
    const { data: r, error } = await supabase.rpc('fn_post_purchase_return', { p: { invoice_id: inv.id, reason: reason || null, items } })
    setBusy(false)
    if (error) return toast.error(errMsg(error))
    toast.success(`تم المرتجع ${r.return_no} — ${fmtMoney(r.total)}`)
    setOpen(false); setInv(null); setInvNo(''); setReason('')
    qc.invalidateQueries({ queryKey: ['purchase-returns'] }); qc.invalidateQueries({ queryKey: ['stock-status'] })
  }

  const cols: Column<any>[] = [
    { key: 'return_no', header: 'رقم المرتجع', render: (r) => <b dir="ltr">{r.return_no}</b> }, { key: 'invoice', header: 'فاتورة الشراء', render: (r) => <span dir="ltr">{r.invoice?.invoice_no ?? '—'}</span> },
    { key: 'supplier', header: 'المورد', render: (r) => r.supplier?.name }, { key: 'return_date', header: 'التاريخ', render: (r) => fmtDate(r.return_date) },
    { key: 'reason', header: 'السبب', render: (r) => r.reason ?? '—' }, { key: 'total', header: 'القيمة', render: (r) => <b>{fmtMoney(r.total)}</b> },
    { key: 'status', header: 'الحالة', render: (r) => <StatusBadge map={DOC_STATUS} value={r.status} /> }]

  return (
    <>
      <PageHeader title="مرتجعات المشتريات" subtitle="إرجاع بضاعة للمورد (تُخصم من المخزن وتُخفَّض من حساب المورد)"
        actions={can('purchases', 'update') && <Button onClick={() => setOpen(true)}>مرتجع جديد</Button>} />
      <DataTable columns={cols} rows={data} loading={isLoading} />

      <Modal open={open} onClose={() => setOpen(false)} title="مرتجع مشتريات" size="lg"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>إلغاء</Button>{inv && <Button variant="danger" loading={busy} onClick={submit}>ترحيل المرتجع</Button>}</>}>
        <div className="flex items-end gap-2"><Field label="رقم فاتورة الشراء" className="flex-1"><Input dir="ltr" value={invNo} onChange={(e) => setInvNo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && find()} /></Field><Button onClick={find}><Search className="h-4 w-4" /> بحث</Button></div>
        {inv && (<div className="mt-4 space-y-2">
          <div className="text-sm text-brand-400">المورد: <b className="text-brand-800">{inv.supplier?.name}</b></div>
          {inv.items.map((i: any) => (
            <div key={i.product_id} className="grid grid-cols-[1fr_110px] items-center gap-2 rounded-xl border border-cream-300 p-2.5 text-sm">
              <div>{i.product?.name}<div className="text-xs text-brand-300">المشترى: {fmtNum(i.qty)}</div></div>
              <Input type="number" min={0} max={Number(i.qty)} step="any" placeholder="الكمية" value={qty[i.product_id] || ''} onChange={(e) => setQty({ ...qty, [i.product_id]: Math.min(Number(e.target.value), Number(i.qty)) })} />
            </div>))}
          <Field label="سبب الإرجاع"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>)}
      </Modal>
    </>
  )
}
