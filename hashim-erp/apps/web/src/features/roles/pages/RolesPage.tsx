import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Save, ShieldCheck } from 'lucide-react'
import clsx from 'clsx'
import { supabase } from '@/lib/supabase'
import { errMsg } from '@/lib/errors'
import { toast } from '@/store/toast.store'
import { usePermission } from '@/hooks/usePermission'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Field, Input } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Spinner'

const ACTIONS: [string, string][] = [['view', 'عرض'], ['create', 'إضافة'], ['update', 'تعديل'], ['delete', 'حذف'], ['print', 'طباعة'], ['export', 'تصدير'], ['approve', 'اعتماد'], ['cancel', 'إلغاء']]
const MODULES: Record<string, string> = {
  dashboard: 'لوحة التحكم', products: 'المنتجات', categories: 'التصنيفات', inventory: 'المخزون', pricing: 'التسعيرة', requests: 'طلبات البضاعة', transfers: 'التحويلات', stock_counts: 'الجرد', damaged: 'التالف',
  suppliers: 'الموردون', purchases: 'المشتريات', pos: 'نقطة البيع', sales: 'الفواتير', customers: 'العملاء', returns: 'المرتجعات', exchanges: 'الاستبدال', shifts: 'الورديات',
  expenses: 'المصروفات', income: 'الإيرادات الأخرى', cashbox: 'الصندوق', branch_accounts: 'حسابات الفروع', taxes: 'الضرائب', profit_loss: 'الأرباح والخسائر', accounting: 'المحاسبة',
  employees: 'الموظفون', payroll: 'الرواتب', commissions: 'العمولات', reports: 'التقارير', branches: 'الفروع', users: 'المستخدمون', roles: 'الأدوار', audit: 'سجل العمليات', settings: 'الإعدادات',
}

