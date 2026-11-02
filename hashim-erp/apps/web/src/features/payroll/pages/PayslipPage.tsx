import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Printer } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCompany } from '@/hooks/useLookups'
import { fmtDate, fmtMoney } from '@/lib/formatters'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { StatusBadge } from '@/components/ui/Badge'
import { PAYROLL_STATUS, periodLabel } from './PayrollPage'

export default function PayslipPage() {
  const { id } = useParams()
  const { data: company } = useCompany()
  const { data: p, isLoading } = useQuery({
    queryKey: ['payslip', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('payrolls')
        .select('*, period:payroll_periods(year,month), employee:employees(full_name,job_title,phone), branch:branches(name), method:payment_methods(name)').eq('id', id!).single()
      if (error) throw error
      return data
    },
  })
  if (isLoading || !p) return <Spinner />
  const lines: [string, number, 'add' | 'sub'][] = [['الراتب الأساسي', p.base_salary, 'add'], ['العمولة', p.commission_amount, 'add'], ['المكافآت', p.bonuses, 'add'], ['الخصومات', p.deductions, 'sub'], ['السلف المخصومة', p.advances, 'sub']]
  return (
    <>
      <PageHeader title="كشف راتب" actions={<>
        <Link to="/payroll" className="btn border border-cream-400 bg-white text-brand-700 no-print"><ArrowRight className="h-4 w-4" /> رجوع</Link>
        <Button onClick={() => window.print()} className="no-print"><Printer className="h-4 w-4" /> طباعة</Button></>} />
      <div id="report-print" className="card mx-auto max-w-2xl p-8">
        <div className="mb-6 flex items-center justify-between border-b-2 border-gold-500 pb-4">
          <div><div className="text-xl font-bold text-brand-800">{company?.name ?? 'هاشم للطيب والعطور'}</div><div className="text-sm text-brand-400">كشف راتب شهر {periodLabel(p.period)}</div></div>
          <StatusBadge map={PAYROLL_STATUS} value={p.status} />
        </div>
        <div className="mb-6 grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-brand-400">الموظف: </span><b>{p.employee?.full_name}</b></div>
          <div><span className="text-brand-400">الوظيفة: </span>{p.employee?.job_title ?? '—'}</div>
          <div><span className="text-brand-400">الفرع: </span>{p.branch?.name}</div>
          <div><span className="text-brand-400">تاريخ الصرف: </span>{p.paid_at ? fmtDate(p.paid_at) : '—'}{p.method && ` · ${p.method.name}`}</div>
        </div>
        <table className="w-full text-sm"><tbody>
          {lines.map(([l, v, t]) => <tr key={l} className="border-b border-cream-200"><td className="py-2.5">{l}</td><td className={`py-2.5 text-end font-semibold ${t === 'sub' ? 'text-red-600' : 'text-emerald-700'}`}>{t === 'sub' && Number(v) > 0 ? '− ' : ''}{fmtMoney(v)}</td></tr>)}
          <tr className="bg-cream-100 text-base font-bold"><td className="px-2 py-3">صافي الراتب</td><td className="px-2 py-3 text-end text-brand-800">{fmtMoney(p.net_salary)}</td></tr>
        </tbody></table>
        <div className="mt-12 grid grid-cols-2 gap-8 text-center text-xs text-brand-400"><div className="border-t border-brand-200 pt-2">توقيع الموظف</div><div className="border-t border-brand-200 pt-2">اعتماد الإدارة</div></div>
      </div>
    </>
  )
}
