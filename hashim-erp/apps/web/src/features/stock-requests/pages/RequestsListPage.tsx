import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { usePermission } from '@/hooks/usePermission'
import { fmtDateTime } from '@/lib/formatters'
import { REQUEST_STATUS } from '@/lib/status'
import { PageHeader } from '@/components/shared/PageHeader'
import { DataTable, type Column } from '@/components/data/DataTable'
import { StatusBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Field'

export default function RequestsListPage() {
  const nav = useNavigate()
  const { can } = usePermission()
  const [status, setStatus] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['requests', 'list', status],
    queryFn: async () => {
      let q = supabase.from('stock_requests')
        .select('*, branch:branches(name), creator:profiles!created_by(full_name), approver:profiles!approved_by(full_name), items:stock_request_items(id)')
        .order('created_at', { ascending: false }).limit(200)
      if (status) q = q.eq('status', status)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const cols: Column<any>[] = [
    { key: 'request_no', header: 'رقم الطلب', render: (r) => <b dir="ltr">{r.request_no}</b> },
    { key: 'branch', header: 'الفرع', render: (r) => r.branch?.name },
    { key: 'items', header: 'عدد الأصناف', render: (r) => r.items?.length ?? 0 },
    { key: 'status', header: 'الحالة', render: (r) => <StatusBadge map={REQUEST_STATUS} value={r.status} /> },
    { key: 'creator', header: 'أنشأه', render: (r) => r.creator?.full_name ?? '—' },
    { key: 'approver', header: 'اعتمده', render: (r) => r.approver?.full_name ?? '—' },
    { key: 'created_at', header: 'تاريخ الإنشاء', render: (r) => fmtDateTime(r.created_at) },
  ]

  return (
    <>
      <PageHeader title="طلبات البضاعة" subtitle="طلبات الفروع من المخزن الرئيسي"
        actions={<>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
            <option value="">كل الحالات</option>
            {Object.entries(REQUEST_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          {can('requests', 'create') && <Link to="/requests/new"><Button><Plus className="h-4 w-4" /> طلب جديد</Button></Link>}
        </>} />
      <DataTable columns={cols} rows={data} loading={isLoading} onRowClick={(r) => nav(`/requests/${r.id}`)} />
    </>
  )
}
