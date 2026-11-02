import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Calculator } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errMsg } from '@/lib/errors'
import { toast } from '@/store/toast.store'
import { usePermission } from '@/hooks/usePermission'
import { fmtMoney } from '@/lib/formatters'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatCard } from '@/components/shared/StatCard'
import { DataTable, type Column } from '@/components/data/DataTable'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { Select } from '@/components/ui/Field'
import { periodLabel } from '@/features/payroll/pages/PayrollPage'

const ST: Record<string, [string, any]> = { pending: ['معلّقة', 'amber'], approved: ['معتمدة', 'blue'], paid: ['مصروفة', 'green'] }

export default function CommissionsPage() {
  const qc = useQueryClient()
  const { can } = usePermission()
  const [periodId, setPeriodId] = useState('')
  const [busy, setBusy] = useState(false)

  const { data: periods } = useQuery({
    queryKey: ['payroll-periods'],
    queryFn: async () => (await supabase.from('payroll_periods').select('*').order('year', { ascending: false }).order('month', { ascending: false })).data ?? [],
  })
  useEffect(() => { if (!periodId && periods?.length) setPeriodId(periods[0].id) }, [periods, periodId])

  const { data, isLoading } = useQuery({
    queryKey: ['commissions', periodId], enabled: !!periodId,
    queryFn: async () => {
      const { data, error } = await supabase.from('commissions').select('*, employee:employees(full_name), branch:branches(name)').eq('period_id', periodId).order('amount', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })

  const calc = async () => {
    setBusy(true)
    const { data: n, error } = await supabase.rpc('fn_calculate_commissions', { p_period: periodId })
    setBusy(false)
    if (error) return toast.error(errMsg(error))
    toast.success(`تم احتساب عمولات ${n} موظف`)
    qc.invalidateQueries({ queryKey: ['commissions'] })
  }
  const sum = (k: string) => (data ?? []).reduce((s, r: any) => s + Number(r[k]), 0)

  const cols: Column<any>[] = [
    { key: 'employee', header: 'الموظف', render: (r) => <b>{r.employee?.full_name}</b> },
    { key: 'branch', header: 'الفرع', render: (r) => r.branch?.name },
    { key: 'total_sales', header: 'إجمالي مبيعاته', render: (r) => fmtMoney(r.total_sales) },
    { key: 'eligible_sales', header: 'المحتسب للعمولة', render: (r) => fmtMoney(r.eligible_sales) },
    { key: 'rate', header: 'النسبة %', render: (r) => `${r.rate}%` },
    { key: 'amount', header: 'قيمة العمولة', render: (r) => <b className="text-brand-800">{fmtMoney(r.amount)}</b> },
    { key: 'status', header: 'حالة الصرف', render: (r) => <StatusBadge map={ST} value={r.status} /> },
  ]
  return (
    <>
      <PageHeader title="العمولات ونسب الموظفين" subtitle="تُحتسب من صافي المبيعات بعد المرتجعات، وتُضبط طريقة الحساب من الإعدادات"
        actions={<>
          <Select value={periodId} onChange={(e) => setPeriodId(e.target.value)} className="w-44">{periods?.map((p) => <option key={p.id} value={p.id}>{periodLabel(p)}</option>)}</Select>
          {can('commissions', 'create') && periodId && <Button loading={busy} onClick={calc}><Calculator className="h-4 w-4" /> احتساب العمولات</Button>}
        </>} />
      {!periods?.length ? <div className="card p-16 text-center text-brand-400">أنشئ فترة رواتب أولاً من صفحة الرواتب.</div> : (<>
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <StatCard label="مبيعات الموظفين" value={fmtMoney(sum('total_sales'))} />
          <StatCard label="المحتسب للعمولة" value={fmtMoney(sum('eligible_sales'))} tone="blue" />
          <StatCard label="إجمالي العمولات" value={fmtMoney(sum('amount'))} tone="green" />
        </div>
        <DataTable columns={cols} rows={data} loading={isLoading} empty="لم تُحتسب عمولات لهذه الفترة" />
      </>)}
    </>
  )
}
