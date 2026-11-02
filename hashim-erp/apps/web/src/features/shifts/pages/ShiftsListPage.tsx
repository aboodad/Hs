import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { usePermission } from '@/hooks/usePermission'
import { fmtDateTime, fmtMoney, toISODate } from '@/lib/formatters'
import { PageHeader } from '@/components/shared/PageHeader'
import { BranchSelect } from '@/components/shared/BranchSelect'
import { StatCard } from '@/components/shared/StatCard'
import { DataTable, type Column } from '@/components/data/DataTable'
import { Badge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Field'

export default function ShiftsListPage() {
  const { seesAllBranches } = usePermission()
  const [from, setFrom] = useState(toISODate(new Date(Date.now() - 6 * 86400000)))
  const [to, setTo] = useState(toISODate(new Date()))
  const [branch, setBranch] = useState('')
  const [status, setStatus] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['shifts', 'list', from, to, branch, status],
    queryFn: async () => {
      let q = supabase.from('shifts').select('*, branch:branches(name), cashier:profiles!user_id(full_name)')
        .gte('opened_at', `${from}T00:00:00`).lte('opened_at', `${to}T23:59:59`).order('opened_at', { ascending: false }).limit(300)
      if (branch) q = q.eq('branch_id', branch)
      if (status) q = q.eq('status', status)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })
  const closed = (data ?? []).filter((s) => s.status === 'closed')
  const sales = closed.reduce((s, r) => s + Number(r.total_sales), 0)
  const diff = closed.reduce((s, r) => s + Number(r.difference ?? 0), 0)

  const cols: Column<any>[] = [
    { key: 'cashier', header: 'الموظف', render: (r) => <b>{r.cashier?.full_name}</b> },
    { key: 'branch', header: 'الفرع', render: (r) => r.branch?.name },
    { key: 'opened_at', header: 'البداية', render: (r) => fmtDateTime(r.opened_at) },
    { key: 'closed_at', header: 'النهاية', render: (r) => fmtDateTime(r.closed_at) },
    { key: 'opening_cash', header: 'الافتتاحي', render: (r) => fmtMoney(r.opening_cash) },
    { key: 'total_sales', header: 'إجمالي المبيعات', render: (r) => fmtMoney(r.total_sales) },
    { key: 'cash_sales', header: 'نقدي', render: (r) => fmtMoney(r.cash_sales) },
    { key: 'other_sales', header: 'طرق أخرى', render: (r) => fmtMoney(r.other_sales) },
    { key: 'returns_total', header: 'المرتجعات', render: (r) => fmtMoney(r.returns_total) },
    { key: 'expected_cash', header: 'المتوقع', render: (r) => (r.expected_cash == null ? '—' : fmtMoney(r.expected_cash)) },
    { key: 'actual_cash', header: 'الفعلي', render: (r) => (r.actual_cash == null ? '—' : fmtMoney(r.actual_cash)) },
    { key: 'difference', header: 'الفرق', render: (r) => (r.difference == null ? '—' : <b className={Number(r.difference) === 0 ? 'text-emerald-700' : 'text-red-600'}>{fmtMoney(r.difference)}</b>) },
    { key: 'status', header: 'الحالة', render: (r) => <Badge tone={r.status === 'open' ? 'amber' : 'green'}>{r.status === 'open' ? 'مفتوحة' : 'مغلقة'}</Badge> },
  ]

  return (
    <>
      <PageHeader title="الورديات" subtitle="سجل الورديات وفروقات الصندوق (الفتح والإغلاق من شاشة نقطة البيع)" />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        {seesAllBranches ? <BranchSelect includeAll value={branch} onChange={setBranch} /> : <div />}
        <Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">كل الحالات</option><option value="open">مفتوحة</option><option value="closed">مغلقة</option></Select>
        <StatCard label="مبيعات الورديات المغلقة" value={fmtMoney(sales)} sub={`صافي الفروقات ${fmtMoney(diff)}`} />
      </div>
      <DataTable columns={cols} rows={data} loading={isLoading} />
    </>
  )
}
