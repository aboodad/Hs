import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { fmtDate, fmtMoney } from '@/lib/formatters'
import { TRANSFER_STATUS } from '@/lib/status'
import { PageHeader } from '@/components/shared/PageHeader'
import { DataTable, type Column } from '@/components/data/DataTable'
import { StatusBadge } from '@/components/ui/Badge'
import { Select } from '@/components/ui/Field'

export default function TransfersListPage() {
  const nav = useNavigate()
  const [status, setStatus] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['transfers', 'list', status],
    queryFn: async () => {
      let q = supabase.from('stock_transfers').select('*, from_b:branches!from_branch_id(name), to_b:branches!to_branch_id(name), items:stock_transfer_items(id)')
        .order('created_at', { ascending: false }).limit(200)
      if (status) q = q.eq('status', status)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })
  const cols: Column<any>[] = [
    { key: 'transfer_no', header: 'رقم التحويل', render: (r) => <b dir="ltr">{r.transfer_no}</b> },
    { key: 'from', header: 'من', render: (r) => r.from_b?.name },
    { key: 'to', header: 'إلى', render: (r) => r.to_b?.name },
    { key: 'transfer_date', header: 'التاريخ', render: (r) => fmtDate(r.transfer_date) },
    { key: 'items', header: 'الأصناف', render: (r) => r.items?.length ?? 0 },
    { key: 'val', header: 'القيمة (جملة)', render: (r) => fmtMoney(r.total_wholesale_value) },
    { key: 'status', header: 'الحالة', render: (r) => <StatusBadge map={TRANSFER_STATUS} value={r.status} /> },
  ]
  return (
    <>
      <PageHeader title="تحويلات البضاعة" subtitle="من المخزن الرئيسي إلى الفروع"
        actions={<Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
          <option value="">كل الحالات</option>{Object.entries(TRANSFER_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</Select>} />
      <DataTable columns={cols} rows={data} loading={isLoading} onRowClick={(r) => nav(`/transfers/${r.id}`)} />
    </>
  )
}
