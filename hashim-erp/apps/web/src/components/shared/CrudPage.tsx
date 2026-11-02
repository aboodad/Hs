import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueries, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errMsg } from '@/lib/errors'
import { toast } from '@/store/toast.store'
import { usePermission } from '@/hooks/usePermission'
import { PageHeader } from './PageHeader'
import { DataTable, type Column } from '@/components/data/DataTable'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Badge } from '@/components/ui/Badge'
import { askConfirm } from '@/store/confirm.store'

export interface FieldDef {
  name: string
  label: string
  type?: 'text' | 'number' | 'select' | 'checkbox' | 'textarea' | 'date'
  required?: boolean
  options?: { value: string; label: string }[]
  optionsFrom?: { table: string; value?: string; label?: string; filter?: Record<string, any> }
  default?: any
}
export interface CrudColumn { key: string; label: string; render?: (row: any) => ReactNode }

/** صفحة CRUD عامة قابلة للضبط: تُستخدم للتصنيفات والوحدات والعملاء والموردين وطرق الدفع... */
export function CrudPage({ title, table, module, select = '*', columns, fields, orderBy = 'created_at', ascending = false, searchKeys = ['name'], canDelete = false, subtitle, rowLink }: {
  title: string; table: string; module: string; select?: string
  columns: CrudColumn[]; fields: FieldDef[]; orderBy?: string; ascending?: boolean
  searchKeys?: string[]; canDelete?: boolean; subtitle?: string; rowLink?: (row: any) => string
}) {
  const nav = useNavigate()
  const qc = useQueryClient()
  const { can } = usePermission()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<any | null>(null)
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<Record<string, any>>({})
  const [saving, setSaving] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: [table, 'crud'],
    queryFn: async () => {
      const { data, error } = await supabase.from(table).select(select).order(orderBy, { ascending })
      if (error) throw error
      return (data ?? []) as any[]
    },
  })

  const optQueries = useQueries({
    queries: fields.filter((f) => f.optionsFrom).map((f) => ({
      queryKey: ['crud-options', f.optionsFrom!.table, f.optionsFrom!.filter],
      queryFn: async () => {
        const o = f.optionsFrom!
        let q = supabase.from(o.table).select(`${o.value ?? 'id'},${o.label ?? 'name'}`)
        Object.entries(o.filter ?? {}).forEach(([k, v]) => { q = q.eq(k, v as any) })
        const { data, error } = await q
        if (error) throw error
        return { name: f.name, options: (data ?? []).map((r: any) => ({ value: r[o.value ?? 'id'], label: r[o.label ?? 'name'] })) }
      },
      staleTime: 60_000,
    })),
  })
  const dynamicOptions: Record<string, { value: string; label: string }[]> = {}
  optQueries.forEach((q) => { if (q.data) dynamicOptions[q.data.name] = q.data.options })

  const rows = (data ?? []).filter((r) => !search || searchKeys.some((k) => String(r[k] ?? '').toLowerCase().includes(search.toLowerCase())))

  const openForm = (row?: any) => {
    setEditing(row ?? null)
    const init: Record<string, any> = {}
    fields.forEach((f) => { init[f.name] = row ? (row[f.name] ?? '') : (f.default ?? (f.type === 'checkbox' ? true : '')) })
    setValues(init)
    setOpen(true)
  }

  const save = async () => {
    for (const f of fields) {
      if (f.required && (values[f.name] === '' || values[f.name] == null)) return toast.error(`الحقل مطلوب: ${f.label}`)
    }
    const payload: Record<string, any> = {}
    fields.forEach((f) => {
      const v = values[f.name]
      payload[f.name] = f.type === 'number' ? (v === '' ? null : Number(v)) : f.type === 'checkbox' ? !!v : v === '' ? null : v
    })
    setSaving(true)
    const res = editing
      ? await supabase.from(table).update(payload).eq('id', editing.id)
      : await supabase.from(table).insert(payload)
    setSaving(false)
    if (res.error) return toast.error(errMsg(res.error))
    toast.success('تم الحفظ')
    setOpen(false)
    qc.invalidateQueries({ queryKey: [table] })
  }

  const remove = async (row: any) => {
    if (!(await askConfirm({ title: 'حذف السجل؟', description: 'لا يمكن التراجع عن هذا الإجراء.', confirmLabel: 'احذف', tone: 'danger', hold: true }))) return
    const { error } = await supabase.from(table).delete().eq('id', row.id)
    if (error) return toast.error(errMsg(error))
    toast.success('تم الحذف')
    qc.invalidateQueries({ queryKey: [table] })
  }

  const cols: Column<any>[] = [
    ...columns.map((c) => ({ key: c.key, header: c.label, render: c.render ?? ((r: any) => (typeof r[c.key] === 'boolean' ? <Badge tone={r[c.key] ? 'green' : 'gray'}>{r[c.key] ? 'نشط' : 'موقوف'}</Badge> : String(r[c.key] ?? '—'))) })),
    ...(can(module, 'update') || (canDelete && can(module, 'delete'))
      ? [{ key: '_a', header: '', className: 'w-24 text-end', render: (r: any) => (
          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {can(module, 'update') && <Button size="sm" variant="ghost" onClick={() => openForm(r)}><Pencil className="h-4 w-4" /></Button>}
            {canDelete && can(module, 'delete') && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => remove(r)}><Trash2 className="h-4 w-4" /></Button>}
          </div>) }]
      : []),
  ]

  return (
    <>
      <PageHeader title={title} subtitle={subtitle}
        actions={<>
          <div className="relative"><Search className="pointer-events-none absolute start-3 top-2.5 h-4 w-4 text-stone-400" />
            <Input className="ps-9" placeholder="بحث..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          {can(module, 'create') && <Button onClick={() => openForm()}><Plus className="h-4 w-4" /> إضافة</Button>}
        </>} />
      <DataTable columns={cols} rows={rows} loading={isLoading} onRowClick={rowLink ? (r) => nav(rowLink(r)) : undefined} />

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? `تعديل ${title}` : `إضافة ${title}`}
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>إلغاء</Button><Button loading={saving} onClick={save}>حفظ</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((f) => {
            const opts = f.options ?? dynamicOptions[f.name] ?? []
            const set = (v: any) => setValues((s) => ({ ...s, [f.name]: v }))
            return (
              <Field key={f.name} label={f.label + (f.required ? ' *' : '')} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}>
                {f.type === 'select' ? (
                  <Select value={values[f.name] ?? ''} onChange={(e) => set(e.target.value)}>
                    <option value="">— اختر —</option>
                    {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                ) : f.type === 'checkbox' ? (
                  <input type="checkbox" className="h-5 w-5 accent-brand-700" checked={!!values[f.name]} onChange={(e) => set(e.target.checked)} />
                ) : f.type === 'textarea' ? (
                  <Textarea value={values[f.name] ?? ''} onChange={(e) => set(e.target.value)} />
                ) : (
                  <Input type={f.type ?? 'text'} step={f.type === 'number' ? 'any' : undefined} value={values[f.name] ?? ''} onChange={(e) => set(e.target.value)} />
                )}
              </Field>
            )
          })}
        </div>
      </Modal>
    </>
  )
}
