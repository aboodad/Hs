import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Printer } from 'lucide-react'
import clsx from 'clsx'
import { supabase } from '@/lib/supabase'
import { errMsg } from '@/lib/errors'
import { toast } from '@/store/toast.store'
import { usePermission } from '@/hooks/usePermission'
import { useSetting } from '@/hooks/useLookups'
import { fmtMoney, toISODate } from '@/lib/formatters'
import { PageHeader } from '@/components/shared/PageHeader'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Tabs } from '@/components/ui/Tabs'
import { Spinner } from '@/components/ui/Spinner'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { useAccountMappings, useAccounts, useReportRpc } from '../hooks'
import { AccountSelect } from '../components/AccountSelect'
import { buildTree, flatten, isDebitNormal, rollup, TYPE_LABEL, type Account, type AccountType } from '../lib'

const EMPTY = { code: '', name: '', parent_id: '', account_type: 'asset' as AccountType, is_group: false, is_active: true, note: '' }

export default function ChartOfAccountsPage() {
  const qc = useQueryClient()
  const { can } = usePermission()
  const [tab, setTab] = useState<'tree' | 'map'>('tree')
  const { data: accounts, isLoading } = useAccounts()
  const today = toISODate(new Date())
  const { data: tb } = useReportRpc<any>([today], 'fn_trial_balance', { p_from: '1900-01-01', p_to: today, p_branch: null })
  const [edit, setEdit] = useState<Account | null>(null)
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)

  const tree = useMemo(() => buildTree(accounts ?? []), [accounts])
  const rows = useMemo(() => flatten(tree), [tree])
  const bal = useMemo(() => {
    const m = new Map<string, number>((tb ?? []).map((r: any) => [r.account_id, Number(r.closing)]))
    return rollup(tree, (id) => m.get(id) ?? 0)   // مدين − دائن
  }, [tb, tree])
  const groups = (accounts ?? []).filter((a) => a.is_group)

  const openForm = (a?: Account, parent?: Account) => {
    setEdit(a ?? null)
    setF(a ? { code: a.code, name: a.name, parent_id: a.parent_id ?? '', account_type: a.account_type, is_group: a.is_group, is_active: a.is_active, note: a.note ?? '' }
      : { ...EMPTY, parent_id: parent?.id ?? '', account_type: parent?.account_type ?? 'asset', code: parent ? parent.code : '' })
    setOpen(true)
  }
  const onParent = (id: string) => {
    const p = groups.find((g) => g.id === id)
    setF((s) => ({ ...s, parent_id: id, account_type: p?.account_type ?? s.account_type }))
  }
  const save = async () => {
    if (!f.code.trim() || !f.name.trim()) return toast.error('الرمز والاسم مطلوبان')
    setSaving(true)
    const payload = { code: f.code.trim(), name: f.name.trim(), parent_id: f.parent_id || null, account_type: f.account_type, is_group: f.is_group, is_active: f.is_active, note: f.note || null }
    const res = edit ? await supabase.from('accounts').update(payload).eq('id', edit.id) : await supabase.from('accounts').insert(payload)
    setSaving(false)
    if (res.error) return toast.error(errMsg(res.error))
    toast.success('تم الحفظ'); setOpen(false); qc.invalidateQueries({ queryKey: ['accounts'] })
  }

  return (
    <>
      <PageHeader title="الدليل المحاسبي" subtitle="شجرة الحسابات وإعدادات الترحيل التلقائي"
        actions={<>
          <Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" /> طباعة</Button>
          {can('accounting', 'create') && <Button onClick={() => openForm()}><Plus className="h-4 w-4" /> حساب جديد</Button>}
        </>} />
      <Tabs tabs={[['tree', 'شجرة الحسابات'], ['map', 'إعدادات الترحيل']] as const} value={tab} onChange={setTab} />

      {tab === 'map' ? <MappingsTab canEdit={can('accounting', 'approve')} /> : isLoading ? <Spinner /> : (
        <div className="card fade-up overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-cream-100 text-xs text-brand-700">
              <tr><th className="px-4 py-3 text-start">الرمز</th><th className="px-4 py-3 text-start">الحساب</th><th className="px-4 py-3 text-start">النوع</th>
                <th className="px-4 py-3 text-start">الرصيد</th><th className="px-4 py-3 text-start">الحالة</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-cream-200">
              {rows.map((a) => {
                const v = bal.get(a.id) ?? 0
                const natural = isDebitNormal(a.account_type) ? v : -v
                return (
                  <tr key={a.id} className={clsx('hover:bg-cream-50', a.is_group && 'bg-cream-50 font-bold')}>
                    <td className="px-4 py-2.5 font-mono text-xs" dir="ltr">{a.code}</td>
                    <td className="px-4 py-2.5" style={{ paddingInlineStart: 16 + a.depth * 22 }}>{a.name}</td>
                    <td className="px-4 py-2.5 text-brand-500">{TYPE_LABEL[a.account_type]}</td>
                    <td className={clsx('px-4 py-2.5', natural < 0 && 'text-red-600')} dir="ltr">{fmtMoney(natural)}</td>
                    <td className="px-4 py-2.5">{a.is_active ? <Badge tone="green">نشط</Badge> : <Badge>موقوف</Badge>}</td>
                    <td className="px-4 py-2.5 text-end">
                      {a.is_group && can('accounting', 'create') && <Button size="sm" variant="ghost" onClick={() => openForm(undefined, a)}><Plus className="h-4 w-4" /></Button>}
                      {can('accounting', 'update') && <Button size="sm" variant="ghost" onClick={() => openForm(a)}><Pencil className="h-4 w-4" /></Button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={edit ? 'تعديل حساب' : 'حساب جديد'}
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>إلغاء</Button><Button loading={saving} onClick={save}>حفظ</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="الرمز *" hint="الحساب الفرعي يبدأ برمز أبيه"><Input dir="ltr" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} disabled={!!edit?.is_system} /></Field>
          <Field label="اسم الحساب *"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="الحساب الأب">
            <Select value={f.parent_id} onChange={(e) => onParent(e.target.value)}>
              <option value="">— بدون (مستوى أول) —</option>
              {groups.filter((g) => g.id !== edit?.id).map((g) => <option key={g.id} value={g.id}>{g.code} — {g.name}</option>)}
            </Select>
          </Field>
          <Field label="النوع"><Select value={f.account_type} disabled={!!f.parent_id || !!edit?.is_system} onChange={(e) => setF({ ...f, account_type: e.target.value as AccountType })}>
            {(Object.keys(TYPE_LABEL) as AccountType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</Select></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5 accent-brand-700" checked={f.is_group} disabled={!!edit?.is_system} onChange={(e) => setF({ ...f, is_group: e.target.checked })} /> حساب رئيسي (تجميعي، لا تُسجَّل عليه قيود)</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5 accent-brand-700" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> نشط</label>
          <Field label="ملاحظات" className="sm:col-span-2"><Textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        </div>
      </Modal>
    </>
  )
}

function MappingsTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient()
  const { data, isLoading } = useAccountMappings()
  const lock = useSetting<{ value?: string }>('accounting.lock_date', {})
  const [lockDate, setLockDate] = useState<string | null>(null)
  const shown = lockDate ?? lock.data?.value ?? ''

  const change = async (key: string, account_id: string) => {
    if (!account_id) return
    const { error } = await supabase.from('account_mappings').update({ account_id }).eq('key', key)
    if (error) return toast.error(errMsg(error))
    toast.success('تم تحديث الربط'); qc.invalidateQueries({ queryKey: ['account-mappings'] })
  }
  const saveLock = async () => {
    const { error } = await supabase.rpc('fn_set_accounting_lock', { p_date: shown || null })
    if (error) return toast.error(errMsg(error))
    toast.success(shown ? 'تم إقفال الفترة' : 'تم فك الإقفال'); qc.invalidateQueries({ queryKey: ['setting', 'accounting.lock_date'] })
  }
  if (isLoading) return <Spinner />
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="card p-5 lg:col-span-2">
        <h3 className="mb-1 font-bold text-brand-800">حسابات الترحيل التلقائي</h3>
        <p className="mb-4 text-xs text-brand-400">كل عملية في النظام (بيع، شراء، راتب...) تُرحَّل إلى هذه الحسابات. حساب كل طريقة دفع يُحدَّد من شاشة «طرق الدفع»، وحساب كل نوع مصروف/إيراد من شاشاتها.</p>
        <div className="divide-y divide-cream-200">
          {(data ?? []).map((m: any) => (
            <div key={m.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-sm">{m.label}</span>
              <AccountSelect className="w-72" value={m.account_id} onChange={(v) => canEdit && change(m.key, v)} />
            </div>
          ))}
        </div>
      </div>
      <div className="card h-fit p-5">
        <h3 className="mb-1 font-bold text-brand-800">إقفال الفترة المحاسبية</h3>
        <p className="mb-3 text-xs text-brand-400">يمنع إضافة قيود يدوية بتاريخ يساوي أو يسبق التاريخ المحدد. اتركه فارغاً لفك الإقفال.</p>
        <Input type="date" value={shown} onChange={(e) => setLockDate(e.target.value)} disabled={!canEdit} />
        {canEdit && <Button className="mt-3 w-full" onClick={saveLock}>حفظ</Button>}
      </div>
    </div>
  )
}
