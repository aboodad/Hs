import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, FileSpreadsheet, History, Layers, Pencil, Printer, Search, Tag, TrendingDown, TrendingUp } from 'lucide-react'
import clsx from 'clsx'
import { supabase } from '@/lib/supabase'
import { errMsg } from '@/lib/errors'
import { toast } from '@/store/toast.store'
import { useAuth } from '@/store/auth.store'
import { usePermission } from '@/hooks/usePermission'
import { useCategories, useMainWarehouse, useSetting } from '@/hooks/useLookups'
import { fmtDate, fmtDateTime, fmtMoney, fmtNum } from '@/lib/formatters'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatCard } from '@/components/shared/StatCard'
import { BranchSelect } from '@/components/shared/BranchSelect'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Field, Input, Select } from '@/components/ui/Field'
import { Skeleton } from '@/components/ui/Skeleton'

const MOVE: Record<string, string> = {
  opening: 'رصيد افتتاحي', purchase: 'توريد', purchase_return: 'مرتجع شراء', sale: 'بيع', sale_return: 'مرتجع بيع',
  transfer_out: 'تحويل صادر', transfer_in: 'تحويل وارد', count_adjustment: 'تسوية جرد', damage: 'تالف',
  exchange_in: 'استبدال (وارد)', exchange_out: 'استبدال (صادر)', adjustment: 'تعديل',
}

interface Lot {
  id: string; branch_id: string; product_id: string; purchase_price: number; unit_cost: number
  qty_on_hand: number; qty_reserved: number; qty_received: number
  retail_price: number | null; wholesale_price: number | null
  first_received_at: string; last_received_at: string; is_legacy: boolean; note: string | null
  product: { name: string; barcode: string | null; sku: string; retail_price: number; wholesale_price: number; category_id: string | null }
  branch: { name: string }
}
interface Group { product_id: string; product: Lot['product']; lots: Lot[]; active: Lot[]; qty: number; avgCost: number; min: number; max: number; multi: boolean }

