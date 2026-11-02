import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Barcode, Camera, Minus, Plus, Search, Trash2, XCircle, LogOut } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errMsg } from '@/lib/errors'
import { toast } from '@/store/toast.store'
import { useAuth } from '@/store/auth.store'
import { computeTotals, useCart } from '@/store/cart.store'
import { useCategories, useOpenShift } from '@/hooks/useLookups'
import { useDebounce } from '@/hooks/useDebounce'
import { fmtMoney, fmtNum } from '@/lib/formatters'
import { isNative, scanBarcode } from '@/lib/platform'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Spinner'
import { ReceiptModal, type ReceiptData } from '@/components/shared/Receipt'
import { OpenShiftPanel } from '../components/ShiftGate'
import { CloseShiftDialog } from '../components/CloseShiftDialog'
import { PaymentDialog, type PaymentLine } from '../components/PaymentDialog'

export default function PosPage() {
  const userId = useAuth((s) => s.session?.user.id)
  const profile = useAuth((s) => s.profile)
  const { data: shift, isLoading } = useOpenShift(userId)
  if (isLoading) return <Spinner />
  if (!shift) return <OpenShiftPanel />
  return <PosScreen shift={shift} cashier={profile?.full_name ?? ''} branchName={profile?.branch.name ?? ''} />
}

