import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { fmtDate, fmtMoney, toISODate } from '@/lib/formatters'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatCard } from '@/components/shared/StatCard'
import { DataTable, type Column } from '@/components/data/DataTable'
import { Badge, StatusBadge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { PAYROLL_STATUS, periodLabel } from '@/features/payroll/pages/PayrollPage'

const ADJ: Record<string, [string, any]> = { bonus: ['مكافأة', 'green'], deduction: ['خصم', 'red'], advance: ['سلفة', 'amber'] }

export default function EmployeeProfilePage() {
  const { id } = useParams()
  const month = toISODate(new Date(new Date().getFullYear(), new Date().getMonth(), 1))

  const { data: e } = useQuery({
    queryKey: ['employee', id],
    queryFn: async () => (await supabase.from('employees').select('*, branch:branches!branch_id(name)').eq('id', id!).single()).data,
  })
  const { data: sales } = useQuery({
    queryKey: ['employee-sales', id],
    queryFn: async () => (await supabase.from('v_sales_by_employee').select('*').eq('employee_id', id!).order('month', { ascending: false }).limit(6)).data ?? [],
  })
  const { data: adj } = useQuery({
    queryKey: ['employee-adj', id],
    queryFn: async () => (await supabase.from('employee_adjustments').select('*').eq('employee_id', id!).order('adj_date', { ascending: false }).limit(30)).data ?? [],
  })
  const { data: pays } = useQuery({
    queryKey: ['employee-payrolls', id],
    queryFn: async () => (await supabase.from('payrolls').select('*, period:payroll_periods(year,month)').eq('employee_id', id!).order('created_at', { ascending: false }).limit(12)).data ?? [],
  })

  if (!e) return <Spinner />
  const cur = sales?.find((s: any) => s.month === month)

  return (
    <>
      <PageHeader title={e.full_name} subtitle={`${e.job_title ?? ''} · ${e.branch?.name}`}
        actions={<Link to="/employees" className="btn border border-cream-400 bg-white text-brand-700"><ArrowRight className="h-4 w-4" /> رجوع</Link>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="الراتب الأساسي" value={fmtMoney(e.base_salary)} />
        <StatCard label="نسبة العمولة" value={`${e.commission_rate}%`} tone="blue" />
        <StatCard label="مبيعات الشهر" value={fmtMoney(cur?.total_sales ?? 0)} tone="green" sub={`${cur?.invoices_count ?? 0} فاتورة`} />
        <StatCard label="الحالة" value={({ active: 'نشط', suspended: 'موقوف', terminated: 'منتهي' } as any)[e.status]} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div><h3 className="mb-2 text-sm font-bold text-brand-700">الرواتب السابقة</h3>
          <DataTable columns={[
            { key: 'p', header: 'الفترة', render: (r: any) => periodLabel(r.period) }, { key: 'n', header: 'الصافي', render: (r: any) => <b>{fmtMoney(r.net_salary)}</b> },
            { key: 's', header: 'الحالة', render: (r: any) => <StatusBadge map={PAYROLL_STATUS} value={r.status} /> }] as Column<any>[]} rows={pays} /></div>
        <div><h3 className="mb-2 text-sm font-bold text-brand-700">المكافآت والخصومات والسلف</h3>
          <DataTable columns={[
            { key: 'd', header: 'التاريخ', render: (r: any) => fmtDate(r.adj_date) }, { key: 't', header: 'النوع', render: (r: any) => <StatusBadge map={ADJ} value={r.adj_type} /> },
            { key: 'a', header: 'المبلغ', render: (r: any) => fmtMoney(r.amount) }, { key: 'r', header: 'السبب', render: (r: any) => r.reason ?? '—' },
            { key: 'l', header: 'مُحتسب', render: (r: any) => <Badge tone={r.payroll_id ? 'green' : 'gray'}>{r.payroll_id ? 'نعم' : 'لا'}</Badge> }] as Column<any>[]} rows={adj} /></div>
      </div>
    </>
  )
}
