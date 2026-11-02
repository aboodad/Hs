import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardCheck, Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errMsg } from '@/lib/errors'
import { toast } from '@/store/toast.store'
import { useAuth } from '@/store/auth.store'
import { usePermission } from '@/hooks/usePermission'
import { fmtDateTime } from '@/lib/formatters'
import { PageHeader } from '@/components/shared/PageHeader'
import { BranchSelect } from '@/components/shared/BranchSelect'
import { DataTable, type Column } from '@/components/data/DataTable'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { Field, Input } from '@/components/ui/Field'

export const COUNT_STATUS: Record<string, [string, any]> = {
  draft: ['مسودة', 'gray'], in_progress: ['جارٍ', 'amber'], approved: ['معتمد', 'green'], cancelled: ['ملغى', 'red'],
}

export default function StockCountsPage() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const { can, seesAllBranches } = usePermission()
  const myBranch = useAuth((s) => s.profile?.branch_id) ?? ''
  const [open, setOpen] = useState(false)
  const [branch, setBranch] = useState(myBranch)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['stock-counts', 'list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_counts')
        .select('*, branch:branches(name), approver:profiles!approved_by(full_name)').order('created_at', { ascending: false }).limit(200)
      if (error) throw error
      return data ?? []
    },
  })

  const start = async () => {
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_start_stock_count', { p_branch: branch, p_note: note || null })
    setBusy(false)
    if (error) return toast.error(errMsg(error))
    toast.success('تم بدء الجرد')
    setOpen(false)
    qc.invalidateQueries({ queryKey: ['stock-counts'] })
    nav(`/inventory/counts/${data}`)
  }

  const cols: Column<any>[] = [
    { key: 'count_no', header: 'رقم الجرد', render: (r) => <b dir="ltr">{r.count_no}</b> },
    { key: 'branch', header: 'المخزن / الفرع', render: (r) => r.branch?.name },
    { key: 'started_at', header: 'بدأ في', render: (r) => fmtDateTime(r.started_at) },
    { key: 'status', header: 'الحالة', render: (r) => <StatusBadge map={COUNT_STATUS} value={r.status} /> },
    { key: 'approver', header: 'اعتمده', render: (r) => r.approver?.full_name ?? '—' },
    { key: 'approved_at', header: 'تاريخ الاعتماد', render: (r) => fmtDateTime(r.approved_at) },
  ]

  return (
    <>
      <PageHeader title="الجرد" subtitle="مطابقة الكميات الفعلية مع النظام"
        actions={can('stock_counts', 'create') && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> بدء جرد جديد</Button>} />
      <DataTable columns={cols} rows={data} loading={isLoading} onRowClick={(r) => nav(`/inventory/counts/${r.id}`)} />

      <Modal open={open} onClose={() => setOpen(false)} title="بدء جرد جديد" size="sm"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>إلغاء</Button><Button loading={busy} onClick={start}><ClipboardCheck className="h-4 w-4" /> بدء</Button></>}>
        <div className="space-y-4">
          {seesAllBranches && <Field label="المخزن / الفرع"><BranchSelect value={branch} onChange={setBranch} /></Field>}
          <Field label="ملاحظة"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <p className="text-xs text-brand-400">سيُسجَّل رصيد كل المنتجات الحالي كـ «كمية النظام»، ثم تُدخل الكميات الفعلية.</p>
        </div>
      </Modal>
    </>
  )
}
