import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Paperclip, Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errMsg } from '@/lib/errors'
import { toast } from '@/store/toast.store'
import { useAuth } from '@/store/auth.store'
import { usePermission } from '@/hooks/usePermission'
import { useOpenShift, usePaymentMethods, useExpenseCategories } from '@/hooks/useLookups'
import { fmtDate, fmtMoney, toISODate } from '@/lib/formatters'
import { PageHeader } from '@/components/shared/PageHeader'
import { BranchSelect } from '@/components/shared/BranchSelect'
import { DataTable, type Column } from '@/components/data/DataTable'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { askConfirm } from '@/store/confirm.store'
import { DropZone } from '@/components/ui/DropZone'

export default function ExpensesPage() {
  const qc = useQueryClient()
  const { can, seesAllBranches } = usePermission()
  const profile = useAuth((s) => s.profile)
  const userId = useAuth((s) => s.session?.user.id)
  const { data: shift } = useOpenShift(userId)
  const { data: methods } = usePaymentMethods()
  const [branch, setBranch] = useState('')
  const [from, setFrom] = useState(toISODate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)))
  const [to, setTo] = useState(toISODate(new Date()))
  const [catFilter, setCatFilter] = useState('')
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ branch_id: '', category_id: '', amount: '', expense_date: toISODate(new Date()), payment_method_id: '', description: '' })
  const [file, setFile] = useState<File | null>(null)

  const { data: cats } = useExpenseCategories()

  const { data, isLoading } = useQuery({
    queryKey: ['expenses', 'list', branch, from, to, catFilter],
    queryFn: async () => {
      let q = supabase.from('expenses').select('*, branch:branches(name), category:expense_categories(name), method:payment_methods(name), person:employees!responsible_employee_id(full_name)')
        .gte('expense_date', from).lte('expense_date', to).order('expense_date', { ascending: false }).limit(300)
      if (branch) q = q.eq('branch_id', branch)
      if (catFilter) q = q.eq('category_id', catFilter)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const total = (data ?? []).filter((r) => r.status === 'posted').reduce((s, r) => s + Number(r.amount), 0)

  const save = async () => {
    const amount = Number(form.amount)
    const branch_id = form.branch_id || profile?.branch_id
    if (!form.category_id || !(amount > 0) || !branch_id) return toast.error('أكمل: النوع والمبلغ والفرع')
    setSaving(true)
    let attachment_url: string | null = null
    if (file) {
      const path = `expenses/${crypto.randomUUID()}-${file.name}`
      const up = await supabase.storage.from('attachments').upload(path, file)
      if (up.error) { setSaving(false); return toast.error(errMsg(up.error)) }
      attachment_url = path
    }
    const isCash = methods?.find((m) => m.id === form.payment_method_id)?.is_cash
    const { error } = await supabase.from('expenses').insert({
      branch_id, category_id: form.category_id, amount, expense_date: form.expense_date,
      payment_method_id: form.payment_method_id || null, description: form.description || null, attachment_url,
      responsible_employee_id: profile?.employee_id ?? null,
      shift_id: isCash && shift && shift.branch_id === branch_id ? shift.id : null, // يُخصم من صندوق الوردية
    })
    setSaving(false)
    if (error) return toast.error(errMsg(error))
    toast.success('تم تسجيل المصروف')
    setOpen(false); setFile(null)
    setForm({ ...form, amount: '', description: '' })
    qc.invalidateQueries({ queryKey: ['expenses'] })
  }

  const cancel = async (id: string) => {
    if (!(await askConfirm({ title: 'إلغاء هذا المصروف؟', description: 'سيُستبعد من التقارير والأرباح.', confirmLabel: 'ألغِ المصروف', tone: 'danger', hold: true }))) return
    const { error } = await supabase.from('expenses').update({ status: 'cancelled' }).eq('id', id)
    if (error) return toast.error(errMsg(error))
    qc.invalidateQueries({ queryKey: ['expenses'] })
  }

  const openAttachment = async (path: string) => {
    const { data } = await supabase.storage.from('attachments').createSignedUrl(path, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  const cols: Column<any>[] = [
    { key: 'expense_date', header: 'التاريخ', render: (r) => fmtDate(r.expense_date) },
    { key: 'category', header: 'النوع', render: (r) => r.category?.name },
    { key: 'branch', header: 'الفرع', render: (r) => r.branch?.name },
    { key: 'amount', header: 'المبلغ', render: (r) => <b>{fmtMoney(r.amount)}</b> },
    { key: 'method', header: 'طريقة الدفع', render: (r) => r.method?.name ?? '—' },
    { key: 'person', header: 'المسؤول', render: (r) => r.person?.full_name ?? '—' },
    { key: 'description', header: 'الوصف', render: (r) => r.description ?? '' },
    { key: 'att', header: '', render: (r) => r.attachment_url && <button className="text-brand-700" onClick={() => openAttachment(r.attachment_url)}><Paperclip className="h-4 w-4" /></button> },
    { key: 'status', header: 'الحالة', render: (r) => (r.status === 'posted'
        ? (can('expenses', 'cancel') ? <button className="text-xs text-red-600 underline" onClick={() => cancel(r.id)}>إلغاء</button> : <Badge tone="green">مسجل</Badge>)
        : <Badge tone="gray">ملغى</Badge>) },
  ]

  return (
    <>
      <PageHeader title="المصروفات" subtitle={`الإجمالي في الفترة: ${fmtMoney(total)}`}
        actions={can('expenses', 'create') && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> مصروف جديد</Button>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        {seesAllBranches ? <BranchSelect includeAll value={branch} onChange={setBranch} /> : <div />}
        <Select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}><option value="">كل الأنواع</option>{cats?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
      </div>
      <DataTable columns={cols} rows={data} loading={isLoading} />

      <Modal open={open} onClose={() => setOpen(false)} title="تسجيل مصروف" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>إلغاء</Button><Button loading={saving} onClick={save}>حفظ</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="نوع المصروف *"><Select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}><option value="">— اختر —</option>{cats?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="المبلغ *"><Input type="number" min={0} step="any" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
          {seesAllBranches && <Field label="الفرع *"><BranchSelect value={form.branch_id || profile?.branch_id || ''} onChange={(v) => setForm({ ...form, branch_id: v })} /></Field>}
          <Field label="التاريخ"><Input type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} /></Field>
          <Field label="طريقة الدفع"><Select value={form.payment_method_id} onChange={(e) => setForm({ ...form, payment_method_id: e.target.value })}><option value="">— اختر —</option>{methods?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
          <Field label="مرفق / صورة السند" className="sm:col-span-2"><DropZone value={file} onChange={setFile} accept="image/*,application/pdf" compact /></Field>
          <Field label="الوصف" className="sm:col-span-2"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        </div>
        {shift && <p className="mt-3 text-xs text-stone-500">المصروف النقدي يُخصم تلقائياً من صندوق وردية الفرع المفتوحة.</p>}
      </Modal>
    </>
  )
}
