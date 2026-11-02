import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Pencil, Plus, Power } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errMsg } from '@/lib/errors'
import { toast } from '@/store/toast.store'
import { useAuth } from '@/store/auth.store'
import { usePermission } from '@/hooks/usePermission'
import { fmtDateTime } from '@/lib/formatters'
import { PageHeader } from '@/components/shared/PageHeader'
import { DataTable, type Column } from '@/components/data/DataTable'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Field, Input, Select } from '@/components/ui/Field'
import { askConfirm } from '@/store/confirm.store'

// الإنشاء وإعادة التعيين والإيقاف تمر عبر Edge Function (manage-user) لأنها تحتاج مفتاح service_role
async function callManage(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('manage-user', { body })
  if (error) {
    let msg = error.message
    try { const j = await (error as any).context?.json?.(); if (j?.error) msg = j.error } catch { /* تجاهل */ }
    throw new Error(msg)
  }
  if ((data as any)?.error) throw new Error((data as any).error)
  return data
}

export default function UsersPage() {
  const qc = useQueryClient()
  const { can } = usePermission()
  const me = useAuth((s) => s.session?.user.id)
  const [modal, setModal] = useState<null | 'create' | 'edit'>(null)
  const [pwFor, setPwFor] = useState<any | null>(null)
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const empty = { id: '', username: '', password: '', full_name: '', phone: '', role_id: '', branch_id: '', employee_id: '' }
  const [f, setF] = useState(empty)

  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*, role:roles(name,code), branch:branches(name)').order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })
  const { data: lk } = useQuery({
    queryKey: ['users-lookups'],
    queryFn: async () => {
      const [r, b, e] = await Promise.all([
        supabase.from('roles').select('id,name').order('name'), supabase.from('branches').select('id,name').eq('is_active', true).order('name'),
        supabase.from('employees').select('id,full_name').eq('status', 'active').order('full_name')])
      return { roles: r.data ?? [], branches: b.data ?? [], employees: e.data ?? [] }
    },
  })

  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] })
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }))

  const save = async () => {
    if (!f.full_name || !f.role_id || !f.branch_id) return toast.error('أكمل: الاسم والدور والفرع')
    setBusy(true)
    try {
      if (modal === 'create') {
        if (!f.username || f.password.length < 6) throw new Error('اسم المستخدم وكلمة مرور (6+ أحرف) مطلوبان')
        await callManage({ action: 'create', username: f.username, password: f.password, full_name: f.full_name, role_id: f.role_id, branch_id: f.branch_id, employee_id: f.employee_id || null, phone: f.phone || null })
      } else {
        const { error } = await supabase.from('profiles').update({ full_name: f.full_name, role_id: f.role_id, branch_id: f.branch_id, employee_id: f.employee_id || null, phone: f.phone || null }).eq('id', f.id)
        if (error) throw error
      }
      toast.success('تم الحفظ'); setModal(null); refresh()
    } catch (e) { toast.error(errMsg(e)) } finally { setBusy(false) }
  }

  const toggle = async (u: any) => {
    if (!(await askConfirm({ title: u.is_active ? 'إيقاف هذا الحساب؟' : 'تفعيل هذا الحساب؟', description: u.is_active ? 'لن يتمكن المستخدم من تسجيل الدخول.' : undefined, confirmLabel: u.is_active ? 'أوقف الحساب' : 'فعّل الحساب', tone: u.is_active ? 'danger' : 'brand', hold: u.is_active }))) return
    try { await callManage({ action: 'set_active', user_id: u.id, active: !u.is_active }); toast.success('تم التحديث'); refresh() } catch (e) { toast.error(errMsg(e)) }
  }
  const resetPw = async () => {
    setBusy(true)
    try { await callManage({ action: 'reset_password', user_id: pwFor.id, password: pw }); toast.success('تم تغيير كلمة المرور'); setPwFor(null); setPw('') }
    catch (e) { toast.error(errMsg(e)) } finally { setBusy(false) }
  }

  const cols: Column<any>[] = [
    { key: 'full_name', header: 'المستخدم', render: (u) => <div><b>{u.full_name}</b><div className="text-xs text-brand-300" dir="ltr">{u.username ?? u.phone ?? ''}</div></div> },
    { key: 'role', header: 'الدور', render: (u) => <Badge tone="amber">{u.role?.name}</Badge> },
    { key: 'branch', header: 'الفرع', render: (u) => u.branch?.name },
    { key: 'is_active', header: 'الحالة', render: (u) => <Badge tone={u.is_active ? 'green' : 'gray'}>{u.is_active ? 'نشط' : 'موقوف'}</Badge> },
    { key: 'last_login_at', header: 'آخر دخول', render: (u) => fmtDateTime(u.last_login_at) },
    { key: '_a', header: '', render: (u) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          {can('users', 'update') && <Button size="sm" variant="ghost" title="تعديل" onClick={() => { setF({ ...empty, id: u.id, username: u.username ?? '', full_name: u.full_name, phone: u.phone ?? '', role_id: u.role_id, branch_id: u.branch_id, employee_id: u.employee_id ?? '' }); setModal('edit') }}><Pencil className="h-4 w-4" /></Button>}
          {can('users', 'update') && <Button size="sm" variant="ghost" title="إعادة تعيين كلمة المرور" onClick={() => setPwFor(u)}><KeyRound className="h-4 w-4" /></Button>}
          {can('users', 'update') && u.id !== me && <Button size="sm" variant="ghost" title={u.is_active ? 'إيقاف' : 'تفعيل'} onClick={() => toggle(u)}><Power className={u.is_active ? 'h-4 w-4 text-red-500' : 'h-4 w-4 text-emerald-600'} /></Button>}
        </div>) },
  ]

  return (
    <>
      <PageHeader title="المستخدمون" subtitle="حسابات الدخول وأدوارها وفروعها"
        actions={can('users', 'create') && <Button onClick={() => { setF(empty); setModal('create') }}><Plus className="h-4 w-4" /> مستخدم جديد</Button>} />
      <DataTable columns={cols} rows={data} loading={isLoading} />

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal === 'create' ? 'مستخدم جديد' : 'تعديل مستخدم'}
        footer={<><Button variant="secondary" onClick={() => setModal(null)}>إلغاء</Button><Button loading={busy} onClick={save}>حفظ</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="الاسم الكامل *"><Input value={f.full_name} onChange={(e) => set('full_name', e.target.value)} /></Field>
          <Field label="الهاتف"><Input dir="ltr" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          {modal === 'create' && <>
            <Field label="اسم المستخدم *" hint="يُحوَّل داخلياً إلى username@hashim.local"><Input dir="ltr" value={f.username} onChange={(e) => set('username', e.target.value)} /></Field>
            <Field label="كلمة المرور *" hint="6 أحرف على الأقل"><Input type="password" value={f.password} onChange={(e) => set('password', e.target.value)} /></Field></>}
          <Field label="الدور *"><Select value={f.role_id} onChange={(e) => set('role_id', e.target.value)}><option value="">— اختر —</option>{lk?.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
          <Field label="الفرع *"><Select value={f.branch_id} onChange={(e) => set('branch_id', e.target.value)}><option value="">— اختر —</option>{lk?.branches.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
          <Field label="الموظف المرتبط" className="sm:col-span-2" hint="يُربط حساب البائع بملفه (للعمولات)"><Select value={f.employee_id} onChange={(e) => set('employee_id', e.target.value)}><option value="">— بدون —</option>{lk?.employees.map((r) => <option key={r.id} value={r.id}>{r.full_name}</option>)}</Select></Field>
        </div>
      </Modal>

      <Modal open={!!pwFor} onClose={() => setPwFor(null)} title={`كلمة مرور جديدة: ${pwFor?.full_name ?? ''}`} size="sm"
        footer={<><Button variant="secondary" onClick={() => setPwFor(null)}>إلغاء</Button><Button loading={busy} onClick={resetPw}>تغيير</Button></>}>
        <Field label="كلمة المرور الجديدة"><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      </Modal>
    </>
  )
}
