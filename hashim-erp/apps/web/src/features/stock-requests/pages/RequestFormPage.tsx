import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errMsg } from '@/lib/errors'
import { toast } from '@/store/toast.store'
import { useAuth } from '@/store/auth.store'
import { usePermission } from '@/hooks/usePermission'
import { PageHeader } from '@/components/shared/PageHeader'
import { ProductPicker, type PickedProduct } from '@/components/shared/ProductPicker'
import { BranchSelect } from '@/components/shared/BranchSelect'
import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Field'

interface Line { product: PickedProduct; qty: number; note: string }

export default function RequestFormPage() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const myBranch = useAuth((s) => s.profile?.branch_id) ?? ''
  const { seesAllBranches } = usePermission()
  const [branchId, setBranchId] = useState(myBranch)
  const [lines, setLines] = useState<Line[]>([])
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const add = (p: PickedProduct) => {
    if (lines.some((l) => l.product.id === p.id)) return toast.info('المنتج مضاف مسبقاً')
    setLines([...lines, { product: p, qty: 1, note: '' }])
  }
  const upd = (i: number, patch: Partial<Line>) => setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)))

  const submit = async () => {
    if (!branchId) return toast.error('اختر الفرع')
    if (!lines.length) return toast.error('أضف منتجاً واحداً على الأقل')
    if (lines.some((l) => !(l.qty > 0))) return toast.error('الكميات يجب أن تكون أكبر من صفر')
    setSaving(true)
    const { data: req, error } = await supabase.rpc('fn_create_stock_request', {
      p: { branch_id: branchId, note: note || null, items: lines.map((l) => ({ product_id: l.product.id, qty: l.qty, note: l.note || null })) },
    })
    if (error || !req) { setSaving(false); return toast.error(errMsg(error)) }
    setSaving(false)
    toast.success('تم إرسال الطلب')
    qc.invalidateQueries({ queryKey: ['requests'] })
    nav(`/requests/${(req as any).id}`)
  }

  return (
    <>
      <PageHeader title="طلب بضاعة جديد" />
      <div className="card space-y-4 p-5">
        {seesAllBranches && <Field label="الفرع الطالب" className="max-w-xs"><BranchSelect onlyBranches value={branchId} onChange={setBranchId} /></Field>}
        <Field label="إضافة منتج"><ProductPicker onPick={add} priceField="wholesale_price" /></Field>

        <div className="divide-y divide-cream-200 rounded-lg border border-cream-300">
          {!lines.length && <div className="p-8 text-center text-sm text-stone-400">لم تُضف منتجات بعد</div>}
          {lines.map((l, i) => (
            <div key={l.product.id} className="grid grid-cols-[1fr_110px_1fr_auto] items-center gap-2 p-3">
              <div className="text-sm font-semibold">{l.product.name}</div>
              <Input type="number" min={1} step="any" value={l.qty} onChange={(e) => upd(i, { qty: Number(e.target.value) })} />
              <Input placeholder="ملاحظة" value={l.note} onChange={(e) => upd(i, { note: e.target.value })} />
              <button onClick={() => setLines(lines.filter((_, k) => k !== i))} className="p-2 text-red-500"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>

        <Field label="ملاحظات الطلب"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => nav('/requests')}>إلغاء</Button>
          <Button loading={saving} onClick={submit}>إرسال الطلب</Button>
        </div>
      </div>
    </>
  )
}