export default function RolesPage() {
  const qc = useQueryClient()
  const { can } = usePermission()
  const [roleId, setRoleId] = useState('')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [original, setOriginal] = useState<Set<string>>(new Set())
  const [newOpen, setNewOpen] = useState(false)
  const [nr, setNr] = useState({ code: '', name: '', description: '' })
  const [busy, setBusy] = useState(false)
  const canEdit = can('roles', 'update')

  const { data: roles } = useQuery({ queryKey: ['roles'], queryFn: async () => (await supabase.from('roles').select('*').order('created_at')).data ?? [] })
  const { data: perms } = useQuery({ queryKey: ['permissions'], queryFn: async () => (await supabase.from('permissions').select('id,module,action')).data ?? [] })
  const { data: rp } = useQuery({
    queryKey: ['role-permissions', roleId], enabled: !!roleId,
    queryFn: async () => (await supabase.from('role_permissions').select('permission_id').eq('role_id', roleId)).data ?? [],
  })

  useEffect(() => { if (!roleId && roles?.length) setRoleId(roles[0].id) }, [roles, roleId])
  useEffect(() => { const s = new Set((rp ?? []).map((r: any) => r.permission_id as string)); setChecked(s); setOriginal(new Set(s)) }, [rp])

  const role = roles?.find((r) => r.id === roleId)
  const idOf = useMemo(() => { const m = new Map<string, string>(); perms?.forEach((p) => m.set(`${p.module}:${p.action}`, p.id)); return m }, [perms])
  const locked = role?.code === 'super_admin'   // مدير النظام يملك كل شيء دائماً

  const toggle = (id: string | undefined) => {
    if (!id || !canEdit || locked) return
    const s = new Set(checked); s.has(id) ? s.delete(id) : s.add(id); setChecked(s)
  }
  const toggleRow = (m: string) => {
    if (!canEdit || locked) return
    const ids = ACTIONS.map(([a]) => idOf.get(`${m}:${a}`)).filter(Boolean) as string[]
    const all = ids.every((i) => checked.has(i)); const s = new Set(checked); ids.forEach((i) => (all ? s.delete(i) : s.add(i))); setChecked(s)
  }
  const toggleCol = (a: string) => {
    if (!canEdit || locked) return
    const ids = Object.keys(MODULES).map((m) => idOf.get(`${m}:${a}`)).filter(Boolean) as string[]
    const all = ids.every((i) => checked.has(i)); const s = new Set(checked); ids.forEach((i) => (all ? s.delete(i) : s.add(i))); setChecked(s)
  }

  const dirty = checked.size !== original.size || [...checked].some((i) => !original.has(i))

  const save = async () => {
    setBusy(true)
    const add = [...checked].filter((i) => !original.has(i)), del = [...original].filter((i) => !checked.has(i))
    if (add.length) { const { error } = await supabase.from('role_permissions').insert(add.map((permission_id) => ({ role_id: roleId, permission_id }))); if (error) { setBusy(false); return toast.error(errMsg(error)) } }
    if (del.length) { const { error } = await supabase.from('role_permissions').delete().eq('role_id', roleId).in('permission_id', del); if (error) { setBusy(false); return toast.error(errMsg(error)) } }
    setBusy(false); toast.success('تم حفظ الصلاحيات (تسري عند إعادة دخول المستخدمين)')
    qc.invalidateQueries({ queryKey: ['role-permissions', roleId] })
  }

  const createRole = async () => {
    if (!nr.code || !nr.name) return toast.error('الرمز والاسم مطلوبان')
    const { data, error } = await supabase.from('roles').insert({ code: nr.code.trim().toLowerCase(), name: nr.name, description: nr.description || null }).select('id').single()
    if (error) return toast.error(errMsg(error))
    toast.success('تم إنشاء الدور'); setNewOpen(false); setNr({ code: '', name: '', description: '' }); qc.invalidateQueries({ queryKey: ['roles'] }); setRoleId(data.id)
  }

  if (!roles || !perms) return <Spinner />

  return (
    <>
      <PageHeader title="الأدوار والصلاحيات" subtitle="تحكّم لكل دور في صلاحيات كل قسم"
        actions={<>
          {can('roles', 'create') && <Button variant="secondary" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" /> دور جديد</Button>}
          {canEdit && !locked && <Button variant="gold" disabled={!dirty} loading={busy} onClick={save}><Save className="h-4 w-4" /> حفظ التغييرات</Button>}
        </>} />

      <div className="mb-5 flex flex-wrap gap-2">
        {roles.map((r) => (
          <button key={r.id} onClick={() => setRoleId(r.id)}
            className={clsx('flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition', roleId === r.id ? 'border-gold-500 bg-gradient-to-br from-gold-50 to-cream-100 text-brand-800 shadow-gold' : 'border-cream-300 bg-white text-brand-500 hover:border-gold-300')}>
            <ShieldCheck className="h-4 w-4" /> {r.name}
          </button>
        ))}
      </div>
      {locked && <div className="mb-4 rounded-xl border border-gold-300 bg-gold-50 p-3 text-sm text-gold-800">مدير النظام يملك كل الصلاحيات دائماً ولا يمكن تقييده.</div>}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-cream-200 text-xs text-brand-700"><tr>
            <th className="px-4 py-3 text-start">القسم</th>
            {ACTIONS.map(([a, l]) => <th key={a} className="px-3 py-3 text-center"><button className="font-semibold hover:text-gold-700" onClick={() => toggleCol(a)}>{l}</button></th>)}</tr></thead>
          <tbody className="divide-y divide-cream-200">
            {Object.entries(MODULES).map(([m, label]) => (
              <tr key={m} className="hover:bg-cream-50">
                <td className="px-4 py-2"><button className="font-semibold text-brand-700 hover:text-gold-700" onClick={() => toggleRow(m)}>{label}</button></td>
                {ACTIONS.map(([a]) => {
                  const id = idOf.get(`${m}:${a}`)
                  return <td key={a} className="px-3 py-2 text-center">{id
                    ? <input type="checkbox" className="h-[18px] w-[18px] accent-brand-700" disabled={!canEdit || locked} checked={locked || checked.has(id)} onChange={() => toggle(id)} />
                    : <span className="text-brand-200">—</span>}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="دور جديد" size="sm" footer={<><Button variant="secondary" onClick={() => setNewOpen(false)}>إلغاء</Button><Button onClick={createRole}>إنشاء</Button></>}>
        <div className="space-y-4">
          <Field label="الاسم *"><Input value={nr.name} onChange={(e) => setNr({ ...nr, name: e.target.value })} /></Field>
          <Field label="الرمز (إنجليزي) *" hint="مثال: supervisor"><Input dir="ltr" value={nr.code} onChange={(e) => setNr({ ...nr, code: e.target.value })} /></Field>
          <Field label="الوصف"><Input value={nr.description} onChange={(e) => setNr({ ...nr, description: e.target.value })} /></Field>
          <p className="text-xs text-brand-300">بعد الإنشاء حدّد صلاحياته من الجدول. لجعل الدور يرى كل الفروع غيّر `all_branches` من قاعدة البيانات.</p>
        </div>
      </Modal>
    </>
  )
}