export default function PricingPage() {
  const qc = useQueryClient()
  const { can, seesAllBranches } = usePermission()
  const myBranch = useAuth((s) => s.profile?.branch_id) ?? ''
  const { data: main } = useMainWarehouse()
  const { data: cats } = useCategories()
  const { data: orderCfg } = useSetting<{ value: string }>('inventory.lot_order', { value: 'fifo' })
  const lifo = orderCfg?.value === 'lifo'

  const [branch, setBranch] = useState('')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [multiOnly, setMultiOnly] = useState(false)
  const [hideEmpty, setHideEmpty] = useState(true)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [edit, setEdit] = useState<Lot | null>(null)
  const [hist, setHist] = useState<Lot | null>(null)

  useEffect(() => { if (!branch) setBranch(seesAllBranches ? main?.id ?? '' : myBranch) }, [main, seesAllBranches, myBranch]) // eslint-disable-line

  const { data, isLoading } = useQuery({
    queryKey: ['layers', branch], enabled: !!branch,
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_layers')
        .select('*, product:products(name,barcode,sku,retail_price,wholesale_price,category_id), branch:branches(name)')
        .eq('branch_id', branch).limit(5000)
      if (error) throw error
      return (data ?? []) as unknown as Lot[]
    },
  })

  // ───── تجميع الدفعات حسب المنتج ─────
  const groups = useMemo<Group[]>(() => {
    const m = new Map<string, Lot[]>()
    ;(data ?? []).forEach((l) => m.set(l.product_id, [...(m.get(l.product_id) ?? []), { ...l, qty_on_hand: Number(l.qty_on_hand), qty_reserved: Number(l.qty_reserved), purchase_price: Number(l.purchase_price), unit_cost: Number(l.unit_cost) }]))
    const out: Group[] = []
    m.forEach((lots, pid) => {
      lots.sort((a, b) => (lifo ? -1 : 1) * (new Date(a.first_received_at).getTime() - new Date(b.first_received_at).getTime()))
      const active = lots.filter((l) => l.qty_on_hand > 0)
      const qty = active.reduce((s, l) => s + l.qty_on_hand, 0)
      const avgCost = qty ? active.reduce((s, l) => s + l.qty_on_hand * l.unit_cost, 0) / qty : 0
      const prices = active.map((l) => l.purchase_price)
      out.push({ product_id: pid, product: lots[0].product, lots, active, qty, avgCost, min: prices.length ? Math.min(...prices) : 0, max: prices.length ? Math.max(...prices) : 0, multi: active.length > 1 })
    })
    return out.sort((a, b) => Number(b.multi) - Number(a.multi) || a.product.name.localeCompare(b.product.name, 'ar'))
  }, [data, lifo])

  const shown = groups.filter((g) =>
    (!search || `${g.product.name} ${g.product.barcode ?? ''} ${g.product.sku}`.toLowerCase().includes(search.toLowerCase())) &&
    (!category || g.product.category_id === category) && (!multiOnly || g.multi) && (!hideEmpty || g.active.length > 0))

  const stats = useMemo(() => {
    const active = groups.flatMap((g) => g.active)
    return {
      multi: groups.filter((g) => g.multi).length,
      lots: active.length,
      value: active.reduce((s, l) => s + l.qty_on_hand * l.unit_cost, 0),
      maxGap: Math.max(0, ...groups.filter((g) => g.multi).map((g) => g.max - g.min)),
    }
  }, [groups])

  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const isOpen = (g: Group) => open.has(g.product_id) || (g.multi && !open.has('-' + g.product_id))
  const flip = (g: Group) => (g.multi ? setOpen((s) => { const n = new Set(s); n.has('-' + g.product_id) ? n.delete('-' + g.product_id) : n.add('-' + g.product_id); return n }) : toggle(g.product_id))

  const exportCsv = () => {
    const rows = shown.flatMap((g) => (hideEmpty ? g.active : g.lots).map((l) => [g.product.name, g.product.barcode ?? '', l.purchase_price, l.unit_cost, l.qty_on_hand, l.qty_reserved, l.retail_price ?? g.product.retail_price, l.wholesale_price ?? g.product.wholesale_price, fmtDate(l.first_received_at), fmtDate(l.last_received_at)]))
    if (!rows.length) return toast.error('لا بيانات للتصدير')
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const head = ['المنتج', 'الباركود', 'سعر الشراء', 'التكلفة الفعلية', 'الكمية', 'محجوز', 'سعر البيع', 'سعر الجملة', 'أول توريد', 'آخر توريد']
    const blob = new Blob(['\ufeff' + [head, ...rows].map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `pricing-${new Date().toISOString().slice(0, 10)}.csv`; a.click()
  }

  return (
    <>
      <PageHeader title="التسعيرة" subtitle="المنتج الواحد مقسَّم إلى دفعات حسب سعر الشراء — افصل مخزون السعر القديم عن الجديد"
        actions={<>
          {seesAllBranches && <BranchSelect value={branch} onChange={setBranch} className="!w-52" />}
          {can('pricing', 'export') && <Button variant="secondary" onClick={exportCsv}><FileSpreadsheet className="h-4 w-4" /> Excel</Button>}
          {can('pricing', 'print') && <Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" /> طباعة</Button>}
        </>} />

      <div className="no-print mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard variant="hero" label="منتجات بأكثر من سعر" value={fmtNum(stats.multi)} icon={Layers} loading={isLoading} delay={40} sub="تحتاج متابعة التسعير" />
        <StatCard label="دفعات برصيد" value={fmtNum(stats.lots)} icon={Tag} loading={isLoading} delay={80} />
        <StatCard label="قيمة المخزون (بالتكلفة)" value={fmtMoney(stats.value)} icon={TrendingUp} tone="green" loading={isLoading} delay={120} />
        <StatCard label="أكبر فرق سعر شراء" value={fmtMoney(stats.maxGap)} icon={TrendingDown} tone="red" loading={isLoading} delay={160} sub="بين أقدم وأحدث دفعة" />
      </div>

      <div className="no-print mb-4 grid gap-3 lg:grid-cols-[1fr_220px_auto]">
        <div className="relative"><Search className="pointer-events-none absolute start-3.5 top-3 h-4 w-4 text-brand-300" />
          <Input className="ps-10" placeholder="ابحث بالاسم أو الباركود..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <Select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">كل التصنيفات</option>{cats?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <div className="flex items-center gap-4 text-sm text-brand-600">
          <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={multiOnly} onChange={(e) => setMultiOnly(e.target.checked)} />أسعار متعددة فقط</label>
          <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />إخفاء الدفعات الفارغة</label>
        </div>
      </div>

      <div className="no-print mb-3 rounded-xl border border-gold-200 bg-gold-50/70 px-4 py-2.5 text-xs text-gold-800">
        ترتيب الصرف الحالي: <b>{lifo ? 'الأحدث أولاً (LIFO)' : 'الأقدم أولاً (FIFO)'}</b> — الدفعة الموسومة «تُباع أولاً» هي التي يخرج منها البيع والتحويل تلقائياً.
        {can('settings', 'view') && <> يُغيَّر من <Link to="/settings" className="font-bold underline">الإعدادات ← المخزون</Link>.</>}
      </div>

      <div id="report-print" className="space-y-3">
        {isLoading ? <Skeleton className="h-64 w-full" /> : !shown.length ? (
          <div className="card p-16 text-center text-brand-300">لا توجد دفعات مطابقة. تُنشأ الدفعات تلقائياً عند ترحيل فاتورة شراء.</div>
        ) : shown.map((g, gi) => (
          <section key={g.product_id} style={{ animationDelay: `${Math.min(gi, 8) * 40}ms` }} className="card fade-up overflow-hidden">
            <button onClick={() => flip(g)} className="flex w-full items-center gap-4 p-4 text-start transition hover:bg-cream-50">
              <span className={clsx('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl', g.multi ? 'tile-gold' : 'bg-cream-200 text-brand-500')}><Layers className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <b className="truncate text-[15px] text-brand-800">{g.product.name}</b>
                  {g.multi ? <Badge tone="amber">{g.active.length} أسعار</Badge> : <Badge tone="gray">سعر واحد</Badge>}
                </div>
                <div className="mt-0.5 text-xs text-brand-300" dir="ltr" style={{ textAlign: 'right' }}>{g.product.barcode ?? g.product.sku}</div>
              </div>
              <div className="hidden text-end sm:block"><div className="text-[11px] text-brand-300">نطاق سعر الشراء</div><b className="text-sm tabular-nums text-brand-800">{g.multi ? `${fmtMoney(g.min, false)} ← ${fmtMoney(g.max, false)}` : fmtMoney(g.max)}</b></div>
              <div className="text-end"><div className="text-[11px] text-brand-300">الكمية · متوسط التكلفة</div><b className="text-sm tabular-nums text-brand-800">{fmtNum(g.qty)} · {fmtMoney(g.avgCost, false)}</b></div>
              <ChevronDown className={clsx('no-print h-5 w-5 shrink-0 text-brand-300 transition-transform', isOpen(g) && 'rotate-180')} />
            </button>

            {isOpen(g) && (
              <div className="overflow-x-auto border-t border-cream-200">
                <table className="w-full text-sm">
                  <thead className="bg-cream-100 text-xs text-brand-500"><tr>
                    {['الدفعة', 'سعر الشراء', 'التكلفة الفعلية', 'الكمية', 'محجوز', 'قيمة المخزون', 'سعر البيع', 'الهامش', 'أول توريد', 'آخر توريد', ''].map((h) => <th key={h} className="whitespace-nowrap px-4 py-2.5 text-start font-bold">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-cream-200">
                    {(hideEmpty ? g.active : g.lots).map((l) => {
                      const next = g.active.find((a) => a.qty_on_hand - a.qty_reserved > 0)?.id === l.id
                      const sell = l.retail_price ?? Number(g.product.retail_price)
                      const margin = sell > 0 ? ((sell - l.unit_cost) / sell) * 100 : 0
                      const idx = g.lots.indexOf(l) + 1
                      return (
                        <tr key={l.id} className={clsx(l.qty_on_hand <= 0 && 'opacity-50', next && 'bg-gold-50/60')}>
                          <td className="px-4 py-3"><div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cream-200 text-xs font-bold text-brand-600">{idx}</span>
                            {next && <Badge tone="green">تُباع أولاً</Badge>}{l.is_legacy && <Badge tone="gray">رصيد سابق</Badge>}{l.qty_on_hand <= 0 && <Badge tone="gray">فارغة</Badge>}</div></td>
                          <td className="px-4 font-bold tabular-nums text-brand-900">{fmtMoney(l.purchase_price)}</td>
                          <td className="px-4 tabular-nums text-brand-500">{fmtMoney(l.unit_cost)}</td>
                          <td className="px-4 font-bold tabular-nums">{fmtNum(l.qty_on_hand)}</td>
                          <td className="px-4 tabular-nums text-brand-400">{l.qty_reserved ? fmtNum(l.qty_reserved) : '—'}</td>
                          <td className="px-4 tabular-nums">{fmtMoney(l.qty_on_hand * l.unit_cost)}</td>
                          <td className="px-4"><b className="tabular-nums">{fmtMoney(sell)}</b>{l.retail_price == null && <span className="ms-1 text-[10px] text-brand-300">(افتراضي)</span>}</td>
                          <td className="px-4"><span className={clsx('font-bold tabular-nums', margin < 15 ? 'text-red-600' : margin < 30 ? 'text-amber-600' : 'text-emerald-700')}>{margin.toFixed(1)}%</span></td>
                          <td className="whitespace-nowrap px-4 text-xs text-brand-400">{fmtDate(l.first_received_at)}</td>
                          <td className="whitespace-nowrap px-4 text-xs text-brand-400">{fmtDate(l.last_received_at)}</td>
                          <td className="no-print px-4"><div className="flex gap-1">
                            {can('pricing', 'update') && <Button size="sm" variant="ghost" title="تسعير الدفعة" onClick={() => setEdit(l)}><Pencil className="h-4 w-4" /></Button>}
                            <Button size="sm" variant="ghost" title="سجل الدفعة" onClick={() => setHist(l)}><History className="h-4 w-4" /></Button></div></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))}
      </div>

      {edit && <EditLotModal lot={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); qc.invalidateQueries({ queryKey: ['layers'] }); qc.invalidateQueries({ queryKey: ['pos-sell-prices'] }) }} />}
      {hist && <HistoryModal lot={hist} onClose={() => setHist(null)} />}
    </>
  )
}

/** تسعير دفعة: سعر البيع والجملة الخاصان بها (الفراغ = سعر المنتج الافتراضي) */
function EditLotModal({ lot, onClose, onSaved }: { lot: Lot; onClose: () => void; onSaved: () => void }) {
  const [retail, setRetail] = useState(lot.retail_price == null ? '' : String(lot.retail_price))
  const [wholesale, setWholesale] = useState(lot.wholesale_price == null ? '' : String(lot.wholesale_price))
  const [note, setNote] = useState(lot.note ?? '')
  const [all, setAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const num = (v: string) => (v.trim() === '' ? null : Number(v))
  const r = num(retail), w = num(wholesale)
  const margin = (r ?? Number(lot.product.retail_price)) > 0 ? (((r ?? Number(lot.product.retail_price)) - lot.unit_cost) / (r ?? Number(lot.product.retail_price))) * 100 : 0

  const save = async () => {
    if ((r != null && !(r >= 0)) || (w != null && !(w >= 0))) return toast.error('أدخل أسعاراً صحيحة')
    setBusy(true)
    const res = all
      ? await supabase.rpc('fn_set_product_lots_price', { p_branch: lot.branch_id, p_product: lot.product_id, p_retail: r, p_wholesale: w })
      : await supabase.rpc('fn_set_lot_price', { p_layer: lot.id, p_retail: r, p_wholesale: w, p_note: note || null })
    setBusy(false)
    if (res.error) return toast.error(errMsg(res.error))
    toast.success(all ? 'تم تطبيق السعر على كل دفعات المنتج' : 'تم حفظ تسعير الدفعة')
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title={`تسعير: ${lot.product.name}`} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>إلغاء</Button><Button variant="gold" loading={busy} onClick={save}>حفظ</Button></>}>
      <div className="mb-4 grid grid-cols-3 gap-2 text-center">
        {[['سعر الشراء', fmtMoney(lot.purchase_price)], ['التكلفة الفعلية', fmtMoney(lot.unit_cost)], ['الكمية', fmtNum(lot.qty_on_hand)]].map(([l, v]) => (
          <div key={l} className="rounded-xl bg-cream-100 p-2.5"><div className="text-[11px] text-brand-300">{l}</div><div className="text-sm font-bold text-brand-800">{v}</div></div>))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="سعر البيع للدفعة" hint={`الافتراضي ${fmtMoney(lot.product.retail_price)}`}><Input type="number" min={0} step="any" value={retail} onChange={(e) => setRetail(e.target.value)} placeholder="افتراضي" /></Field>
        <Field label="سعر الجملة للدفعة" hint={`الافتراضي ${fmtMoney(lot.product.wholesale_price)}`}><Input type="number" min={0} step="any" value={wholesale} onChange={(e) => setWholesale(e.target.value)} placeholder="افتراضي" /></Field>
      </div>
      <div className={clsx('mt-3 rounded-xl px-3 py-2 text-sm font-semibold', margin < 15 ? 'bg-red-50 text-red-700' : margin < 30 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700')}>الهامش المتوقع: {margin.toFixed(1)}%</div>
      <Field label="ملاحظة" className="mt-4"><Input value={note} onChange={(e) => setNote(e.target.value)} disabled={all} /></Field>
      <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-brand-600"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={all} onChange={(e) => setAll(e.target.checked)} /> تطبيق هذه الأسعار على كل دفعات المنتج في هذا الفرع</label>
      <p className="mt-3 text-xs text-brand-300">في نقطة البيع يُعرض سعر الدفعة التي ستُباع أولاً. إن اتسعت كمية الفاتورة لأكثر من دفعة فيُحسب كامل السطر بسعر الدفعة الأولى.</p>
    </Modal>
  )
}

function HistoryModal({ lot, onClose }: { lot: Lot; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['layer-moves', lot.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_layer_moves').select('id,qty_delta,created_at, movement:stock_movements(movement_type,note)').eq('layer_id', lot.id).order('created_at', { ascending: false }).limit(100)
      if (error) throw error
      return (data ?? []) as any[]
    },
  })
  return (
    <Modal open onClose={onClose} title={`سجل الدفعة — ${fmtMoney(lot.purchase_price)}`} size="md">
      {isLoading ? <Skeleton className="h-40 w-full" /> : !data?.length ? <div className="p-8 text-center text-sm text-brand-300">لا حركات مسجّلة (دفعة رصيد سابق أو لم تُستخدم بعد)</div> : (
        <ul className="divide-y divide-cream-200">
          {data.map((m) => (
            <li key={m.id} className="flex items-center justify-between py-2.5 text-sm">
              <div><div className="font-semibold text-brand-800">{MOVE[m.movement?.movement_type] ?? m.movement?.movement_type ?? 'حركة'}</div><div className="text-xs text-brand-300">{fmtDateTime(m.created_at)}{m.movement?.note ? ` · ${m.movement.note}` : ''}</div></div>
              <b className={clsx('tabular-nums', Number(m.qty_delta) >= 0 ? 'text-emerald-700' : 'text-red-600')} dir="ltr">{Number(m.qty_delta) >= 0 ? '+' : ''}{fmtNum(m.qty_delta)}</b>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
