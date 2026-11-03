import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errMsg } from '@/lib/errors'
import { toast } from '@/store/toast.store'
import { usePermission } from '@/hooks/usePermission'
import { usePaymentMethods } from '@/hooks/useLookups'
import { fmtDate, fmtMoney, toISODate } from '@/lib/formatters'
import { APPROVAL_STATUS } from '@/lib/status'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatCard } from '@/components/shared/StatCard'
import { DataTable, type Column } from '@/components/data/DataTable'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Scale, Truck, Banknote } from 'lucide-react'
import { DropZone } from '@/components/ui/DropZone'

export default function BranchAccountsPage() {
  const qc = useQueryClient()
  const { can } = usePermission()
  const { data: methods } = usePaymentMethods()
  const [selected, setSelected] = useState('')
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ branch_id: '', amount: '', settlement_date: toISODate(new Date()), payment_method_id: '', ref_no: '', note: '' })
  const [file, setFile] = useState<File | null>(null)

  const { data: balances, isLoading } = useQuery({
    queryKey: ['branch-balance'],
    queryFn: async () => (await supabase.from('v_branch_balance').select('*').order('branch_name')).data ?? [],
  })

  const { data: ledger } = useQuery({
    queryKey: ['branch-ledger', selected], enabled: !!selected,
    queryFn: async () => (await supabase.from('branch_ledger').select('*').eq('branch_id', selected).order('created_at', { ascending: false }).limit(100)).data ?? [],
  })
  const { data: settlements } = useQuery({
    queryKey: ['branch-settlements', selected],
    queryFn: async () => {
      let q = supabase.from('branch_settlements').select('*, branch:branches(name), method:payment_methods(name)').order('settlement_date', { ascending: false }).limit(100)
      if (selected) q = q.eq('branch_id', selected)
      return (await q).data ?? []
    },
  })

  const totalDue = (balances ?? []).reduce((s, b) => s + Number(b.balance), 0)
  const totalIn = (balances ?? []).reduce((s, b) => s + Number(b.goods_received), 0)
  const totalSet = (balances ?? []).reduce((s, b) => s + Number(b.settled), 0)

  const save = async () => {
    const amount = Number(form.amount)
    if (!form.branch_id || !(amount > 0)) return toast.error('اختر الفرع وأدخل المبلغ')
    setSaving(true)
    let attachment_url: string | null = null
    if (file) {
      const path = `settlements/${crypto.randomUUID()}-${file.name}`
      const up = await supabase.storage.from('attachments').upload(path, file)
      if (up.error) { setSaving(false); return toast.error(errMsg(up.error)) }
      attachment_url = path
    }
    const { error } = await supabase.from('branch_settlements').insert({
      branch_id: form.branch_id, amount, settlement_date: form.settlement_date, payment_method_id: form.payment_method_id || null,
      ref_no: form.ref_no || null, note: form.note || null, attachment_url,
      status: can('branch_accounts', 'approve') ? 'approved' : 'pending', // الاعتماد المباشر لمن يملك الصلاحية
    })
    setSaving(false)
    if (error) return toast.error(errMsg(error))
    toast.success('تم تسجيل التسوية')
    setOpen(false); setFile(null)
    qc.invalidateQueries({ queryKey: ['branch-balance'] }); qc.invalidateQueries({ queryKey: ['branch-settlements'] }); qc.invalidateQueries({ queryKey: ['branch-ledger'] })
  }

  const approve = async (id: string) => {
    const { error } = await supabase.from('branch_settlements').update({ status: 'approved' }).eq('id', id)
    if (error) return toast.error(errMsg(error))
    toast.success('تم الاعتماد')
    qc.invalidateQueries({ queryKey: ['branch-balance'] }); qc.invalidateQueries({ queryKey: ['branch-settlements'] })
  }

  const balCols: Column<any>[] = [
    { key: 'branch_name', header: 'الفرع' },
    { key: 'goods_received', header: 'البضاعة المستلمة', render: (r) => fmtMoney(r.goods_received) },
    { key: 'settled', header: 'المسدد للإدارة', render: (r) => fmtMoney(r.settled) },
    { key: 'balance', header: 'الرصيد الحالي', render: (r) => <b className={Number(r.balance) > 0 ? 'text-red-600' : 'text-emerald-700'}>{fmtMoney(r.balance)}</b> },
  ]
  const setCols: Column<any>[] = [
    { key: 'settlement_date', header: 'التاريخ', render: (r) => fmtDate(r.settlement_date) },
    { key: 'branch', header: 'الفرع', render: (r) => r.branch?.name },
    { key: 'amount', header: 'المبلغ', render: (r) => <b>{fmtMoney(r.amount)}</b> },
    { key: 'method', header: 'الطريقة', render: (r) => r.method?.name ?? '—' },
    { key: 'ref_no', header: 'المرجع', render: (r) => r.ref_no ?? '—' },
    { key: 'status', header: 'الحالة', render: (r) => (r.status === 'pending' && can('branch_accounts', 'approve')
        ? <Button size="sm" variant="success" onClick={() => approve(r.id)}>اعتماد</Button> : <StatusBadge map={APPROVAL_STATUS} value={r.status} />) },
  ]

  return (
    <>
      <PageHeader title="حسابات الفروع والتسويات" subtitle="الرصيد = البضاعة المستلمة (بسعر الجملة) − المبالغ المسددة للإدارة"
        actions={can('branch_accounts', 'create') && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> تسجيل تسوية</Button>} />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="بضاعة مستلمة" value={fmtMoney(totalIn)} icon={Truck} tone="blue" />
        <StatCard label="مسدد للإدارة" value={fmtMoney(totalSet)} icon={Banknote} tone="green" />
        <StatCard label="المستحق على الفروع" value={fmtMoney(totalDue)} icon={Scale} tone="red" />
      </div>
      <h3 className="mb-2 text-sm font-bold">أرصدة الفروع <span className="font-normal text-stone-400">(اضغط على فرع لعرض كشف حسابه)</span></h3>
      <DataTable columns={balCols} rows={balances} loading={isLoading} rowKey={(r) => r.branch_id} onRowClick={(r) => setSelected(selected === r.branch_id ? '' : r.branch_id)} />

      {selected && (
        <>
          <h3 className="mb-2 mt-6 text-sm font-bold">كشف حساب الفرع</h3>
          <DataTable columns={[
            { key: 'entry_date', header: 'التاريخ', render: (r: any) => fmtDate(r.entry_date) },
            { key: 'entry_type', header: 'البيان', render: (r: any) => ({ goods_received: 'بضاعة مستلمة', goods_returned: 'بضاعة مرتجعة', settlement: 'تسوية', adjustment: 'تعديل' } as any)[r.entry_type] },
            { key: 'debit', header: 'عليه', render: (r: any) => (Number(r.debit) ? fmtMoney(r.debit) : '—') },
            { key: 'credit', header: 'له', render: (r: any) => (Number(r.credit) ? fmtMoney(r.credit) : '—') },
          ]} rows={ledger} />
        </>
      )}

      <h3 className="mb-2 mt-6 text-sm font-bold">التسويات</h3>
      <DataTable columns={setCols} rows={settlements} />

      <Modal open={open} onClose={() => setOpen(false)} title="تسجيل تسوية" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>إلغاء</Button><Button loading={saving} onClick={save}>حفظ</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="الفرع *"><Select value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}><option value="">— اختر —</option>{balances?.map((b) => <option key={b.branch_id} value={b.branch_id}>{b.branch_name}</option>)}</Select></Field>
          <Field label="المبلغ *"><Input type="number" min={0} step="any" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
          <Field label="التاريخ"><Input type="date" value={form.settlement_date} onChange={(e) => setForm({ ...form, settlement_date: e.target.value })} /></Field>
          <Field label="طريقة الدفع"><Select value={form.payment_method_id} onChange={(e) => setForm({ ...form, payment_method_id: e.target.value })}><option value="">— اختر —</option>{methods?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
          <Field label="رقم المرجع"><Input value={form.ref_no} onChange={(e) => setForm({ ...form, ref_no: e.target.value })} /></Field>
          <Field label="المرفق" className="sm:col-span-2"><DropZone value={file} onChange={setFile} accept="image/*,application/pdf" compact /></Field>
          <Field label="ملاحظات" className="sm:col-span-2"><Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
        </div>
      </Modal>
    </>
  )
}
