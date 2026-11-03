import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Boxes, Coins, Scale, TrendingUp, Users, Wallet } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { usePermission } from '@/hooks/usePermission'
import { fmtMoney, fmtNum, toISODate } from '@/lib/formatters'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatCard } from '@/components/shared/StatCard'
import { DataTable, type Column } from '@/components/data/DataTable'
import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'

export default function BranchDetailPage() {
  const { id } = useParams()
  const { can } = usePermission()
  const month = new Date().toISOString().slice(0, 7) + '-01'

  const { data: b } = useQuery({ queryKey: ['branch', id], queryFn: async () => (await supabase.from('branches').select('*, manager:employees!manager_id(full_name)').eq('id', id!).single()).data })
  const { data: k } = useQuery({ queryKey: ['branch-kpis', id], queryFn: async () => (await supabase.from('v_dashboard_kpis').select('*').eq('branch_id', id!).maybeSingle()).data })
  const { data: netProfit } = useQuery({
    queryKey: ['branch-pnl', id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_income_statement', { p_from: month, p_to: toISODate(new Date()), p_branch: id })
      if (error) throw error
      return (data ?? []).reduce((s: number, r: any) => s + (r.account_type === 'revenue' ? Number(r.amount) : -Number(r.amount)), 0)
    },
  })
  const { data: emps } = useQuery({ queryKey: ['branch-employees', id], queryFn: async () => (await supabase.from('employees').select('id,full_name,job_title,status').eq('branch_id', id!).order('full_name')).data ?? [] })
  const { data: stock } = useQuery({ queryKey: ['branch-low', id], queryFn: async () => (await supabase.from('v_low_stock').select('product_name,qty_on_hand,is_out').eq('branch_id', id!).limit(10)).data ?? [] })
  const { data: tr } = useQuery({ queryKey: ['branch-transfers', id], queryFn: async () => (await supabase.from('stock_transfers').select('transfer_no,status,total_wholesale_value').eq('to_branch_id', id!).order('created_at', { ascending: false }).limit(6)).data ?? [] })

  if (!b) return <Spinner />
  const links: [string, string, string][] = [['المخزون', '/inventory/branches', 'inventory'], ['المبيعات', '/sales', 'sales'], ['المصروفات', '/expenses', 'expenses'], ['الموظفون', '/employees', 'employees'], ['طلبات البضاعة', '/requests', 'requests'], ['التحويلات', '/transfers', 'transfers'], ['التسويات', '/branch-accounts', 'branch_accounts'], ['الأرباح والخسائر', '/profit-loss', 'profit_loss']]

  return (
    <>
      <PageHeader title={b.name} subtitle={`${b.type === 'main_warehouse' ? 'المخزن الرئيسي' : 'فرع'} · المدير: ${b.manager?.full_name ?? '—'} · ${b.phone ?? ''}`}
        actions={<Link to="/branches" className="btn border border-cream-400 bg-white text-brand-700"><ArrowRight className="h-4 w-4" /> رجوع</Link>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="مبيعات اليوم" value={fmtMoney(k?.sales_today)} icon={TrendingUp} tone="green" />
        <StatCard label="مبيعات الشهر" value={fmtMoney(k?.sales_month)} icon={TrendingUp} />
        <StatCard label="مصروفات الشهر" value={fmtMoney(k?.expenses_month)} icon={Wallet} tone="red" />
        <StatCard label="صافي ربح الشهر" value={fmtMoney(netProfit ?? 0)} icon={Coins} tone="green" />
        <StatCard label="قيمة المخزون" value={fmtMoney(k?.stock_value)} icon={Boxes} tone="blue" />
        <StatCard label="الموظفون" value={fmtNum(emps?.length ?? 0)} icon={Users} />
        <StatCard label="رصيد الفرع مع الإدارة" value={fmtMoney(k?.branch_balance)} icon={Scale} tone="red" />
        <StatCard label="مستحقات العملاء" value={fmtMoney(k?.customers_due)} tone="red" />
      </div>
      <div className="mb-5 flex flex-wrap gap-2">
        {links.filter(([, , m]) => can(m, 'view')).map(([l, to]) => <Link key={to} to={to} className="rounded-full border border-gold-300 bg-gold-50 px-4 py-1.5 text-sm font-semibold text-gold-800 hover:bg-gold-100">{l}</Link>)}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div><h3 className="mb-2 text-sm font-bold text-brand-700">الموظفون</h3>
          <DataTable rows={emps} columns={[{ key: 'n', header: 'الاسم', render: (r: any) => <b>{r.full_name}</b> }, { key: 'j', header: 'الوظيفة', render: (r: any) => r.job_title ?? '—' }, { key: 's', header: 'الحالة', render: (r: any) => <Badge tone={r.status === 'active' ? 'green' : 'gray'}>{r.status === 'active' ? 'نشط' : 'غير نشط'}</Badge> }] as Column<any>[]} /></div>
        <div><h3 className="mb-2 text-sm font-bold text-brand-700">مخزون منخفض / نافد</h3>
          <DataTable rows={stock} rowKey={(r: any) => r.product_name} columns={[{ key: 'p', header: 'المنتج', render: (r: any) => r.product_name }, { key: 'q', header: 'الكمية', render: (r: any) => <Badge tone={r.is_out ? 'red' : 'amber'}>{fmtNum(r.qty_on_hand)}</Badge> }] as Column<any>[]} /></div>
        <div><h3 className="mb-2 text-sm font-bold text-brand-700">آخر التحويلات الواردة</h3>
          <DataTable rows={tr} rowKey={(r: any) => r.transfer_no} columns={[{ key: 'n', header: 'الرقم', render: (r: any) => <span dir="ltr">{r.transfer_no}</span> }, { key: 'v', header: 'القيمة', render: (r: any) => fmtMoney(r.total_wholesale_value) }, { key: 's', header: 'الحالة', render: (r: any) => r.status }] as Column<any>[]} /></div>
      </div>
    </>
  )
}
