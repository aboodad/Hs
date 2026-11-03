import { useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, FileSpreadsheet, Play, Printer } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { toast } from '@/store/toast.store'
import { useAuth } from '@/store/auth.store'
import { usePermission } from '@/hooks/usePermission'
import { useCompany } from '@/hooks/useLookups'
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, toISODate } from '@/lib/formatters'
import { PageHeader } from '@/components/shared/PageHeader'
import { BranchSelect } from '@/components/shared/BranchSelect'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Spinner'
import { REPORTS, type ReportCol, type ReportCtx } from '../definitions'

const raw = (r: any, c: ReportCol) => (c.value ? c.value(r) : r[c.key])
const show = (r: any, c: ReportCol) => {
  const v = raw(r, c)
  if (v == null || v === '') return '—'
  if (c.type === 'money') return fmtMoney(v)
  if (c.type === 'num') return fmtNum(v)
  if (c.type === 'date') return fmtDate(v)
  if (c.type === 'datetime') return fmtDateTime(v)
  return String(v)
}

export default function ReportViewerPage() {
  const { code } = useParams()
  const def = REPORTS.find((r) => r.code === code)
  const { can, seesAllBranches } = usePermission()
  const myBranch = useAuth((s) => s.profile?.branch_id) ?? ''
  const { data: company } = useCompany()
  const [ctx, setCtx] = useState<ReportCtx>({
    from: toISODate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), to: toISODate(new Date()),
    branch: seesAllBranches ? '' : myBranch, supplier: '', customer: '',
  })
  const [run, setRun] = useState<ReportCtx | null>(null)

  const suppliers = useQuery({ queryKey: ['rep-suppliers'], enabled: !!def?.needs?.includes('supplier'), queryFn: async () => (await supabase.from('suppliers').select('id,name').order('name')).data ?? [] })
  const customers = useQuery({ queryKey: ['rep-customers'], enabled: !!def?.needs?.includes('customer'), queryFn: async () => (await supabase.from('customers').select('id,name').order('name').limit(1000)).data ?? [] })

  const { data, isFetching, error } = useQuery({
    queryKey: ['report', code, run], enabled: !!def && !!run,
    queryFn: () => def!.fetch(run!),
  })

  const totals = useMemo(() => {
    const t: Record<string, number> = {}
    def?.totals?.forEach((k) => { t[k] = (data ?? []).reduce((s, r) => s + Number(r[k] ?? 0), 0) })
    return t
  }, [data, def])

  if (!def) return <Navigate to="/reports" replace />
  if (!can('reports', 'view')) return null

  const submit = () => {
    if (def.needs?.includes('branch') && !ctx.branch) return toast.error('اختر الفرع')
    if (def.needs?.includes('supplier') && !ctx.supplier) return toast.error('اختر المورد')
    if (def.needs?.includes('customer') && !ctx.customer) return toast.error('اختر العميل')
    setRun({ ...ctx })
  }

  const exportCsv = () => {
    if (!data?.length) return toast.error('لا بيانات للتصدير')
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [def.cols.map((c) => esc(c.header)).join(','), ...data.map((r) => def.cols.map((c) => esc(raw(r, c))).join(','))]
    if (def.totals) lines.push(def.cols.map((c, i) => esc(i === 0 ? 'الإجمالي' : (c.key in totals ? totals[c.key] : ''))).join(','))
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${def.code}-${ctx.from}_${ctx.to}.csv`; a.click()
  }

  const canExport = can('reports', 'export'), canPrint = can('reports', 'print')

  return (
    <>
      <PageHeader title={def.title} subtitle={def.desc}
        actions={<Link to="/reports" className="btn border border-cream-400 bg-white text-brand-700 no-print"><ArrowRight className="h-4 w-4" /> كل التقارير</Link>} />

      <div className="card no-print mb-5 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        {!def.noDates && <><Field label="من تاريخ"><Input type="date" value={ctx.from} onChange={(e) => setCtx({ ...ctx, from: e.target.value })} /></Field>
          <Field label="إلى تاريخ"><Input type="date" value={ctx.to} onChange={(e) => setCtx({ ...ctx, to: e.target.value })} /></Field></>}
        {(seesAllBranches || def.needs?.includes('branch')) && <Field label={def.needs?.includes('branch') ? 'الفرع *' : 'الفرع'}>
          <BranchSelect includeAll={!def.needs?.includes('branch')} value={ctx.branch} onChange={(v) => setCtx({ ...ctx, branch: v })} /></Field>}
        {def.needs?.includes('supplier') && <Field label="المورد *"><Select value={ctx.supplier} onChange={(e) => setCtx({ ...ctx, supplier: e.target.value })}><option value="">— اختر —</option>{suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>}
        {def.needs?.includes('customer') && <Field label="العميل *"><Select value={ctx.customer} onChange={(e) => setCtx({ ...ctx, customer: e.target.value })}><option value="">— اختر —</option>{customers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>}
        <div className="flex items-end gap-2">
          <Button variant="gold" onClick={submit}><Play className="h-4 w-4" /> عرض</Button>
          {canPrint && <Button variant="secondary" disabled={!data?.length} onClick={() => window.print()} title="للتصدير PDF اختر «حفظ كـ PDF» من نافذة الطباعة"><Printer className="h-4 w-4" /> PDF / طباعة</Button>}
          {canExport && <Button variant="secondary" disabled={!data?.length} onClick={exportCsv}><FileSpreadsheet className="h-4 w-4" /> Excel</Button>}
        </div>
      </div>

      {!run ? <div className="card p-16 text-center text-brand-300">حدّد الفلاتر ثم اضغط «عرض»</div>
        : isFetching ? <div className="card"><Spinner /></div>
        : error ? <div className="card p-8 text-center text-red-700">تعذر تحميل التقرير: {(error as any).message}</div>
        : (
          <div id="report-print" className="card overflow-x-auto">
            <div className="border-b-2 border-gold-500 px-5 py-3">
              <div className="flex items-center justify-between"><b className="text-brand-800">{company?.name ?? 'هاشم للطيب والعطور'}</b><span className="text-xs text-brand-400">{fmtDateTime(new Date())}</span></div>
              <div className="text-sm font-semibold">{def.title}{!def.noDates && <span className="font-normal text-brand-400"> · من {fmtDate(run.from)} إلى {fmtDate(run.to)}</span>}</div>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-cream-200 text-xs text-brand-700"><tr>{def.cols.map((c) => <th key={c.key} className="whitespace-nowrap px-3 py-2.5 text-start">{c.header}</th>)}</tr></thead>
              <tbody className="divide-y divide-cream-200">
                {data?.map((r, i) => <tr key={i}>{def.cols.map((c) => <td key={c.key} className="px-3 py-2">{show(r, c)}</td>)}</tr>)}
                {!data?.length && <tr><td colSpan={def.cols.length} className="p-10 text-center text-brand-300">لا توجد بيانات في هذه الفترة</td></tr>}
              </tbody>
              {def.totals && !!data?.length && (
                <tfoot className="bg-cream-100 font-bold"><tr>
                  {def.cols.map((c, i) => <td key={c.key} className="px-3 py-2.5">{i === 0 ? `الإجمالي (${data.length})` : c.key in totals ? (c.type === 'money' ? fmtMoney(totals[c.key]) : fmtNum(totals[c.key])) : ''}</td>)}
                </tr></tfoot>
              )}
            </table>
          </div>
        )}
    </>
  )
}
