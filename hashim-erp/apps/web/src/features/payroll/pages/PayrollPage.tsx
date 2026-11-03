import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Calculator, CheckCheck, FilePlus2, Printer, Wallet } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errMsg } from '@/lib/errors'
import { toast } from '@/store/toast.store'
import { usePermission } from '@/hooks/usePermission'
import { usePaymentMethods, useActiveEmployees } from '@/hooks/useLookups'
import { fmtMoney, fmtDate } from '@/lib/formatters'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatCard } from '@/components/shared/StatCard'
import { DataTable, type Column } from '@/components/data/DataTable'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { askConfirm } from '@/store/confirm.store'

export const PERIOD_STATUS: Record<string, [string, any]> = { open: ['مفتوحة', 'gray'], calculated: ['محسوبة', 'amber'], approved: ['معتمدة', 'blue'], paid: ['مصروفة', 'green'] }
export const PAYROLL_STATUS: Record<string, [string, any]> = { draft: ['مسودة', 'gray'], approved: ['معتمد', 'blue'], paid: ['مصروف', 'green'] }
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
export const periodLabel = (p: { year: number; month: number }) => `${MONTHS[p.month - 1]} ${p.year}`

export default function PayrollPage() {
  const qc = useQueryClient()
  const { can } = usePermission()
  const { data: methods } = usePaymentMethods()
  const [periodId, setPeriodId] = useState('')
  const [busy, setBusy] = useState(false)
  const [adjOpen, setAdjOpen] = useState(false)
  const [payFor, setPayFor] = useState<any | null>(null)
  const [payMethod, setPayMethod] = useState('')
  const now = new Date()
  const [adj, setAdj] = useState({ employee_id: '', adj_type: 'bonus', amount: '', adj_date: now.toISOString().slice(0, 10), reason: '' })

  const { data: periods } = useQuery({
    queryKey: ['payroll-periods'],
    queryFn: async () => (await supabase.from('payroll_periods').select('*').order('year', { ascending: false }).order('month', { ascending: false })).data ?? [],
  })
  useEffect(() => { if (!periodId && periods?.length) setPeriodId(periods[0].id) }, [periods, periodId])
  const period = periods?.find((p) => p.id === periodId)

  const { data: rows, isLoading } = useQuery({
    queryKey: ['payrolls', periodId], enabled: !!periodId,
    queryFn: async () => {
      const { data, error } = await supabase.from('payrolls').select('*, employee:employees(full_name,job_title), branch:branches(name)').eq('period_id', periodId).order('created_at')
      if (error) throw error
      return data ?? []
    },
  })
  const { data: employees } = useActiveEmployees()

  const refresh = () => { qc.invalidateQueries({ queryKey: ['payroll-periods'] }); qc.invalidateQueries({ queryKey: ['payrolls'] }); qc.invalidateQueries({ queryKey: ['commissions'] }) }

  const createPeriod = async () => {
    const { data, error } = await supabase.from('payroll_periods').insert({ year: now.getFullYear(), month: now.getMonth() + 1 }).select('id').single()
    if (error) return toast.error(errMsg(error))
    toast.success('تم إنشاء فترة الشهر الحالي'); setPeriodId(data.id); refresh()
  }
  const run = async (fn: string, args: any, ok: string) => {
    setBusy(true)
    const { error } = await supabase.rpc(fn, args)
    setBusy(false)
    if (error) return toast.error(errMsg(error))
    toast.success(ok); refresh()
  }
  const saveAdj = async () => {
    if (!adj.employee_id || !(Number(adj.amount) > 0)) return toast.error('اختر الموظف وأدخل المبلغ')
    const { error } = await supabase.from('employee_adjustments').insert({ ...adj, amount: Number(adj.amount), reason: adj.reason || null })
    if (error) return toast.error(errMsg(error))
    toast.success('تم التسجيل (يُحتسب عند حساب الرواتب)'); setAdjOpen(false); setAdj({ ...adj, amount: '', reason: '' })
  }

  const sum = (k: string) => (rows ?? []).reduce((s, r: any) => s + Number(r[k]), 0)

  const cols: Column<any>[] = [
    { key: 'employee', header: 'الموظف', render: (r) => <div><b>{r.employee?.full_name}</b><div className="text-xs text-brand-300">{r.employee?.job_title} · {r.branch?.name}</div></div> },
    { key: 'base_salary', header: 'الأساسي', render: (r) => fmtMoney(r.base_salary) },
    { key: 'commission_amount', header: 'العمولة', render: (r) => fmtMoney(r.commission_amount) },
    { key: 'bonuses', header: 'المكافآت', render: (r) => <span className="text-emerald-700">{fmtMoney(r.bonuses)}</span> },
    { key: 'deductions', header: 'الخصومات', render: (r) => <span className="text-red-600">{fmtMoney(r.deductions)}</span> },
    { key: 'advances', header: 'السلف', render: (r) => <span className="text-red-600">{fmtMoney(r.advances)}</span> },
    { key: 'net_salary', header: 'صافي الراتب', render: (r) => <b className="text-brand-800">{fmtMoney(r.net_salary)}</b> },
    { key: 'status', header: 'الحالة', render: (r) => <StatusBadge map={PAYROLL_STATUS} value={r.status} /> },
    { key: '_a', header: '', render: (r) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          {r.status === 'approved' && can('payroll', 'approve') && <Button size="sm" variant="success" onClick={() => { setPayFor(r); setPayMethod(methods?.find((m) => m.is_cash)?.id ?? '') }}><Wallet className="h-4 w-4" /> صرف</Button>}
          <Link to={`/payroll/${r.id}`} className="btn !px-3 !py-1.5 text-xs border border-cream-400 bg-white text-brand-700"><Printer className="h-4 w-4" /> كشف</Link>
        </div>) },
  ]

  return (
    <>
      <PageHeader title="الرواتب" subtitle="الأساسي + العمولة + المكافآت − الخصومات − السلف"
        actions={<>
          <Select value={periodId} onChange={(e) => setPeriodId(e.target.value)} className="w-44">{periods?.map((p) => <option key={p.id} value={p.id}>{periodLabel(p)}</option>)}</Select>
          {can('payroll', 'create') && <Button variant="secondary" onClick={createPeriod}><FilePlus2 className="h-4 w-4" /> فترة الشهر الحالي</Button>}
          {can('payroll', 'create') && <Button variant="secondary" onClick={() => setAdjOpen(true)}>مكافأة / خصم / سلفة</Button>}
        </>} />

      {!periods?.length ? (
        <div className="card p-16 text-center text-brand-400">لا توجد فترات رواتب. أنشئ فترة الشهر الحالي للبدء.</div>
      ) : (<>
        <div className="mb-5 flex flex-wrap items-center gap-3">
          {period && <StatusBadge map={PERIOD_STATUS} value={period.status} />}
          {period && ['open', 'calculated'].includes(period.status) && can('payroll', 'create') &&
            <Button loading={busy} onClick={() => run('fn_calculate_payroll', { p_period: periodId }, 'تم احتساب الرواتب والعمولات')}><Calculator className="h-4 w-4" /> {period.status === 'open' ? 'احتساب الرواتب' : 'إعادة الاحتساب'}</Button>}
          {period?.status === 'calculated' && can('payroll', 'approve') &&
            <Button variant="gold" loading={busy} onClick={async () => (await askConfirm({ title: 'اعتماد كل الرواتب المحسوبة؟', description: 'بعد الاعتماد لا يمكن إعادة الاحتساب.', confirmLabel: 'اعتمد الرواتب', tone: 'brand', hold: true })) && run('fn_approve_payroll', { p_period: periodId }, 'تم اعتماد الرواتب')}><CheckCheck className="h-4 w-4" /> اعتماد الرواتب</Button>}
        </div>
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="الرواتب الأساسية" value={fmtMoney(sum('base_salary'))} />
          <StatCard label="العمولات" value={fmtMoney(sum('commission_amount'))} tone="blue" />
          <StatCard label="الخصومات والسلف" value={fmtMoney(sum('deductions') + sum('advances'))} tone="red" />
          <StatCard label="صافي الرواتب" value={fmtMoney(sum('net_salary'))} tone="green" />
        </div>
        <DataTable columns={cols} rows={rows} loading={isLoading} empty="لم تُحتسب الرواتب لهذه الفترة بعد" />
      </>)}

      <Modal open={adjOpen} onClose={() => setAdjOpen(false)} title="مكافأة / خصم / سلفة" footer={<><Button variant="secondary" onClick={() => setAdjOpen(false)}>إلغاء</Button><Button onClick={saveAdj}>حفظ</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="الموظف *"><Select value={adj.employee_id} onChange={(e) => setAdj({ ...adj, employee_id: e.target.value })}><option value="">— اختر —</option>{employees?.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</Select></Field>
          <Field label="النوع"><Select value={adj.adj_type} onChange={(e) => setAdj({ ...adj, adj_type: e.target.value })}><option value="bonus">مكافأة</option><option value="deduction">خصم</option><option value="advance">سلفة</option></Select></Field>
          <Field label="المبلغ *"><Input type="number" min={0} step="any" value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} /></Field>
          <Field label="التاريخ"><Input type="date" value={adj.adj_date} onChange={(e) => setAdj({ ...adj, adj_date: e.target.value })} /></Field>
          <Field label="السبب" className="sm:col-span-2"><Textarea value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} /></Field>
        </div>
      </Modal>

      <Modal open={!!payFor} onClose={() => setPayFor(null)} title={`صرف راتب ${payFor?.employee?.full_name ?? ''}`} size="sm"
        footer={<><Button variant="secondary" onClick={() => setPayFor(null)}>إلغاء</Button><Button variant="success" loading={busy} onClick={async () => { await run('fn_pay_payroll', { p_payroll: payFor.id, p_method: payMethod || null }, 'تم تسجيل الصرف كمصروف'); setPayFor(null) }}>تأكيد الصرف</Button></>}>
        <div className="mb-4 rounded-2xl bg-cream-100 p-4 text-center"><div className="text-xs text-brand-400">صافي الراتب</div><div className="text-2xl font-bold text-brand-800">{payFor && fmtMoney(payFor.net_salary)}</div></div>
        <Field label="طريقة الصرف"><Select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}><option value="">— اختر —</option>{methods?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
        <p className="mt-3 text-xs text-brand-300">يُسجَّل الراتب والعمولة كمصروفين في الفرع، ويُقيَّد الصرف محاسبياً (رواتب مستحقة ← النقد) بتاريخ {fmtDate(new Date())}.</p>
      </Modal>
    </>
  )
}