function PosScreen({ shift, cashier, branchName }: { shift: any; cashier: string; branchName: string }) {
  const qc = useQueryClient()
  const cart = useCart()
  const barcodeRef = useRef<HTMLInputElement>(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [barcode, setBarcode] = useState('')
  const [payOpen, setPayOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [closeOpen, setCloseOpen] = useState(false)
  const [receipt, setReceipt] = useState<ReceiptData | null>(null)
  const dSearch = useDebounce(search.trim(), 250)
  const { data: cats } = useCategories()

  // المنتجات
  const { data: products, isLoading } = useQuery({
    queryKey: ['pos-products', dSearch, category],
    queryFn: async () => {
      let q = supabase
        .from('products')
        .select('id,name,barcode,sku,retail_price,image_url,tax:tax_rates(rate)')
        .eq('is_active', true)
        .order('name')
        .limit(60)
      if (category) q = q.eq('category_id', category)
      if (dSearch) q = q.or(`name.ilike.%${dSearch}%,barcode.ilike.%${dSearch}%,sku.ilike.%${dSearch}%`)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  // مخزون الفرع (المتاح = الحالي - المحجوز)
  const { data: stock } = useQuery({
    queryKey: ['pos-stock', shift.branch_id],
    refetchInterval: 20_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stock_balances')
        .select('product_id,qty_on_hand,qty_reserved')
        .eq('branch_id', shift.branch_id)
      if (error) throw error
      const m: Record<string, number> = {}
      data?.forEach((r) => {
        m[r.product_id] = Number(r.qty_on_hand) - Number(r.qty_reserved)
      })
      return m
    },
  })

  // سعر بيع الدفعة التي ستُباع أولاً (إن حُدِّد لها سعر خاص من صفحة التسعيرة)
  const { data: sellPrices } = useQuery({
    queryKey: ['pos-sell-prices', shift.branch_id],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data } = await supabase.from('v_current_sell_price').select('product_id,sell_price').eq('branch_id', shift.branch_id)
      const m: Record<string, number> = {}
      data?.forEach((r: any) => { if (r.sell_price != null) m[r.product_id] = Number(r.sell_price) })
      return m
    },
  })
  const priceOf = (p: any) => sellPrices?.[p.id] ?? Number(p.retail_price)
  const available = (id: string) => stock?.[id] ?? 0
  const totals = useMemo(() => computeTotals(cart.items, cart.headerDiscount), [cart.items, cart.headerDiscount])

  const addProduct = (p: any) => {
    const max = available(p.id)
    if (max <= 0) return toast.error(`نفدت الكمية: ${p.name}`)
    const err = cart.add({
      product_id: p.id,
      name: p.name,
      barcode: p.barcode,
      unit_price: priceOf(p),
      tax_rate: Number(p.tax?.rate ?? 0),
      max_qty: max,
    })
    if (err) toast.error(err)
  }

  const findByBarcode = async (code: string) => {
    const c = code.trim()
    if (!c) return
    const { data } = await supabase
      .from('products')
      .select('id,name,barcode,sku,retail_price,tax:tax_rates(rate)')
      .eq('is_active', true)
      .or(`barcode.eq.${c},sku.eq.${c}`)
      .maybeSingle()
    if (!data) toast.error('الباركود غير موجود')
    else addProduct(data)
    setBarcode('')
    barcodeRef.current?.focus()
  }

  const scanCamera = async () => {
    try {
      const code = await scanBarcode()
      if (code) await findByBarcode(code)
    } catch (e) {
      toast.error(errMsg(e))
    }
  }

  // إبقاء التركيز على حقل الباركود لقارئ USB
  useEffect(() => {
    barcodeRef.current?.focus()
  }, [])

  const confirmSale = async (payments: PaymentLine[]) => {
    setBusy(true)
    const payload = {
      customer_id: cart.customer?.id ?? null,
      discount: cart.headerDiscount,
      items: cart.items.map((i) => ({
        product_id: i.product_id,
        qty: i.qty,
        unit_price: i.unit_price,
        discount: i.discount,
      })),
      payments,
    }
    const { data, error } = await supabase.rpc('fn_create_sale', { p: payload })
    setBusy(false)
    if (error) return toast.error(errMsg(error))

    // جلب الفاتورة كاملة للطباعة
    const { data: inv } = await supabase
      .from('sales_invoices')
      .select(
        '*, items:sales_invoice_items(qty,unit_price,line_total,product:products(name)), pays:sales_payments(amount,method:payment_methods(name)), customer:customers(name)',
      )
      .eq('id', data.id)
      .single()
    if (inv) {
      setReceipt({
        invoice_no: inv.invoice_no,
        invoice_date: inv.invoice_date,
        branch: branchName,
        cashier,
        customer: inv.customer?.name,
        items: inv.items.map((i: any) => ({
          name: i.product?.name,
          qty: Number(i.qty),
          unit_price: Number(i.unit_price),
          line_total: Number(i.line_total),
        })),
        subtotal: Number(inv.subtotal),
        discount: Number(inv.discount),
        tax_amount: Number(inv.tax_amount),
        total: Number(inv.total),
        paid_amount: Number(inv.paid_amount),
        change_amount: Number(inv.change_amount),
        remaining: Number(inv.remaining),
        payments: inv.pays.map((p: any) => ({ method: p.method?.name, amount: Number(p.amount) })),
      })
    }
    toast.success(`تم البيع: ${data.invoice_no}`)
    cart.clear()
    setPayOpen(false)
    qc.invalidateQueries({ queryKey: ['pos-stock'] })
    qc.invalidateQueries({ queryKey: ['sales'] })
  }

  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-[1fr_420px]">
      {/* المنتجات */}
      <section className="flex min-h-0 flex-col p-3">
        <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <div className="relative">
            <Barcode className="pointer-events-none absolute start-3 top-2.5 h-4 w-4 text-stone-400" />
            <Input
              ref={barcodeRef}
              className="ps-9"
              dir="ltr"
              placeholder="امسح الباركود ثم Enter"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && findByBarcode(barcode)}
            />
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-2.5 h-4 w-4 text-stone-400" />
            <Input className="ps-9" placeholder="بحث بالاسم..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {isNative() && (
            <Button variant="secondary" onClick={scanCamera}>
              <Camera className="h-4 w-4" /> كاميرا
            </Button>
          )}
        </div>

        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
          {[{ id: '', name: 'الكل' }, ...(cats ?? [])].map((c) => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold ${
                category === c.id ? 'bg-brand-700 text-white' : 'bg-white text-stone-600 hover:bg-brand-50'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <Spinner />
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {products?.map((p: any) => {
                const q = available(p.id)
                return (
                  <button
                    key={p.id}
                    onClick={() => addProduct(p)}
                    disabled={q <= 0}
                    className="card flex flex-col overflow-hidden text-start transition hover:border-brand-400 disabled:opacity-40"
                  >
                    <div className="aspect-[4/3] w-full bg-cream-200">
                      {p.image_url && <img src={p.image_url} alt="" className="h-full w-full object-cover" />}
                    </div>
                    <div className="flex flex-1 flex-col p-2">
                      <div className="line-clamp-2 text-sm font-semibold leading-tight">{p.name}</div>
                      <div className="mt-auto flex items-center justify-between pt-1">
                        <b className="text-brand-700">{fmtMoney(priceOf(p))}</b>
                        <span className={`text-[11px] ${q <= 0 ? 'text-red-600' : 'text-stone-400'}`}>
                          {q <= 0 ? 'نافد' : `متاح ${fmtNum(q)}`}
                        </span>
                      </div>
                    </div>
                  </button>
                )
              })}
              {!products?.length && <div className="col-span-full p-10 text-center text-stone-400">لا توجد منتجات</div>}
            </div>
          )}
        </div>
      </section>

      {/* السلة */}
      <aside className="flex min-h-0 flex-col border-s border-cream-300 bg-white">
        <div className="flex items-center justify-between border-b border-cream-200 px-4 py-2.5">
          <b>السلة ({cart.items.length})</b>
          <div className="flex gap-1">
            {cart.items.length > 0 && (
              <Button size="sm" variant="ghost" className="text-red-600" onClick={() => cart.clear()}>
                <XCircle className="h-4 w-4" /> تفريغ
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setCloseOpen(true)}>
              <LogOut className="h-4 w-4" /> إغلاق الوردية
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 divide-y divide-cream-200 overflow-y-auto">
          {!cart.items.length && <div className="p-10 text-center text-sm text-stone-400">أضف منتجات لبدء عملية البيع</div>}
          {cart.items.map((i) => (
            <div key={i.product_id} className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-semibold leading-tight">{i.name}</div>
                <button onClick={() => cart.remove(i.product_id)} className="text-red-500">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div className="flex items-center rounded-lg border border-stone-300">
                  <button
                    className="p-2"
                    onClick={() => (i.qty > 1 ? cart.setQty(i.product_id, i.qty - 1) : cart.remove(i.product_id))}
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <input
                    type="number"
                    className="w-12 border-x border-cream-300 py-1 text-center text-sm outline-none"
                    value={i.qty}
                    onChange={(e) => cart.setQty(i.product_id, Number(e.target.value))}
                  />
                  <button className="p-2" onClick={() => cart.setQty(i.product_id, i.qty + 1)}>
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                <span className="text-xs text-stone-400">× {fmtMoney(i.unit_price, false)}</span>
                <input
                  type="number"
                  min={0}
                  placeholder="خصم"
                  className="input !w-20 !px-2 !py-1 text-xs"
                  value={i.discount || ''}
                  onChange={(e) => cart.setDiscount(i.product_id, Number(e.target.value))}
                />
                <b className="ms-auto text-sm">{fmtMoney(i.qty * i.unit_price - i.discount, false)}</b>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-2 border-t border-cream-300 bg-cream-100 p-4 text-sm">
          <div className="flex justify-between">
            <span>المجموع</span>
            <span>{fmtMoney(totals.subtotal)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>خصم على الفاتورة</span>
            <input
              type="number"
              min={0}
              className="input !w-28 !py-1 text-end"
              value={cart.headerDiscount || ''}
              onChange={(e) => cart.setHeaderDiscount(Number(e.target.value))}
            />
          </div>
          {totals.discount > 0 && (
            <div className="flex justify-between text-red-600">
              <span>إجمالي الخصم</span>
              <span>- {fmtMoney(totals.discount)}</span>
            </div>
          )}
          {totals.tax > 0 && (
            <div className="flex justify-between">
              <span>الضريبة</span>
              <span>{fmtMoney(totals.tax)}</span>
            </div>
          )}
          <div className="flex justify-between text-xl font-bold text-brand-700">
            <span>الصافي</span>
            <span>{fmtMoney(totals.total)}</span>
          </div>
          <Button variant="success" size="lg" className="w-full" disabled={!cart.items.length} onClick={() => setPayOpen(true)}>
            الدفع
          </Button>
        </div>
      </aside>

      {payOpen && <PaymentDialog total={totals.total} busy={busy} onClose={() => setPayOpen(false)} onConfirm={confirmSale} />}
      {closeOpen && <CloseShiftDialog shiftId={shift.id} onClose={() => setCloseOpen(false)} />}
      <ReceiptModal data={receipt} animate onClose={() => setReceipt(null)} />
    </div>
  )
}
