import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errMsg } from '@/lib/errors'
import { toast } from '@/store/toast.store'
import { useAuth } from '@/store/auth.store'
import { usePermission } from '@/hooks/usePermission'
import { fmtDate, fmtMoney, fmtNum, toISODate } from '@/lib/formatters'
import { PageHeader } from '@/components/shared/PageHeader'
import { BranchSelect } from '@/components/shared/BranchSelect'
import { StatCard } from '@/components/shared/StatCard'
import { ProductPicker, type PickedProduct } from '@/components/shared/ProductPicker'
import { DataTable, type Column } from '@/components/data/DataTable'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { Trash2 } from 'lucide-react'

const SRC: Record<string, string> = { manual: 'يدوي', sales_return: 'مرتجع/استبدال', count: 'جرد' }

export default function DamagedItemsPage() {
  const qc = useQueryClient()
  const { can, seesAllBranches } = usePermission()
  const myBranch = useAuth((s) => s.profile?.branch_id) ?? ''
  const [filterBranch, setFilterBranch] = useState('')
  const [from, setFrom] = useState(toISODate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)))
  const [to, setTo] = useState(toISODate(new Date()))
  const [open, setOpen] = useState(false)
  const [branch, setBranch] = useState(myBranch)
  const [product, setProduct] = useState<PickedProduct | null>(null)
  const [qty, setQty] = useState('1')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['damaged', filterBranch, from, to],
    queryFn: async () => {
      let q = supabase.from('damaged_items')
        .select('*, product:products(name), branch:branches(name), reporter:profiles!reported_by(full_name)')
        .gte('damaged_at', from).lte('damaged_at', to).order('damaged_at', { ascending: false }).limit(300)
      if (filterBranch) q = q.eq('branch_id', filterBranch)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })
  const total = (data ?? []).reduce((s, r) => s + Number(r.total_value), 0)

  const save = async () => {
    if (!product || !(Number(qty) > 0)) return toast.error('اختر المنتج وأدخل كمية صحيحة')
    setSaving(true)
    const { error } = await supabase.from('damaged_items').insert({ branch_id: branch, product_id: product.id, qty: Number(qty), reason: reason || null, source_type: 'manual' })
    setSaving(false)
    if (error) return toast.error(errMsg(error))
    toast.success('تم تسجيل التالف وخصمه من المخزون')
    setOpen(false); setProduct(null); setQty('1'); setReason('')
    qc.invalidateQueries({ queryKey: ['damaged'] }); qc.invalidateQueries({ queryKey: ['stock-status'] })
  }

  const cols: Column<any>[] = [
    { key: 'damaged_at', header: 'التاريخ', render: (r) => fmtDate(r.damaged_at) },
    { key: 'product', header: 'المنتج', render: (r) => <b>{r.product?.name}</b> },
    { key: 'qty', header: 'الكمية', render: (r) => fmtNum(r.qty) },
    { key: 'branch', header: 'الفرع / المخزن', render: (r) => r.branch?.name },
    { key: 'reason', header: 'السبب', render: (r) => r.reason ?? '—' },
    { key: 'source', header: 'المصدر', render: (r) => <Badge tone={r.source_type === 'manual' ? 'amber' : 'blue'}>{SRC[r.source_type]}</Badge> },
    { key: 'reporter', header: 'الموظف', render: (r) => r.reporter?.full_name ?? '—' },
    { key: 'total_value', header: 'قيمة التالف', render: (r) => <b className="text-red-700">{fmtMoney(r.total_value)}</b> },
  ]

  return (
    <>
      <PageHeader title="التالف" subtitle="تسجيل ومتابعة المنتجات التالفة"
        actions={can('damaged', 'create') && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> تسجيل تالف</Button>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        {seesAllBranches ? <BranchSelect includeAll value={filterBranch} onChange={setFilterBranch} /> : <div />}
        <StatCard label="إجمالي قيمة التالف" value={fmtMoney(total)} tone="red" />
      </div>
      <DataTable columns={cols} rows={data} loading={isLoading} />

      <Modal open={open} onClose={() => setOpen(false)} title="تسجيل منتج تالف" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>إلغاء</Button><Button loading={saving} onClick={save}>حفظ</Button></>}>
        <div className="space-y-4">
          {seesAllBranches && <Field label="الفرع / المخزن"><BranchSelect value={branch} onChange={setBranch} /></Field>}
          <Field label="المنتج *">
            {product ? <div className="flex items-center justify-between rounded-xl border border-cream-400 p-2.5 text-sm"><b>{product.name}</b><button className="text-xs text-red-600" onClick={() => setProduct(null)}><Trash2 className="h-4 w-4" /></button></div>
              : <ProductPicker onPick={setProduct} />}
          </Field>
          <Field label="الكمية *"><Input type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
          <Field label="السبب"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <p className="text-xs text-brand-400">تُخصم الكمية من المخزون تلقائياً وتُحسب القيمة بمتوسط التكلفة.</p>
        </div>
      </Modal>
    </>
  )
}
