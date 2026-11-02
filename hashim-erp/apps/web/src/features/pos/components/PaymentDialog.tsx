import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, Trash2, UserPlus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { usePaymentMethods, useSetting } from '@/hooks/useLookups'
import { useDebounce } from '@/hooks/useDebounce'
import { useCart } from '@/store/cart.store'
import { fmtMoney, round2 } from '@/lib/formatters'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Field'

export interface PaymentLine { payment_method_id: string; amount: number; received_amount: number }

export function PaymentDialog({ total, onClose, onConfirm, busy }: {
  total: number; onClose: () => void; onConfirm: (payments: PaymentLine[]) => void; busy: boolean
}) {
  const { data: methods } = usePaymentMethods()
  const { data: creditCfg } = useSetting<{ value: boolean }>('sales.allow_credit', { value: true })
  const customer = useCart((s) => s.customer)
  const setCustomer = useCart((s) => s.setCustomer)
  const [lines, setLines] = useState<PaymentLine[]>([])
  const [cq, setCq] = useState('')
  const dcq = useDebounce(cq.trim(), 250)

  useEffect(() => {
    if (methods?.length && lines.length === 0) {
      const cash = methods.find((m) => m.is_cash) ?? methods[0]
      setLines([{ payment_method_id: cash.id, amount: total, received_amount: total }])
    }
  }, [methods]) // eslint-disable-line

  const { data: customers } = useQuery({
    queryKey: ['pos-customers', dcq], enabled: dcq.length >= 2,
    queryFn: async () => {
      const { data } = await supabase.from('customers').select('id,name,phone').eq('is_active', true).or(`name.ilike.%${dcq}%,phone.ilike.%${dcq}%`).limit(6)
      return data ?? []
    },
  })

  const paid = round2(lines.reduce((s, l) => s + (Number(l.amount) || 0), 0))
  const received = round2(lines.reduce((s, l) => s + (Number(l.received_amount) || 0), 0))
  const remaining = round2(total - paid)
  const change = Math.max(round2(received - paid), 0)
  const overpaid = paid > total
  const creditBlocked = remaining > 0 && creditCfg?.value === false
  const creditNeedsCustomer = remaining > 0 && !customer

  const update = (i: number, patch: Partial<PaymentLine>) => setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)))

  return (
    <Modal open onClose={onClose} title="إتمام الدفع" size="md"
      footer={<><Button variant="secondary" onClick={onClose}>رجوع</Button>
        <Button variant="success" size="lg" loading={busy} disabled={overpaid || creditNeedsCustomer || creditBlocked || lines.some((l) => !(l.amount > 0))} onClick={() => onConfirm(lines)}>إتمام البيع</Button></>}>
      <div className="mb-4 rounded-xl bg-brand-50 p-4 text-center">
        <div className="text-xs text-stone-500">المطلوب</div>
        <div className="text-3xl font-bold text-brand-700">{fmtMoney(total)}</div>
      </div>

      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
            <Select value={l.payment_method_id} onChange={(e) => update(i, { payment_method_id: e.target.value })}>
              {methods?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
            <Input type="number" min={0} step="any" placeholder="المبلغ" value={l.amount || ''}
              onChange={(e) => { const v = Number(e.target.value); update(i, { amount: v, received_amount: Math.max(v, l.received_amount) }) }} />
            <Input type="number" min={0} step="any" placeholder="المستلم" value={l.received_amount || ''} onChange={(e) => update(i, { received_amount: Number(e.target.value) })} />
            <button className="rounded p-2 text-red-500 hover:bg-red-50" onClick={() => setLines(lines.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        <div className="flex items-center gap-2 text-[11px] text-stone-400"><span className="flex-1">طريقة الدفع</span><span className="flex-1">المبلغ المحتسب</span><span className="flex-1">المبلغ المستلم</span><span className="w-8" /></div>
        <Button size="sm" variant="secondary" onClick={() => setLines([...lines, { payment_method_id: methods?.[0]?.id ?? '', amount: Math.max(remaining, 0), received_amount: Math.max(remaining, 0) }])}>
          <Plus className="h-4 w-4" /> إضافة طريقة دفع
        </Button>
      </div>

      <div className="mt-4 space-y-1 rounded-lg bg-cream-100 p-3 text-sm">
        <div className="flex justify-between"><span>المدفوع</span><b>{fmtMoney(paid)}</b></div>
        <div className="flex justify-between text-emerald-700"><span>الباقي للعميل</span><b>{fmtMoney(change)}</b></div>
        {remaining > 0 && <div className="flex justify-between text-red-600"><span>المتبقي (آجل)</span><b>{fmtMoney(remaining)}</b></div>}
        {creditBlocked && <div className="text-red-600">البيع الآجل غير مسموح — يجب سداد كامل المبلغ</div>}
        {overpaid && <div className="text-red-600">المبلغ المحتسب أكبر من الإجمالي — اجعل الزيادة في خانة «المستلم» فقط</div>}
      </div>

      <div className="mt-4">
        <div className="mb-1 flex items-center gap-1 text-xs font-semibold text-stone-600"><UserPlus className="h-4 w-4" /> العميل {remaining > 0 && <span className="text-red-600">(مطلوب للبيع الآجل)</span>}</div>
        {customer ? (
          <div className="flex items-center justify-between rounded-lg border border-cream-300 p-2 text-sm"><b>{customer.name}</b><button className="text-xs text-red-600" onClick={() => setCustomer(null)}>إزالة</button></div>
        ) : (
          <div className="relative">
            <Input placeholder="ابحث عن عميل بالاسم أو الهاتف (اختياري)" value={cq} onChange={(e) => setCq(e.target.value)} />
            {customers && dcq.length >= 2 && (
              <div className="absolute z-20 mt-1 w-full rounded-lg border bg-white shadow-lg">
                {customers.map((c) => <button key={c.id} className="block w-full px-3 py-2 text-start text-sm hover:bg-brand-50" onClick={() => { setCustomer({ id: c.id, name: c.name }); setCq('') }}>{c.name} <span className="text-xs text-stone-400">{c.phone}</span></button>)}
                {!customers.length && <div className="p-3 text-center text-xs text-stone-400">لا نتائج — أضف العميل من صفحة العملاء</div>}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
