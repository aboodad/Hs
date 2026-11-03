import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Paperclip, Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errMsg } from '@/lib/errors'
import { toast } from '@/store/toast.store'
import { useAuth } from '@/store/auth.store'
import { usePermission } from '@/hooks/usePermission'
import { useOpenShift, usePaymentMethods, useIncomeTypes } from '@/hooks/useLookups'
import { fmtDate, fmtMoney, toISODate } from '@/lib/formatters'
import { PageHeader } from '@/components/shared/PageHeader'
import { BranchSelect } from '@/components/shared/BranchSelect'
import { DataTable, type Column } from '@/components/data/DataTable'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { DropZone } from '@/components/ui/DropZone'

export default function OtherIncomePage() {
  const qc = useQueryClient()
  const { can, seesAllBranches } = usePermission()
  const profile = useAuth((s) => s.profile)
  const userId = useAuth((s) => s.session?.user.id)
  const { data: shift } = useOpenShift(userId)
  const { data: methods } = usePaymentMethods()
  const [branch, setBranch] = useState('')
  const [from, setFrom] = useState(toISODate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)))
  const [to, setTo] = useState(toISODate(new Date()))
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [form, setForm] = useState({ branch_id: '', income_type_id: '', amount: '', income_date: toISODate(new Date()), payment_method_id: '', description: '' })

  const { data: types } = useIncomeTypes()
  const { data, isLoading } = useQuery({
    queryKey: ['other-income', branch, from, to],
    queryFn: async () => {
      let q = supabase.from('other_incomes').select('*, type:income_types(name), branch:branches(name), method:payment_methods(name)')
        .gte('income_date', from).lte('income_date', to).order('income_date', { ascending: false }).limit(300)
      if (branch) q = q.eq('branch_id', branch)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })
  const total = (data ?? []).reduce((s, r) => s + Number(r.amount), 0)

  const save = async () => {
    const amount = Number(form.amount)
    const branch_id = form.branch_id || profile?.branch_id
    if (!form.income_type_id || !(amount > 0) || !branch_id) return toast.error('أكمل: النوع والمبلغ')
    setSaving(true)
    let attachment_url: string | null = null
    if (file) {
      const path = `income/${crypto.randomUUID()}-${file.name}`
      const up = await supabase.storage.from('attachments').upload(path, file)
      if (up.error) { setSaving(false); return toast.error(errMsg(up.error)) }
      attachment_url = path
    }
    const isCash = methods?.find((m) => m.id === form.payment_method_id)?.is_cash
    const { error } = await supabase.from('other_incomes').insert({
      income_type_id: form.income_type_id, branch_id, amount, income_date: form.income_date,
      payment_method_id: form.payment_method_id || null, description: form.description || null, attachment_url,
      shift_id: isCash && shift && shift.branch_id === branch_id ? shift.id : null,
    })
    setSaving(false)
    if (error) return toast.error(errMsg(error))
    toast.success('تم تسجيل الإيراد')
    setOpen(false); setFile(null); setForm({ ...form, amount: '', description: '' })
    qc.invalidateQueries({ queryKey: ['other-income'] })
  }

  const openAtt = async (path: string) => {
    const { data } = await supabase.storage.from('attachments').createSignedUrl(path, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  const cols: Column<any>[] = [
    { key: 'income_date', header: 'التاريخ', render: (r) => fmtDate(r.income_date) },
    { key: 'type', header: 'نوع الإيراد', render: (r) => r.type?.name },
    { key: 'branch', header: 'الفرع / الإدارة', render: (r) => r.branch?.name },
    { key: 'amount', header: 'القيمة', render: (r) => <b className="text-emerald-700">{fmtMoney(r.amount)}</b> },
    { key: 'method', header: 'طريقة الاستلام', render: (r) => r.method?.name ?? '—' },
    { key: 'description', header: 'البيان', render: (r) => r.description ?? '' },
    { key: 'att', header: '', render: (r) => r.attachment_url && <button className="text-gold-700" onClick={() => openAtt(r.attachment_url)}><Paperclip className="h-4 w-4" /></button> },
  ]

  return (
    <>
      <PageHeader title="الإيرادات الأخرى" subtitle={`الإجمالي في الفترة: ${fmtMoney(total)}`}
        actions={can('income', 'create') && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> إيراد جديد</Button>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        {seesAllBranches ? <BranchSelect includeAll value={branch} onChange={setBranch} /> : <div />}
      </div>
      <DataTable columns={cols} rows={data} loading={isLoading} />

      <Modal open={open} onClose={() => setOpen(false)} title="تسجيل إيراد" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>إلغاء</Button><Button loading={saving} onClick={save}>حفظ</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="نوع الإيراد *"><Select value={form.income_type_id} onChange={(e) => setForm({ ...form, income_type_id: e.target.value })}><option value="">— اختر —</option>{types?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
          <Field label="القيمة *"><Input type="number" min={0} step="any" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
          {seesAllBranches && <Field label="الفرع / الإدارة"><BranchSelect value={form.branch_id || profile?.branch_id || ''} onChange={(v) => setForm({ ...form, branch_id: v })} /></Field>}
          <Field label="التاريخ"><Input type="date" value={form.income_date} onChange={(e) => setForm({ ...form, income_date: e.target.value })} /></Field>
          <Field label="طريقة الاستلام"><Select value={form.payment_method_id} onChange={(e) => setForm({ ...form, payment_method_id: e.target.value })}><option value="">— اختر —</option>{methods?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
          <Field label="المرفق" className="sm:col-span-2"><DropZone value={file} onChange={setFile} accept="image/*,application/pdf" compact /></Field>
          <Field label="البيان" className="sm:col-span-2"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        </div>
      </Modal>
    </>
  )
}
