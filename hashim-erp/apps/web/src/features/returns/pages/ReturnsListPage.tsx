import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { toast } from '@/store/toast.store'
import { usePermission } from '@/hooks/usePermission'
import { fmtDateTime, fmtMoney, fmtNum, toISODate } from '@/lib/formatters'
import { DOC_STATUS } from '@/lib/status'
import { PageHeader } from '@/components/shared/PageHeader'
import { BranchSelect } from '@/components/shared/BranchSelect'
import { DataTable, type Column } from '@/components/data/DataTable'
import { Badge, StatusBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'

export default function ReturnsListPage() {
  const nav = useNavigate()
  const { can, seesAllBranches } = usePermission()
  const [from, setFrom] = useState(toISODate(new Date(Date.now() - 29 * 86400000)))
  const [to, setTo] = useState(toISODate(new Date()))
  const [branch, setBranch] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [invNo, setInvNo] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['returns', from, to, branch],
    queryFn: async () => {
      let q = supabase.from('sales_returns')
        .select('*, invoice:sales_invoices(invoice_no), branch:branches(name), customer:customers(name), method:payment_methods(name), items:sales_return_items(qty,condition,reason,refund_amount,product:products(name))')
        .gte('return_date', `${from}T00:00:00`).lte('return_date', `${to}T23:59:59`).order('return_date', { ascending: false }).limit(300)
      if (branch) q = q.eq('branch_id', branch)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  // بدء مرتجع جديد: بالبحث عن الفاتورة الأصلية
  const findInvoice = async () => {
    const { data: inv } = await supabase.from('sales_invoices').select('id').eq('invoice_no', invNo.trim()).maybeSingle()
    if (!inv) return toast.error('لم يتم العثور على فاتورة بهذا الرقم')
    nav(`/sales/${inv.id}`)
  }

  const cols: Column<any>[] = [
    { key: 'x', header: '', className: 'w-8', render: (r) => (open === r.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />) },
    { key: 'return_no', header: 'رقم المرتجع', render: (r) => <b dir="ltr">{r.return_no}</b> },
    { key: 'invoice', header: 'الفاتورة الأصلية', render: (r) => <span dir="ltr">{r.invoice?.invoice_no}</span> },
    { key: 'return_date', header: 'التاريخ', render: (r) => fmtDateTime(r.return_date) },
    { key: 'branch', header: 'الفرع', render: (r) => r.branch?.name },
    { key: 'customer', header: 'العميل', render: (r) => r.customer?.name ?? 'نقدي' },
    { key: 'reason', header: 'السبب', render: (r) => r.reason ?? '—' },
    { key: 'method', header: 'طريقة الاسترداد', render: (r) => r.method?.name ?? '—' },
    { key: 'refund_amount', header: 'المبلغ المسترد', render: (r) => <b>{fmtMoney(r.refund_amount)}</b> },
    { key: 'status', header: 'الحالة', render: (r) => <StatusBadge map={DOC_STATUS} value={r.status} /> },
  ]

  return (
    <>
      <PageHeader title="المرتجعات" subtitle="المنتجات التي أعادها العملاء"
        actions={can('returns', 'create') && <>
          <Input placeholder="رقم الفاتورة الأصلية" dir="ltr" className="w-60" value={invNo} onChange={(e) => setInvNo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && findInvoice()} />
          <Button onClick={findInvoice}><Search className="h-4 w-4" /> مرتجع جديد</Button></>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        {seesAllBranches ? <BranchSelect includeAll value={branch} onChange={setBranch} /> : <div />}
      </div>
      <DataTable columns={cols} rows={data} loading={isLoading} onRowClick={(r) => setOpen(open === r.id ? null : r.id)} />
      {data?.filter((r: any) => r.id === open).map((r: any) => (
        <div key={r.id} className="card mt-3 p-4">
          <b className="text-sm">بنود المرتجع {r.return_no}</b>
          <div className="mt-2 divide-y divide-cream-200">
            {r.items.map((i: any, k: number) => (
              <div key={k} className="flex items-center justify-between py-2 text-sm">
                <span>{i.product?.name} × {fmtNum(i.qty)} {i.reason && <span className="text-xs text-brand-300">· {i.reason}</span>}</span>
                <span className="flex items-center gap-3"><Badge tone={i.condition === 'resalable' ? 'green' : 'red'}>{i.condition === 'resalable' ? 'عاد للمخزون' : 'تالف'}</Badge><b>{fmtMoney(i.refund_amount)}</b></span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}
