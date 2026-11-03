import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { usePermission } from '@/hooks/usePermission'
import { useDebounce } from '@/hooks/useDebounce'
import { fmtDateTime, fmtMoney, toISODate } from '@/lib/formatters'
import { SALE_STATUS } from '@/lib/status'
import { PageHeader } from '@/components/shared/PageHeader'
import { BranchSelect } from '@/components/shared/BranchSelect'
import { DataTable, type Column } from '@/components/data/DataTable'
import { StatusBadge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Field'

export default function InvoicesListPage() {
  const nav = useNavigate()
  const { seesAllBranches } = usePermission()
  const today = toISODate(new Date())
  const [from, setFrom] = useState(toISODate(new Date(Date.now() - 6 * 86400000)))
  const [to, setTo] = useState(today)
  const [branch, setBranch] = useState('')
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const dSearch = useDebounce(search.trim())

  const { data, isLoading } = useQuery({
    queryKey: ['sales', 'list', from, to, branch, status, dSearch],
    queryFn: async () => {
      let q = supabase.from('sales_invoices')
        .select('*, branch:branches(name), customer:customers(name), seller:employees!sold_by(full_name)')
        .gte('invoice_date', `${from}T00:00:00`).lte('invoice_date', `${to}T23:59:59`)
        .order('invoice_date', { ascending: false }).limit(300)
      if (branch) q = q.eq('branch_id', branch)
      if (status) q = q.eq('status', status)
      if (dSearch) q = q.ilike('invoice_no', `%${dSearch}%`)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const total = (data ?? []).filter((r) => r.status !== 'cancelled').reduce((s, r) => s + Number(r.total), 0)

  const cols: Column<any>[] = [
    { key: 'invoice_no', header: 'رقم الفاتورة', render: (r) => <b dir="ltr">{r.invoice_no}</b> },
    { key: 'invoice_date', header: 'التاريخ', render: (r) => fmtDateTime(r.invoice_date) },
    { key: 'branch', header: 'الفرع', render: (r) => r.branch?.name },
    { key: 'customer', header: 'العميل', render: (r) => r.customer?.name ?? 'نقدي' },
    { key: 'seller', header: 'موظف البيع', render: (r) => r.seller?.full_name ?? '—' },
    { key: 'subtotal', header: 'الإجمالي', render: (r) => fmtMoney(r.subtotal) },
    { key: 'discount', header: 'الخصم', render: (r) => fmtMoney(r.discount) },
    { key: 'tax_amount', header: 'الضريبة', render: (r) => fmtMoney(r.tax_amount) },
    { key: 'total', header: 'الصافي', render: (r) => <b>{fmtMoney(r.total)}</b> },
    { key: 'remaining', header: 'المتبقي', render: (r) => (Number(r.remaining) > 0 ? <span className="text-red-600">{fmtMoney(r.remaining)}</span> : '—') },
    { key: 'status', header: 'الحالة', render: (r) => <StatusBadge map={SALE_STATUS} value={r.status} /> },
  ]

  return (
    <>
      <PageHeader title="فواتير المبيعات" subtitle={`${data?.length ?? 0} فاتورة · الإجمالي ${fmtMoney(total)}`} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="relative"><Search className="pointer-events-none absolute start-3 top-2.5 h-4 w-4 text-stone-400" />
          <Input className="ps-9" placeholder="رقم الفاتورة" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        {seesAllBranches ? <BranchSelect includeAll value={branch} onChange={setBranch} /> : <div />}
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">كل الحالات</option>
          {Object.entries(SALE_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
        </Select>
      </div>
      <DataTable columns={cols} rows={data} loading={isLoading} onRowClick={(r) => nav(`/sales/${r.id}`)} />
    </>
  )
}
