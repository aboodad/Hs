import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { usePermission } from '@/hooks/usePermission'
import { fmtDateTime, fmtMoney, toISODate } from '@/lib/formatters'
import { DOC_STATUS } from '@/lib/status'
import { PageHeader } from '@/components/shared/PageHeader'
import { BranchSelect } from '@/components/shared/BranchSelect'
import { DataTable, type Column } from '@/components/data/DataTable'
import { StatusBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'

export default function ExchangesListPage() {
  const { can, seesAllBranches } = usePermission()
  const [from, setFrom] = useState(toISODate(new Date(Date.now() - 29 * 86400000)))
  const [to, setTo] = useState(toISODate(new Date()))
  const [branch, setBranch] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['exchanges', from, to, branch],
    queryFn: async () => {
      let q = supabase.from('exchanges')
        .select('*, invoice:sales_invoices!original_invoice_id(invoice_no), branch:branches(name), customer:customers(name)')
        .gte('created_at', `${from}T00:00:00`).lte('created_at', `${to}T23:59:59`).order('created_at', { ascending: false }).limit(300)
      if (branch) q = q.eq('branch_id', branch)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })
  const cols: Column<any>[] = [
    { key: 'exchange_no', header: 'رقم الاستبدال', render: (r) => <b dir="ltr">{r.exchange_no}</b> },
    { key: 'invoice', header: 'الفاتورة الأصلية', render: (r) => <span dir="ltr">{r.invoice?.invoice_no}</span> },
    { key: 'created_at', header: 'التاريخ', render: (r) => fmtDateTime(r.created_at) },
    { key: 'branch', header: 'الفرع', render: (r) => r.branch?.name },
    { key: 'customer', header: 'العميل', render: (r) => r.customer?.name ?? 'نقدي' },
    { key: 'returned_total', header: 'قيمة المرجَع', render: (r) => fmtMoney(r.returned_total) },
    { key: 'new_total', header: 'قيمة البديل', render: (r) => fmtMoney(r.new_total) },
    { key: 'difference', header: 'الفرق', render: (r) => (
        <b className={Number(r.difference) > 0 ? 'text-emerald-700' : Number(r.difference) < 0 ? 'text-red-600' : ''}>
          {Number(r.difference) > 0 ? 'على العميل ' : Number(r.difference) < 0 ? 'للعميل ' : ''}{fmtMoney(Math.abs(Number(r.difference)))}</b>) },
    { key: 'status', header: 'الحالة', render: (r) => <StatusBadge map={DOC_STATUS} value={r.status} /> },
  ]
  return (
    <>
      <PageHeader title="استبدال المنتجات" subtitle="استبدال منتج بمنتج آخر مع تسوية فرق السعر"
        actions={can('exchanges', 'create') && <Link to="/exchanges/new"><Button><Plus className="h-4 w-4" /> استبدال جديد</Button></Link>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        {seesAllBranches ? <BranchSelect includeAll value={branch} onChange={setBranch} /> : <div />}
      </div>
      <DataTable columns={cols} rows={data} loading={isLoading} />
    </>
  )
}
