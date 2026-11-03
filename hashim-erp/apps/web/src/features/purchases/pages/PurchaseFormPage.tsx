import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errMsg } from '@/lib/errors'
import { toast } from '@/store/toast.store'
import { useMainWarehouse, usePaymentMethods, useSuppliers } from '@/hooks/useLookups'
import { usePermission } from '@/hooks/usePermission'
import { fmtMoney, fmtNum, round2, toISODate } from '@/lib/formatters'
import { PageHeader } from '@/components/shared/PageHeader'
import { ProductPicker, type PickedProduct } from '@/components/shared/ProductPicker'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'

interface Line { product: PickedProduct; qty: number; unit_cost: number; discount: number; tax_rate: number }

export default function PurchaseFormPage() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const { data: main } = useMainWarehouse()
  const { data: methods } = usePaymentMethods()
  const { can } = usePermission()
  const [supplier, setSupplier] = useState('')
  const [date, setDate] = useState(toISODate(new Date()))
  const [lines, setLines] = useState<Line[]>([])
  const [discount, setDiscount] = useState(0)
  const [extra, setExtra] = useState(0)
  const [paid, setPaid] = useState(0)
  const [method, setMethod] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: suppliers } = useSuppliers()

  // دفعات المخزون الحالية للمنتجات المضافة (لتنبيه المستخدم أن السعر الجديد ينشئ دفعة مستقلة)
  const ids = lines.map((l) => l.product.id)
  const { data: lots } = useQuery({
    queryKey: ['purchase-lots', main?.id, ids.join(',')], enabled: !!main && ids.length > 0 && can('pricing', 'view'),
    queryFn: async () => (await supabase.from('stock_layers').select('product_id,purchase_price,qty_on_hand').eq('branch_id', main!.id).in('product_id', ids).gt('qty_on_hand', 0)).data ?? [],
  })

  const add = (p: PickedProduct) => {
    if (lines.some((l) => l.product.id === p.id)) return toast.info('المنتج مضاف مسبقاً')
    setLines([...lines, { product: p, qty: 1, unit_cost: Number(p.cost_price), discount: 0, tax_rate: 0 }])
  }
  const upd = (i: number, patch: Partial<Line>) => setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)))

  // نفس معادلات fn_post_purchase
  const totals = useMemo(() => {
    let subtotal = 0, ldisc = 0, tax = 0
    lines.forEach((l) => {
      const net = l.qty * l.unit_cost - l.discount
      subtotal += l.qty * l.unit_cost; ldisc += l.discount; tax += round2((net * l.tax_rate) / 100)
    })
    const disc = ldisc + discount
    const total = round2(subtotal - disc + tax + extra)
    return { subtotal: round2(subtotal), disc: round2(disc), tax: round2(tax), total }
  }, [lines, discount, extra])

  const submit = async () => {
    if (!supplier) return toast.error('اختر المورد')
    if (!main) return toast.error('المخزن الرئيسي غير موجود')
    if (!lines.length) return toast.error('أضف منتجاً واحداً على الأقل')
    if (paid > totals.total) return toast.error('المدفوع أكبر من قيمة الفاتورة')
    setSaving(true)
    const { data, error } = await supabase.rpc('fn_post_purchase', { p: {
      supplier_id: supplier, branch_id: main.id, invoice_date: date, discount, extra_costs: extra, note: note || null,
      paid_amount: paid, payment_method_id: method || null,
      items: lines.map((l) => ({ product_id: l.product.id, qty: l.qty, unit_cost: l.unit_cost, discount: l.discount, tax_rate: l.tax_rate })),
    } })
    setSaving(false)
    if (error) return toast.error(errMsg(error))
    toast.success(`تم ترحيل الفاتورة ${data.invoice_no}`)
    qc.invalidateQueries({ queryKey: ['purchases'] }); qc.invalidateQueries({ queryKey: ['stock-status'] })
    nav('/purchases')
  }

  return (
    <>
      <PageHeader title="فاتورة شراء جديدة" subtitle="تدخل البضاعة إلى المخزن الرئيسي عند الترحيل" />
      <div className="card space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="المورد *"><Select value={supplier} onChange={(e) => setSupplier(e.target.value)}><option value="">— اختر —</option>{suppliers?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="تاريخ الفاتورة"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="المخزن المستلم"><Input disabled value={main?.name ?? '...'} /></Field>
        </div>

        <Field label="إضافة منتج"><ProductPicker onPick={add} priceField="cost_price" /></Field>

        <div className="overflow-x-auto rounded-lg border border-cream-300">
          <table className="w-full text-sm">
            <thead className="bg-cream-200 text-xs text-brand-700"><tr>
              <th className="px-3 py-2 text-start">المنتج</th><th className="px-2 text-start">الكمية</th><th className="px-2 text-start">سعر الشراء</th>
              <th className="px-2 text-start">الخصم</th><th className="px-2 text-start">ضريبة %</th><th className="px-2 text-start">الإجمالي</th><th /></tr></thead>
            <tbody className="divide-y divide-cream-200">
              {!lines.length && <tr><td colSpan={7} className="p-8 text-center text-stone-400">لم تُضف منتجات بعد</td></tr>}
              {lines.map((l, i) => (
                <tr key={l.product.id}>
                  <td className="px-3 py-2 font-semibold">{l.product.name}<LotHint lots={(lots ?? []).filter((x: any) => x.product_id === l.product.id)} price={l.qty > 0 ? l.unit_cost - l.discount / l.qty : l.unit_cost} /></td>
                  <td className="px-2"><Input type="number" min={0} step="any" className="!w-24" value={l.qty} onChange={(e) => upd(i, { qty: Number(e.target.value) })} /></td>
                  <td className="px-2"><Input type="number" min={0} step="any" className="!w-28" value={l.unit_cost} onChange={(e) => upd(i, { unit_cost: Number(e.target.value) })} /></td>
                  <td className="px-2"><Input type="number" min={0} step="any" className="!w-24" value={l.discount} onChange={(e) => upd(i, { discount: Number(e.target.value) })} /></td>
                  <td className="px-2"><Input type="number" min={0} step="any" className="!w-20" value={l.tax_rate} onChange={(e) => upd(i, { tax_rate: Number(e.target.value) })} /></td>
                  <td className="px-2 font-semibold">{fmtMoney(l.qty * l.unit_cost - l.discount)}</td>
                  <td className="px-2"><button className="p-2 text-red-500" onClick={() => setLines(lines.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <Field label="طريقة الدفع"><Select value={method} onChange={(e) => setMethod(e.target.value)}><option value="">— بدون دفع —</option>{methods?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
            <Field label="المبلغ المدفوع"><Input type="number" min={0} step="any" value={paid} onChange={(e) => setPaid(Number(e.target.value))} /></Field>
            <Field label="ملاحظات"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
          <div className="space-y-2 rounded-xl bg-cream-100 p-4 text-sm">
            <div className="flex justify-between"><span>المجموع</span><span>{fmtMoney(totals.subtotal)}</span></div>
            <div className="flex items-center justify-between"><span>خصم على الفاتورة</span><Input type="number" min={0} className="!w-32 text-end" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} /></div>
            <div className="flex items-center justify-between"><span>تكاليف إضافية (شحن/جمارك)</span><Input type="number" min={0} className="!w-32 text-end" value={extra} onChange={(e) => setExtra(Number(e.target.value))} /></div>
            <div className="flex justify-between"><span>الضريبة</span><span>{fmtMoney(totals.tax)}</span></div>
            <div className="flex justify-between border-t border-cream-300 pt-2 text-lg font-bold text-brand-700"><span>الإجمالي</span><span>{fmtMoney(totals.total)}</span></div>
            <div className="flex justify-between text-red-600"><span>المتبقي</span><b>{fmtMoney(Math.max(totals.total - paid, 0))}</b></div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => nav('/purchases')}>إلغاء</Button>
          <Button size="lg" loading={saving} onClick={submit}>ترحيل الفاتورة</Button>
        </div>
      </div>
    </>
  )
}

/** تنبيه التسعيرة: هل سعر الشراء الجديد يطابق دفعة موجودة أم ينشئ دفعة جديدة؟ */
function LotHint({ lots, price }: { lots: { purchase_price: number; qty_on_hand: number }[]; price: number }) {
  if (!lots.length) return null
  const p = Math.round(price * 100) / 100
  const same = lots.find((l) => Math.round(Number(l.purchase_price) * 100) / 100 === p)
  if (same) return <div className="mt-0.5 text-[11px] font-normal text-emerald-700">يُضاف إلى دفعة بنفس السعر ({fmtNum(same.qty_on_hand)} قطعة حالياً)</div>
  return (
    <div className="mt-0.5 text-[11px] font-normal text-gold-800">
      سعر جديد ← تُنشأ دفعة مستقلة · الموجود: {lots.map((l) => `${fmtNum(l.qty_on_hand)} × ${fmtMoney(l.purchase_price, false)}`).join('، ')}
    </div>
  )
}
