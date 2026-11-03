import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { usePermission } from '@/hooks/usePermission'
import { fmtDate, fmtMoney, toISODate } from '@/lib/formatters'
import { PAY_STATUS, DOC_STATUS } from '@/lib/status'
import { PageHeader } from '@/components/shared/PageHeader'
import { DataTable, type Column } from '@/components/data/DataTable'
import { StatusBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Field'

export default function PurchasesListPage() {
  const nav = useNavigate()
  const { can } = usePermission()
  const [from, setFrom] = useState(toISODate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)))
  const [to, setTo] = useState(toISODate(new Date()))
  const [pay, setPay] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['purchases', 'list', from, to, pay],
    queryFn: async () => {
      let q = supabase.from('purchase_invoices').select('*, supplier:suppliers(name)')
        .gte('invoice_date', from).lte('invoice_date', to).order('invoice_date', { ascending: false }).limit(300)
      if (pay) q = q.eq('payment_status', pay)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const cols: Column<any>[] = [
    { key: 'invoice_no', header: 'رقم الفاتورة', render: (r) => <b dir="ltr">{r.invoice_no}</b> },
    { key: 'supplier', header: 'المورد', render: (r) => r.supplier?.name },
    { key: 'invoice_date', header: 'التاريخ', render: (r) => fmtDate(r.invoice_date) },
    { key: 'discount', header: 'الخصم', render: (r) => fmtMoney(r.discount) },
    { key: 'tax_amount', header: 'الضريبة', render: (r) => fmtMoney(r.tax_amount) },
    { key: 'total', header: 'قيمة الفاتورة', render: (r) => <b>{fmtMoney(r.total)}</b> },
    { key: 'paid_amount', header: 'المدفوع', render: (r) => fmtMoney(r.paid_amount) },
    { key: 'remaining', header: 'المتبقي', render: (r) => (Number(r.remaining) > 0 ? <span className="text-red-600">{fmtMoney(r.remaining)}</span> : '—') },
    { key: 'payment_status', header: 'الدفع', render: (r) => <StatusBadge map={PAY_STATUS} value={r.payment_status} /> },
    { key: 'status', header: 'الحالة', render: (r) => <StatusBadge map={DOC_STATUS} value={r.status} /> },
  ]

  return (
    <>
      <PageHeader title="فواتير المشتريات"
        actions={<>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          <Select value={pay} onChange={(e) => setPay(e.target.value)} className="w-40">
            <option value="">كل حالات الدفع</option>{Object.entries(PAY_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</Select>
          <Link to="/purchases/returns" className="btn border border-cream-400 bg-white text-brand-700">المرتجعات</Link>
          {can('purchases', 'create') && <Link to="/purchases/new"><Button><Plus className="h-4 w-4" /> فاتورة شراء</Button></Link>}
        </>} />
      <DataTable columns={cols} rows={data} loading={isLoading} />
    </>
  )
}
