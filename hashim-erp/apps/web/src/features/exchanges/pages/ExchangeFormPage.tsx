import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errMsg } from '@/lib/errors'
import { toast } from '@/store/toast.store'
import { useAuth } from '@/store/auth.store'
import { useOpenShift, usePaymentMethods } from '@/hooks/useLookups'
import { fmtMoney, fmtNum, round2 } from '@/lib/formatters'
import { PageHeader } from '@/components/shared/PageHeader'
import { ProductPicker, type PickedProduct } from '@/components/shared/ProductPicker'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'

interface Given { product: PickedProduct; qty: number; price: number }

export default function ExchangeFormPage() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const userId = useAuth((s) => s.session?.user.id)
  const { data: shift } = useOpenShift(userId)
  const { data: methods } = usePaymentMethods()
  const [invNo, setInvNo] = useState('')
  const [invId, setInvId] = useState('')
  const [rQty, setRQty] = useState<Record<string, number>>({})
  const [rCond, setRCond] = useState<Record<string, string>>({})
  const [given, setGiven] = useState<Given[]>([])
  const [method, setMethod] = useState('')
  const [busy, setBusy] = useState(false)

  const { data: inv } = useQuery({
    queryKey: ['exchange-invoice', invId], enabled: !!invId,
    queryFn: async () => {
      const { data, error } = await supabase.from('sales_invoices')
        .select('id,invoice_no,status,items:sales_invoice_items(id,qty,line_total,product:products(name))').eq('id', invId).single()
      if (error) throw error
      return data
    },
  })
  // المرتجع سابقاً من كل بند (مرتجعات + استبدالات)
  const { data: prev } = useQuery({
    queryKey: ['exchange-prev', invId], enabled: !!invId,
    queryFn: async () => {
      const m: Record<string, number> = {}
      const a = await supabase.from('sales_return_items').select('invoice_item_id,qty,sales_returns!inner(status,invoice_id)').eq('sales_returns.invoice_id', invId).eq('sales_returns.status', 'posted')
      a.data?.forEach((r: any) => { m[r.invoice_item_id] = (m[r.invoice_item_id] ?? 0) + Number(r.qty) })
      const b = await supabase.from('exchange_items').select('invoice_item_id,qty,exchanges!inner(status,original_invoice_id)').eq('direction', 'returned').eq('exchanges.original_invoice_id', invId).eq('exchanges.status', 'posted')
      b.data?.forEach((r: any) => { if (r.invoice_item_id) m[r.invoice_item_id] = (m[r.invoice_item_id] ?? 0) + Number(r.qty) })
      return m
    },
  })

  const find = async () => {
    const { data } = await supabase.from('sales_invoices').select('id').eq('invoice_no', invNo.trim()).maybeSingle()
    if (!data) return toast.error('لم يتم العثور على الفاتورة')
    setInvId(data.id); setRQty({}); setRCond({}); setGiven([])
  }

  const totals = useMemo(() => {
    let ret = 0
    inv?.items.forEach((i: any) => { ret += ((rQty[i.id] ?? 0) * Number(i.line_total)) / Number(i.qty) })
    const nw = given.reduce((s, g) => s + g.qty * g.price, 0)
    return { ret: round2(ret), nw: round2(nw), diff: round2(nw - ret) }
  }, [inv, rQty, given])

  const addGiven = (p: PickedProduct) => {
    if (given.some((g) => g.product.id === p.id)) return toast.info('المنتج مضاف مسبقاً')
    setGiven([...given, { product: p, qty: 1, price: Number(p.retail_price) }])
  }

  const submit = async () => {
    const returned = Object.entries(rQty).filter(([, q]) => q > 0).map(([invoice_item_id, qty]) => ({ invoice_item_id, qty, condition: rCond[invoice_item_id] ?? 'resalable' }))
    if (!returned.length) return toast.error('حدد المنتج المرجَع وكميته')
    if (!given.length) return toast.error('أضف المنتج البديل')
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_post_exchange', { p: {
      invoice_id: invId, settlement_method_id: method || methods?.find((m) => m.is_cash)?.id, returned,
      given: given.map((g) => ({ product_id: g.product.id, qty: g.qty, unit_price: g.price })),
    } })
    setBusy(false)
    if (error) return toast.error(errMsg(error))
    toast.success(`تم الاستبدال ${data.exchange_no}`)
    qc.invalidateQueries({ queryKey: ['exchanges'] }); qc.invalidateQueries({ queryKey: ['stock-status'] })
    nav('/exchanges')
  }

  return (
    <>
      <PageHeader title="استبدال جديد" subtitle="اختر الفاتورة الأصلية ثم المنتج المرجَع والبديل" />
      {!shift && <div className="mb-4 rounded-xl border border-gold-300 bg-gold-50 p-3 text-sm text-gold-800">يلزم فتح وردية لتسجيل فرق الاستبدال في صندوق الوردية.</div>}

      <div className="card space-y-5 p-5">
        <div className="flex max-w-xl items-end gap-2">
          <Field label="رقم الفاتورة الأصلية" className="flex-1"><Input dir="ltr" value={invNo} onChange={(e) => setInvNo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && find()} /></Field>
          <Button onClick={find}><Search className="h-4 w-4" /> بحث</Button>
        </div>

        {inv && (<>
          <div>
            <h3 className="mb-2 text-sm font-bold text-brand-700">المنتجات المرجَعة من الفاتورة {inv.invoice_no}</h3>
            <div className="space-y-2">
              {inv.items.map((i: any) => {
                const left = Number(i.qty) - (prev?.[i.id] ?? 0)
                return (
                  <div key={i.id} className="grid grid-cols-[1fr_100px_140px] items-center gap-2 rounded-xl border border-cream-300 p-2.5 text-sm">
                    <div>{i.product?.name}<div className="text-xs text-brand-300">المتاح للإرجاع: {fmtNum(left)}</div></div>
                    <Input type="number" min={0} max={left} disabled={left <= 0} placeholder="الكمية" value={rQty[i.id] || ''} onChange={(e) => setRQty({ ...rQty, [i.id]: Math.min(Number(e.target.value), left) })} />
                    <Select value={rCond[i.id] ?? 'resalable'} onChange={(e) => setRCond({ ...rCond, [i.id]: e.target.value })}><option value="resalable">صالح للبيع</option><option value="damaged">تالف</option></Select>
                  </div>
                )
              })}
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-bold text-brand-700">المنتجات البديلة</h3>
            <ProductPicker onPick={addGiven} priceField="retail_price" />
            <div className="mt-2 space-y-2">
              {given.map((g, k) => (
                <div key={g.product.id} className="grid grid-cols-[1fr_100px_120px_auto] items-center gap-2 rounded-xl border border-cream-300 p-2.5 text-sm">
                  <b>{g.product.name}</b>
                  <Input type="number" min={1} step="any" value={g.qty} onChange={(e) => setGiven(given.map((x, i) => (i === k ? { ...x, qty: Number(e.target.value) } : x)))} />
                  <Input type="number" min={0} step="any" value={g.price} onChange={(e) => setGiven(given.map((x, i) => (i === k ? { ...x, price: Number(e.target.value) } : x)))} />
                  <button className="p-2 text-red-500" onClick={() => setGiven(given.filter((_, i) => i !== k))}><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Field label="طريقة تسوية الفرق"><Select value={method} onChange={(e) => setMethod(e.target.value)}><option value="">نقدي (افتراضي)</option>{methods?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
            <div className="space-y-1.5 rounded-2xl bg-cream-100 p-4 text-sm">
              <div className="flex justify-between"><span>قيمة المنتج المرجَع (شاملة الضريبة)</span><b>{fmtMoney(totals.ret)}</b></div>
              <div className="flex justify-between"><span>قيمة البديل (قبل الضريبة)</span><b>{fmtMoney(totals.nw)}</b></div>
              <div className={`flex justify-between border-t border-cream-300 pt-2 text-base font-bold ${totals.diff > 0 ? 'text-emerald-700' : totals.diff < 0 ? 'text-red-600' : ''}`}>
                <span>{totals.diff > 0 ? 'المطلوب من العميل' : totals.diff < 0 ? 'المطلوب إرجاعه للعميل' : 'بدون فرق'}</span><span>{fmtMoney(Math.abs(totals.diff))}</span></div>
              <p className="text-[11px] text-brand-300">الرقم النهائي يحسبه الخادم (الضريبة تُضاف على البديل حسب المنتج).</p>
            </div>
          </div>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => nav('/exchanges')}>إلغاء</Button><Button variant="gold" size="lg" loading={busy} disabled={!shift} onClick={submit}>تنفيذ الاستبدال</Button></div>
        </>)}
      </div>
    </>
  )
}
