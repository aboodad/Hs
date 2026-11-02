import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ExternalLink, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errMsg } from '@/lib/errors'
import { toast } from '@/store/toast.store'
import { useAuth } from '@/store/auth.store'
import { usePermission } from '@/hooks/usePermission'
import { useMainWarehouse } from '@/hooks/useLookups'
import { fmtDate, fmtMoney, toISODate } from '@/lib/formatters'
import { askConfirm } from '@/store/confirm.store'
import { PageHeader } from '@/components/shared/PageHeader'
import { BranchSelect } from '@/components/shared/BranchSelect'
import { DataTable, type Column } from '@/components/data/DataTable'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Field, Input, Select } from '@/components/ui/Field'
import { AccountSelect } from '../components/AccountSelect'
import { SOURCE_LABEL, sourceLink } from '../lib'

const blank = () => ({ account_id: '', debit: '', credit: '', memo: '' })

export default function JournalPage() {
  const qc = useQueryClient()
  const { can, seesAllBranches } = usePermission()
  const myBranch = useAuth((s) => s.profile?.branch_id) ?? ''
  const { data: main } = useMainWarehouse()
  const [from, setFrom] = useState(toISODate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)))
  const [to, setTo] = useState(toISODate(new Date()))
  const [branch, setBranch] = useState('')
  const [src, setSrc] = useState('')
  const [view, setView] = useState<any | null>(null)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ entry_date: toISODate(new Date()), branch_id: '', description: '' })
  const [lines, setLines] = useState([blank(), blank()])

  const { data, isLoading } = useQuery({
    queryKey: ['journal', from, to, branch, src],
    queryFn: async () => {
      let q = supabase.from('journal_entries').select('*, branch:branches(name), lines:journal_lines(debit)')
        .gte('entry_date', from).lte('entry_date', to).order('entry_date', { ascending: false }).order('created_at', { ascending: false }).limit(500)
      if (branch) q = q.eq('branch_id', branch)
      if (src === 'manual') q = q.is('source_type', null)
      else if (src) q = q.eq('source_type', src)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []).map((e: any) => ({ ...e, total: (e.lines ?? []).reduce((s: number, l: any) => s + Number(l.debit), 0) }))
    },
  })
  const { data: vlines } = useQuery({
    queryKey: ['journal-lines', view?.id], enabled: !!view,
    queryFn: async () => (await supabase.from('journal_lines').select('*, account:accounts(code,name), branch:branches(name)').eq('entry_id', view.id).order('line_no')).data ?? [],
  })

  const d = lines.reduce((s, l) => s + Number(l.debit || 0), 0)
  const c = lines.reduce((s, l) => s + Number(l.credit || 0), 0)
  const balanced = d > 0 && Math.round(d * 100) === Math.round(c * 100)
  const setLine = (i: number, k: string, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v, ...(k === 'debit' && v ? { credit: '' } : {}), ...(k === 'credit' && v ? { debit: '' } : {}) } : l)))

  const save = async () => {
    const payload = lines.filter((l) => l.account_id && (Number(l.debit) > 0 || Number(l.credit) > 0))
      .map((l) => ({ account_id: l.account_id, debit: Number(l.debit || 0), credit: Number(l.credit || 0), memo: l.memo || undefined }))
    if (payload.length < 2) return toast.error('أدخل سطرين على الأقل')
    if (!balanced) return toast.error('القيد غير متوازن')
    setSaving(true)
    const { error } = await supabase.rpc('fn_post_manual_journal', { p: { entry_date: form.entry_date, branch_id: form.branch_id || main?.id || myBranch, description: form.description, lines: payload } })
    setSaving(false)
    if (error) return toast.error(errMsg(error))
    toast.success('تم ترحيل القيد'); setOpen(false); setLines([blank(), blank()]); setForm({ ...form, description: '' })
    qc.invalidateQueries({ queryKey: ['journal'] }); qc.invalidateQueries({ queryKey: ['acc-report'] })
  }
  const reverse = async (e: any) => {
    if (!(await askConfirm({ title: 'عكس القيد؟', description: 'يُنشأ قيد عكسي بتاريخ اليوم ويبقى القيد الأصلي ظاهراً كمعكوس.', confirmLabel: 'اعكس القيد', tone: 'danger', hold: true }))) return
    const { error } = await supabase.rpc('fn_reverse_journal_entry', { p_entry: e.id, p_reason: null })
    if (error) return toast.error(errMsg(error))
    toast.success('تم عكس القيد'); setView(null)
    qc.invalidateQueries({ queryKey: ['journal'] }); qc.invalidateQueries({ queryKey: ['acc-report'] })
  }

  const cols: Column<any>[] = [
    { key: 'entry_no', header: 'رقم القيد', render: (r) => <span className="font-mono text-xs" dir="ltr">{r.entry_no}</span> },
    { key: 'entry_date', header: 'التاريخ', render: (r) => fmtDate(r.entry_date) },
    { key: 'description', header: 'البيان', render: (r) => <>{r.description ?? '—'} {r.reversal_of && <Badge tone="amber">عكسي</Badge>} {r.status === 'reversed' && <Badge tone="red">معكوس</Badge>}</> },
    { key: 'source', header: 'المصدر', render: (r) => (r.source_type ? <Badge tone="blue">{SOURCE_LABEL[r.source_type] ?? r.source_type}</Badge> : <Badge tone="purple">يدوي</Badge>) },
    { key: 'branch', header: 'الفرع', render: (r) => r.branch?.name },
    { key: 'total', header: 'المبلغ', render: (r) => <b>{fmtMoney(r.total)}</b> },
  ]

  return (
    <>
      <PageHeader title="القيود اليومية" subtitle="كل العمليات تُقيَّد هنا تلقائياً، ويمكن إضافة قيد يدوي"
        actions={<>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          {seesAllBranches && <BranchSelect includeAll value={branch} onChange={setBranch} className="w-44" />}
          <Select value={src} onChange={(e) => setSrc(e.target.value)} className="w-40">
            <option value="">كل المصادر</option><option value="manual">قيود يدوية</option>
            {Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          {can('accounting', 'create') && <Button onClick={() => { setForm((s) => ({ ...s, branch_id: main?.id ?? myBranch })); setOpen(true) }}><Plus className="h-4 w-4" /> قيد يدوي</Button>}
        </>} />
      <DataTable columns={cols} rows={data} loading={isLoading} onRowClick={setView} />

      <Modal open={!!view} onClose={() => setView(null)} size="lg" title={`قيد ${view?.entry_no ?? ''}`}
        footer={<>
          {view && !view.source_type && view.status === 'posted' && !view.reversal_of && can('accounting', 'cancel') &&
            <Button variant="danger" onClick={() => reverse(view)}><RotateCcw className="h-4 w-4" /> عكس القيد</Button>}
          {view && sourceLink(view.source_type, view.source_id) &&
            <Link to={sourceLink(view.source_type, view.source_id)!} className="btn border border-cream-400 bg-white text-brand-700"><ExternalLink className="h-4 w-4" /> المستند الأصلي</Link>}
        </>}>
        <p className="mb-3 text-sm text-brand-500">{fmtDate(view?.entry_date)} · {view?.description}</p>
        <table className="w-full text-sm">
          <thead className="bg-cream-100 text-xs text-brand-700"><tr><th className="p-2 text-start">الحساب</th><th className="p-2 text-start">الفرع</th><th className="p-2 text-start">مدين</th><th className="p-2 text-start">دائن</th></tr></thead>
          <tbody className="divide-y divide-cream-200">
            {(vlines ?? []).map((l: any) => (
              <tr key={l.id}><td className="p-2">{l.account?.code} — {l.account?.name}{l.memo && <div className="text-xs text-brand-300">{l.memo}</div>}</td>
                <td className="p-2">{l.branch?.name}</td>
                <td className="p-2" dir="ltr">{Number(l.debit) ? fmtMoney(l.debit, false) : ''}</td><td className="p-2" dir="ltr">{Number(l.credit) ? fmtMoney(l.credit, false) : ''}</td></tr>
            ))}
          </tbody>
        </table>
      </Modal>

      <Modal open={open} onClose={() => setOpen(false)} size="xl" title="قيد يومية يدوي"
        footer={<><span className={`me-auto text-sm font-bold ${balanced ? 'text-emerald-700' : 'text-red-600'}`}>مدين {fmtMoney(d, false)} · دائن {fmtMoney(c, false)}{!balanced && d + c > 0 ? ` · الفرق ${fmtMoney(Math.abs(d - c), false)}` : ''}</span>
          <Button variant="secondary" onClick={() => setOpen(false)}>إلغاء</Button><Button loading={saving} disabled={!balanced} onClick={save}>ترحيل القيد</Button></>}>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Field label="التاريخ"><Input type="date" value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} /></Field>
          <Field label="الفرع"><BranchSelect value={form.branch_id} onChange={(v) => setForm({ ...form, branch_id: v })} /></Field>
          <Field label="البيان"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        </div>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2">
              <div className="col-span-5"><AccountSelect value={l.account_id} onChange={(v) => setLine(i, 'account_id', v)} /></div>
              <Input className="col-span-2" type="number" min={0} step="any" placeholder="مدين" value={l.debit} onChange={(e) => setLine(i, 'debit', e.target.value)} />
              <Input className="col-span-2" type="number" min={0} step="any" placeholder="دائن" value={l.credit} onChange={(e) => setLine(i, 'credit', e.target.value)} />
              <Input className="col-span-2" placeholder="ملاحظة" value={l.memo} onChange={(e) => setLine(i, 'memo', e.target.value)} />
              <button className="col-span-1 text-red-500" onClick={() => lines.length > 2 && setLines(lines.filter((_, j) => j !== i))}><Trash2 className="mx-auto h-4 w-4" /></button>
            </div>
          ))}
        </div>
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => setLines([...lines, blank()])}><Plus className="h-4 w-4" /> سطر</Button>
      </Modal>
    </>
  )
}
