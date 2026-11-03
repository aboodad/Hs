import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Wallet } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errMsg } from '@/lib/errors'
import { toast } from '@/store/toast.store'
import { useAuth } from '@/store/auth.store'
import { usePermission } from '@/hooks/usePermission'
import { useOpenShift, usePaymentMethods } from '@/hooks/useLookups'
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/formatters'
import { SALE_STATUS } from '@/lib/status'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatCard } from '@/components/shared/StatCard'
import { DataTable, type Column } from '@/components/data/DataTable'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { Field, Input, Select } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Spinner'

export default function CustomerDetailPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const { can } = usePermission()
  const userId = useAuth((s) => s.session?.user.id)
  const { data: shift } = useOpenShift(userId)
  const { data: methods } = usePaymentMethods()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState({ invoice_id: '', amount: '', payment_method_id: '' })

  const { data: bal } = useQuery({ queryKey: ['customer-balance', id], queryFn: async () => (await supabase.from('v_customer_balance').select('*').eq('customer_id', id!).maybeSingle()).data })
  const { data: cu } = useQuery({ queryKey: ['customer', id], queryFn: async () => (await supabase.from('customers').select('*').eq('id', id!).single()).data })
  const { data: inv } = useQuery({ queryKey: ['customer-invoices', id], queryFn: async () => (await supabase.from('sales_invoices').select('*, branch:branches(name)').eq('customer_id', id!).order('invoice_date', { ascending: false }).limit(100)).data ?? [] })
  const { data: pays } = useQuery({ queryKey: ['customer-payments', id], queryFn: async () => (await supabase.from('customer_payments').select('*, method:payment_methods(name), invoice:sales_invoices(invoice_no)').eq('customer_id', id!).order('paid_at', { ascending: false })).data ?? [] })
  const { data: rets } = useQuery({ queryKey: ['customer-returns', id], queryFn: async () => (await supabase.from('sales_returns').select('*, invoice:sales_invoices(invoice_no)').eq('customer_id', id!).order('return_date', { ascending: false })).data ?? [] })
  const { data: exs } = useQuery({ queryKey: ['customer-exchanges', id], queryFn: async () => (await supabase.from('exchanges').select('*').eq('customer_id', id!).order('created_at', { ascending: false })).data ?? [] })

  const due = (inv ?? []).filter((i: any) => Number(i.remaining) > 0 && i.status !== 'cancelled')

  const collect = async () => {
    const amount = Number(f.amount); const method = f.payment_method_id || methods?.find((m) => m.is_cash)?.id
    if (!(amount > 0) || !method) return toast.error('أدخل المبلغ وطريقة الدفع')
    const branch_id = shift?.branch_id ?? (due.find((i: any) => i.id === f.invoice_id) as any)?.branch_id
    if (!branch_id) return toast.error('افتح وردية أو اختر فاتورة لتحديد الفرع')
    setBusy(true)
    const { error } = await supabase.from('customer_payments').insert({ customer_id: id, invoice_id: f.invoice_id || null, branch_id, shift_id: shift?.id ?? null, amount, payment_method_id: method })
    setBusy(false)
    if (error) return toast.error(errMsg(error))
    toast.success('تم تسجيل التحصيل'); setOpen(false); setF({ invoice_id: '', amount: '', payment_method_id: '' })
    ;['customer-balance', 'customer-invoices', 'customer-payments', 'sales'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
  }

  if (!bal || !cu) return <Spinner />

  return (
    <>
      <PageHeader title={cu.name} subtitle={cu.phone ?? ''}
        actions={<><Link to="/customers" className="btn border border-cream-400 bg-white text-brand-700"><ArrowRight className="h-4 w-4" /> رجوع</Link>
          {can('customers', 'update') && <Button variant="gold" onClick={() => setOpen(true)}><Wallet className="h-4 w-4" /> تحصيل مبلغ</Button>}</>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="إجمالي المشتريات" value={fmtMoney(bal.total_sales)} /><StatCard label="المدفوع" value={fmtMoney(bal.total_paid)} tone="green" />
        <StatCard label="رصيد افتتاحي" value={fmtMoney(bal.opening_balance)} tone="blue" /><StatCard label="المستحق" value={fmtMoney(bal.balance_due)} tone="red" />
      </div>
      <h3 className="mb-2 text-sm font-bold text-brand-700">الفواتير</h3>
      <DataTable onRowClick={(r) => nav(`/sales/${r.id}`)} rows={inv} columns={[
        { key: 'n', header: 'رقم الفاتورة', render: (r: any) => <b dir="ltr">{r.invoice_no}</b> }, { key: 'd', header: 'التاريخ', render: (r: any) => fmtDateTime(r.invoice_date) }, { key: 'b', header: 'الفرع', render: (r: any) => r.branch?.name },
        { key: 't', header: 'الصافي', render: (r: any) => fmtMoney(r.total) }, { key: 'r', header: 'المتبقي', render: (r: any) => (Number(r.remaining) > 0 ? <b className="text-red-600">{fmtMoney(r.remaining)}</b> : '—') },
        { key: 's', header: 'الحالة', render: (r: any) => <StatusBadge map={SALE_STATUS} value={r.status} /> }] as Column<any>[]} />
      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <div><h3 className="mb-2 text-sm font-bold text-brand-700">المدفوعات (التحصيل)</h3><DataTable rows={pays} columns={[{ key: 'd', header: 'التاريخ', render: (r: any) => fmtDate(r.paid_at) }, { key: 'a', header: 'المبلغ', render: (r: any) => <b>{fmtMoney(r.amount)}</b> }, { key: 'm', header: 'الطريقة', render: (r: any) => r.method?.name }] as Column<any>[]} /></div>
        <div><h3 className="mb-2 text-sm font-bold text-brand-700">المرتجعات</h3><DataTable rows={rets} columns={[{ key: 'n', header: 'الرقم', render: (r: any) => <span dir="ltr">{r.return_no}</span> }, { key: 'd', header: 'التاريخ', render: (r: any) => fmtDate(r.return_date) }, { key: 'a', header: 'المسترد', render: (r: any) => fmtMoney(r.refund_amount) }] as Column<any>[]} /></div>
        <div><h3 className="mb-2 text-sm font-bold text-brand-700">الاستبدالات</h3><DataTable rows={exs} columns={[{ key: 'n', header: 'الرقم', render: (r: any) => <span dir="ltr">{r.exchange_no}</span> }, { key: 'd', header: 'التاريخ', render: (r: any) => fmtDate(r.created_at) }, { key: 'a', header: 'الفرق', render: (r: any) => fmtMoney(r.difference) }] as Column<any>[]} /></div>
      </div>
      <p className="mt-4 text-xs text-brand-300">كشف الحساب الكامل: التقارير ← كشف حساب عميل.</p>

      <Modal open={open} onClose={() => setOpen(false)} title="تحصيل مبلغ من العميل" size="sm" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>إلغاء</Button><Button loading={busy} onClick={collect}>حفظ</Button></>}>
        <div className="space-y-4">
          <Field label="الفاتورة"><Select value={f.invoice_id} onChange={(e) => { const i: any = due.find((x: any) => x.id === e.target.value); setF({ ...f, invoice_id: e.target.value, amount: i ? String(i.remaining) : f.amount }) }}>
            <option value="">— اختر فاتورة مستحقة —</option>{due.map((i: any) => <option key={i.id} value={i.id}>{i.invoice_no} — متبقي {fmtMoney(i.remaining)}</option>)}</Select></Field>
          <Field label="المبلغ *"><Input type="number" min={0} step="any" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="طريقة الدفع"><Select value={f.payment_method_id} onChange={(e) => setF({ ...f, payment_method_id: e.target.value })}><option value="">نقدي (افتراضي)</option>{methods?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
          {!shift && <p className="text-xs text-gold-800">لا توجد وردية مفتوحة: يُسجَّل التحصيل بدون صندوق وردية.</p>}
        </div>
      </Modal>
    </>
  )
}
