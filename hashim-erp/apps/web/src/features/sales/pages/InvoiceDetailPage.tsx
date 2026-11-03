import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Printer, RotateCcw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errMsg } from '@/lib/errors'
import { toast } from '@/store/toast.store'
import { usePermission } from '@/hooks/usePermission'
import { useOpenShift, usePaymentMethods } from '@/hooks/useLookups'
import { useAuth } from '@/store/auth.store'
import { fmtDateTime, fmtMoney, fmtNum } from '@/lib/formatters'
import { SALE_STATUS } from '@/lib/status'
import { PageHeader } from '@/components/shared/PageHeader'
import { ReceiptModal, type ReceiptData } from '@/components/shared/Receipt'
import { DataTable, type Column } from '@/components/data/DataTable'
import { StatusBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input, Select, Field } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Spinner'

export default function InvoiceDetailPage() {
  const { id } = useParams()
  const qc = useQueryClient()
  const { can } = usePermission()
  const userId = useAuth((s) => s.session?.user.id)
  const { data: shift } = useOpenShift(userId)
  const { data: methods } = usePaymentMethods()
  const [receipt, setReceipt] = useState<ReceiptData | null>(null)
  const [returnOpen, setReturnOpen] = useState(false)
  const [qtys, setQtys] = useState<Record<string, number>>({})
  const [conds, setConds] = useState<Record<string, string>>({})
  const [method, setMethod] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const { data: inv, isLoading } = useQuery({
    queryKey: ['sales', 'detail', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('sales_invoices')
        .select('*, branch:branches(name), customer:customers(name,phone), seller:employees!sold_by(full_name), items:sales_invoice_items(*, product:products(name,barcode)), pays:sales_payments(amount,received_amount,method:payment_methods(name))')
        .eq('id', id!).single()
      if (error) throw error
      return data
    },
  })

  // الكميات المرتجعة سابقاً لكل بند
  const { data: returned } = useQuery({
    queryKey: ['sales', 'returned', id],
    queryFn: async () => {
      const { data } = await supabase.from('sales_return_items').select('invoice_item_id,qty,sales_returns!inner(status,invoice_id)').eq('sales_returns.invoice_id', id!).eq('sales_returns.status', 'posted')
      const m: Record<string, number> = {}
      data?.forEach((r: any) => { m[r.invoice_item_id] = (m[r.invoice_item_id] ?? 0) + Number(r.qty) })
      return m
    },
  })

  if (isLoading || !inv) return <Spinner />

  const toReceipt = (): ReceiptData => ({
    invoice_no: inv.invoice_no, invoice_date: inv.invoice_date, branch: inv.branch?.name, cashier: inv.seller?.full_name, customer: inv.customer?.name,
    items: inv.items.map((i: any) => ({ name: i.product?.name, qty: Number(i.qty), unit_price: Number(i.unit_price), line_total: Number(i.line_total) })),
    subtotal: Number(inv.subtotal), discount: Number(inv.discount), tax_amount: Number(inv.tax_amount), total: Number(inv.total),
    paid_amount: Number(inv.paid_amount), change_amount: Number(inv.change_amount), remaining: Number(inv.remaining),
    payments: inv.pays.map((p: any) => ({ method: p.method?.name, amount: Number(p.amount) })),
  })

  const submitReturn = async () => {
    const items = Object.entries(qtys).filter(([, q]) => q > 0).map(([invoice_item_id, qty]) => ({ invoice_item_id, qty, condition: conds[invoice_item_id] ?? 'resalable', reason }))
    if (!items.length) return toast.error('حدد كمية بند واحد على الأقل')
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_post_sales_return', { p: { invoice_id: inv.id, refund_method_id: method || methods?.find((m) => m.is_cash)?.id, reason, items } })
    setBusy(false)
    if (error) return toast.error(errMsg(error))
    toast.success(`تم المرتجع ${data.return_no} — المسترد ${fmtMoney(data.refund_amount)}`)
    setReturnOpen(false); setQtys({}); setConds({})
    qc.invalidateQueries({ queryKey: ['sales'] })
  }

  const cols: Column<any>[] = [
    { key: 'p', header: 'المنتج', render: (i) => i.product?.name },
    { key: 'qty', header: 'الكمية', render: (i) => fmtNum(i.qty) },
    { key: 'unit_price', header: 'السعر', render: (i) => fmtMoney(i.unit_price) },
    { key: 'discount', header: 'الخصم', render: (i) => fmtMoney(i.discount) },
    { key: 'tax_rate', header: 'الضريبة %', render: (i) => fmtNum(i.tax_rate) },
    { key: 'line_total', header: 'الإجمالي', render: (i) => <b>{fmtMoney(i.line_total)}</b> },
    { key: 'ret', header: 'مرتجع', render: (i) => (returned?.[i.id] ? fmtNum(returned[i.id]) : '—') },
  ]

  const canReturn = can('returns', 'create') && inv.status !== 'cancelled' && inv.status !== 'returned'

  return (
    <>
      <PageHeader title={`فاتورة ${inv.invoice_no}`} subtitle={fmtDateTime(inv.invoice_date)}
        actions={<>
          <Link to="/sales" className="btn border border-stone-300 bg-white text-stone-700"><ArrowRight className="h-4 w-4" /> رجوع</Link>
          <Button variant="secondary" onClick={() => setReceipt(toReceipt())}><Printer className="h-4 w-4" /> طباعة</Button>
          {canReturn && <Button variant="danger" onClick={() => setReturnOpen(true)}><RotateCcw className="h-4 w-4" /> مرتجع</Button>}
        </>} />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[['الحالة', <StatusBadge key="s" map={SALE_STATUS} value={inv.status} />], ['الفرع', inv.branch?.name], ['العميل', inv.customer?.name ?? 'نقدي'], ['موظف البيع', inv.seller?.full_name ?? '—']].map(([l, v]: any) => (
          <div key={l} className="card p-3"><div className="text-xs text-stone-500">{l}</div><div className="mt-1 font-semibold">{v}</div></div>
        ))}
      </div>

      <DataTable columns={cols} rows={inv.items} />

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <h3 className="mb-2 text-sm font-bold">الدفعات</h3>
          {inv.pays.map((p: any, i: number) => <div key={i} className="flex justify-between py-1 text-sm"><span>{p.method?.name}</span><b>{fmtMoney(p.amount)}</b></div>)}
          {!inv.pays.length && <div className="text-sm text-stone-400">لا دفعات (بيع آجل)</div>}
        </div>
        <div className="card space-y-1 p-4 text-sm">
          <div className="flex justify-between"><span>المجموع</span><span>{fmtMoney(inv.subtotal)}</span></div>
          <div className="flex justify-between"><span>الخصم</span><span>{fmtMoney(inv.discount)}</span></div>
          <div className="flex justify-between"><span>الضريبة</span><span>{fmtMoney(inv.tax_amount)}</span></div>
          <div className="flex justify-between border-t pt-1 text-base font-bold"><span>الصافي</span><span>{fmtMoney(inv.total)}</span></div>
          <div className="flex justify-between"><span>المدفوع</span><span>{fmtMoney(inv.paid_amount)}</span></div>
          {Number(inv.remaining) > 0 && <div className="flex justify-between text-red-600"><span>المتبقي</span><b>{fmtMoney(inv.remaining)}</b></div>}
        </div>
      </div>

      <ReceiptModal data={receipt} onClose={() => setReceipt(null)} />

      <Modal open={returnOpen} onClose={() => setReturnOpen(false)} title="مرتجع من الفاتورة" size="lg"
        footer={<><Button variant="secondary" onClick={() => setReturnOpen(false)}>إلغاء</Button><Button variant="danger" loading={busy} disabled={!shift} onClick={submitReturn}>تنفيذ المرتجع</Button></>}>
        {!shift && <div className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">يلزم فتح وردية لتنفيذ المرتجع (يُسجَّل المسترد في صندوق الوردية).</div>}
        <div className="space-y-2">
          {inv.items.map((i: any) => {
            const left = Number(i.qty) - (returned?.[i.id] ?? 0)
            return (
              <div key={i.id} className="grid grid-cols-[1fr_90px_130px] items-center gap-2 rounded-lg border border-cream-300 p-2 text-sm">
                <div>{i.product?.name}<div className="text-xs text-stone-400">المتاح للإرجاع: {fmtNum(left)}</div></div>
                <Input type="number" min={0} max={left} disabled={left <= 0} placeholder="الكمية" value={qtys[i.id] || ''} onChange={(e) => setQtys({ ...qtys, [i.id]: Math.min(Number(e.target.value), left) })} />
                <Select value={conds[i.id] ?? 'resalable'} onChange={(e) => setConds({ ...conds, [i.id]: e.target.value })}>
                  <option value="resalable">صالح للبيع</option><option value="damaged">تالف</option>
                </Select>
              </div>
            )
          })}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="طريقة الاسترداد"><Select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">نقدي (افتراضي)</option>{methods?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
          <Field label="سبب الإرجاع"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
      </Modal>
    </>
  )
}
