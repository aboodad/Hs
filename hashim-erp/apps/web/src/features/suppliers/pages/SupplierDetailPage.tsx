import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Banknote, FileText, Receipt, Wallet } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errMsg } from '@/lib/errors'
import { toast } from '@/store/toast.store'
import { usePermission } from '@/hooks/usePermission'
import { usePaymentMethods } from '@/hooks/useLookups'
import { fmtDate, fmtMoney, toISODate } from '@/lib/formatters'
import { PAY_STATUS } from '@/lib/status'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatCard } from '@/components/shared/StatCard'
import { DataTable, type Column } from '@/components/data/DataTable'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { Field, Input, Select } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Spinner'

export default function SupplierDetailPage() {
  const { id } = useParams()
  const qc = useQueryClient()
  const { can } = usePermission()
  const { data: methods } = usePaymentMethods()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState({ invoice_id: '', amount: '', payment_method_id: '', ref_no: '', paid_at: toISODate(new Date()) })

  const { data: bal } = useQuery({ queryKey: ['supplier-balance', id], queryFn: async () => (await supabase.from('v_supplier_balance').select('*').eq('supplier_id', id!).maybeSingle()).data })
  const { data: inv } = useQuery({ queryKey: ['supplier-invoices', id], queryFn: async () => (await supabase.from('purchase_invoices').select('*').eq('supplier_id', id!).eq('status', 'posted').order('invoice_date', { ascending: false })).data ?? [] })
  const { data: pays } = useQuery({ queryKey: ['supplier-payments', id], queryFn: async () => (await supabase.from('supplier_payments').select('*, method:payment_methods(name), invoice:purchase_invoices(invoice_no)').eq('supplier_id', id!).order('paid_at', { ascending: false })).data ?? [] })
  const { data: rets } = useQuery({ queryKey: ['supplier-returns', id], queryFn: async () => (await supabase.from('purchase_returns').select('*').eq('supplier_id', id!).eq('status', 'posted').order('return_date', { ascending: false })).data ?? [] })

  const unpaid = (inv ?? []).filter((i: any) => Number(i.remaining) > 0)

  const pay = async () => {
    const amount = Number(f.amount)
    if (!(amount > 0)) return toast.error('أدخل مبلغاً صحيحاً')
    setBusy(true)
    const { error } = await supabase.from('supplier_payments').insert({ supplier_id: id, invoice_id: f.invoice_id || null, amount, payment_method_id: f.payment_method_id || null, ref_no: f.ref_no || null, paid_at: f.paid_at })
    setBusy(false)
    if (error) return toast.error(errMsg(error))
    toast.success('تم تسجيل الدفعة'); setOpen(false); setF({ ...f, amount: '', ref_no: '' })
    ;['supplier-balance', 'supplier-invoices', 'supplier-payments', 'purchases'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
  }

  if (!bal) return <Spinner />

  const invCols: Column<any>[] = [
    { key: 'invoice_no', header: 'رقم الفاتورة', render: (r) => <b dir="ltr">{r.invoice_no}</b> }, { key: 'invoice_date', header: 'التاريخ', render: (r) => fmtDate(r.invoice_date) },
    { key: 'total', header: 'القيمة', render: (r) => fmtMoney(r.total) }, { key: 'paid_amount', header: 'المدفوع', render: (r) => fmtMoney(r.paid_amount) },
    { key: 'remaining', header: 'المتبقي', render: (r) => (Number(r.remaining) > 0 ? <b className="text-red-600">{fmtMoney(r.remaining)}</b> : '—') },
    { key: 'payment_status', header: 'الدفع', render: (r) => <StatusBadge map={PAY_STATUS} value={r.payment_status} /> }]
  const payCols: Column<any>[] = [
    { key: 'paid_at', header: 'التاريخ', render: (r) => fmtDate(r.paid_at) }, { key: 'amount', header: 'المبلغ', render: (r) => <b>{fmtMoney(r.amount)}</b> },
    { key: 'method', header: 'الطريقة', render: (r) => r.method?.name ?? '—' }, { key: 'invoice', header: 'الفاتورة', render: (r) => r.invoice?.invoice_no ?? 'على الحساب' }, { key: 'ref_no', header: 'المرجع', render: (r) => r.ref_no ?? '—' }]

  return (
    <>
      <PageHeader title={bal.name} subtitle={bal.phone ?? ''}
        actions={<><Link to="/suppliers" className="btn border border-cream-400 bg-white text-brand-700"><ArrowRight className="h-4 w-4" /> رجوع</Link>
          <Link to={`/reports/supplier_statement`} className="btn border border-cream-400 bg-white text-brand-700"><FileText className="h-4 w-4" /> كشف الحساب</Link>
          {can('purchases', 'update') && <Button variant="gold" onClick={() => setOpen(true)}><Wallet className="h-4 w-4" /> تسجيل دفعة</Button>}</>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="إجمالي المشتريات" value={fmtMoney(bal.total_purchases)} icon={Receipt} />
        <StatCard label="المبلغ المدفوع" value={fmtMoney(bal.total_paid)} icon={Banknote} tone="green" />
        <StatCard label="المرتجعات" value={fmtMoney(bal.total_returns)} tone="blue" />
        <StatCard label="المبلغ المتبقي (للمورد)" value={fmtMoney(bal.balance)} icon={Wallet} tone="red" sub={`افتتاحي ${fmtMoney(bal.opening_balance)}`} />
      </div>
      <h3 className="mb-2 text-sm font-bold text-brand-700">فواتير الشراء</h3><DataTable columns={invCols} rows={inv} />
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div><h3 className="mb-2 text-sm font-bold text-brand-700">المدفوعات</h3><DataTable columns={payCols} rows={pays} /></div>
        <div><h3 className="mb-2 text-sm font-bold text-brand-700">مرتجعات المشتريات</h3>
          <DataTable columns={[{ key: 'return_no', header: 'الرقم', render: (r: any) => <b dir="ltr">{r.return_no}</b> }, { key: 'return_date', header: 'التاريخ', render: (r: any) => fmtDate(r.return_date) }, { key: 'total', header: 'القيمة', render: (r: any) => fmtMoney(r.total) }] as Column<any>[]} rows={rets} /></div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="تسجيل دفعة للمورد" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>إلغاء</Button><Button loading={busy} onClick={pay}>حفظ</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="الفاتورة (اختياري)" className="sm:col-span-2"><Select value={f.invoice_id} onChange={(e) => { const i = unpaid.find((x: any) => x.id === e.target.value); setF({ ...f, invoice_id: e.target.value, amount: i ? String(i.remaining) : f.amount }) }}>
            <option value="">دفعة على الحساب (بدون فاتورة)</option>{unpaid.map((i: any) => <option key={i.id} value={i.id}>{i.invoice_no} — متبقي {fmtMoney(i.remaining)}</option>)}</Select></Field>
          <Field label="المبلغ *"><Input type="number" min={0} step="any" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="التاريخ"><Input type="date" value={f.paid_at} onChange={(e) => setF({ ...f, paid_at: e.target.value })} /></Field>
          <Field label="طريقة الدفع"><Select value={f.payment_method_id} onChange={(e) => setF({ ...f, payment_method_id: e.target.value })}><option value="">— اختر —</option>{methods?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
          <Field label="رقم المرجع"><Input value={f.ref_no} onChange={(e) => setF({ ...f, ref_no: e.target.value })} /></Field>
        </div>
      </Modal>
    </>
  )
}
