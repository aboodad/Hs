import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle, ArrowLeftRight, Boxes, CalendarDays, CheckCircle2, ClipboardList, Clock, Coins, FilePlus2, PackagePlus,
  Receipt, Scale, ShoppingBag, ShoppingCart, Sparkles, TrendingUp, Truck, Users, Wallet, type LucideIcon,
} from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import clsx from 'clsx'
import { supabase } from '@/lib/supabase'
import { usePermission } from '@/hooks/usePermission'
import { useBranches } from '@/hooks/useLookups'
import { useAuth } from '@/store/auth.store'
import { fmtDateTime, fmtMoney, fmtNum, toISODate } from '@/lib/formatters'
import { StatCard } from '@/components/shared/StatCard'
import { Panel } from '@/components/shared/Panel'
import { BranchSelect } from '@/components/shared/BranchSelect'
import { Skeleton } from '@/components/ui/Skeleton'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Field'

type Period = 'today' | 'week' | 'month' | 'year' | 'custom'
const PERIODS: [Period, string][] = [['today', 'اليوم'], ['week', 'الأسبوع'], ['month', 'الشهر'], ['year', 'السنة'], ['custom', 'مخصص']]

const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return toISODate(d) }
const daysBetween = (a: string, b: string) => Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000) + 1
const eachDay = (from: string, to: string) => Array.from({ length: Math.min(Math.max(daysBetween(from, to), 1), 400) }, (_, i) => addDays(from, i))

function rangeOf(p: Period, cFrom: string, cTo: string) {
  const now = new Date(); const today = toISODate(now)
  if (p === 'today') return { from: today, to: today }
  if (p === 'week') return { from: addDays(today, -6), to: today }
  if (p === 'month') return { from: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)), to: today }
  if (p === 'year') return { from: toISODate(new Date(now.getFullYear(), 0, 1)), to: today }
  return { from: cFrom || today, to: cTo || today }
}

const compact = new Intl.NumberFormat('ar-u-nu-latn', { notation: 'compact', maximumFractionDigits: 1 })
const pctChange = (cur: number, prev: number) => (prev > 0 ? ((cur - prev) / prev) * 100 : null)

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'صباح الخير' : h < 18 ? 'مساء الخير' : 'مساء النور'
}

export default function DashboardPage() {
  const { can, seesAllBranches } = usePermission()
  const profile = useAuth((s) => s.profile)
  const { data: branches } = useBranches()
  const [period, setPeriod] = useState<Period>('month')
  const [cFrom, setCFrom] = useState('')
  const [cTo, setCTo] = useState('')
  const [branchId, setBranchId] = useState('')
  const r = useMemo(() => rangeOf(period, cFrom, cTo), [period, cFrom, cTo])
  const len = daysBetween(r.from, r.to)
  const prev = useMemo(() => ({ from: addDays(r.from, -len), to: addDays(r.from, -1) }), [r, len])
  const today = toISODate(new Date())

  // تطبيق فلتر الفرع على أي استعلام
  const br = (q: any) => (branchId ? q.eq('branch_id', branchId) : q)

  const kpis = useQuery({ queryKey: ['dash-kpis', branchId], queryFn: async () => { const { data, error } = await br(supabase.from('v_dashboard_kpis').select('*')); if (error) throw error; return (data ?? []) as any[] } })
  const daily = useQuery({ queryKey: ['dash-daily', branchId, r.from, r.to], queryFn: async () => { const { data, error } = await br(supabase.from('v_sales_daily').select('*').gte('day', r.from).lte('day', r.to)); if (error) throw error; return (data ?? []) as any[] } })
  const dailyPrev = useQuery({ queryKey: ['dash-daily-prev', branchId, prev.from, prev.to], queryFn: async () => { const { data, error } = await br(supabase.from('v_sales_daily').select('*').gte('day', prev.from).lte('day', prev.to)); if (error) throw error; return (data ?? []) as any[] } })
  const twoDays = useQuery({ queryKey: ['dash-2days', branchId], queryFn: async () => { const { data } = await br(supabase.from('v_sales_daily').select('day,total').gte('day', addDays(today, -1)).lte('day', today)); return (data ?? []) as any[] } })

  const top = useQuery({
    queryKey: ['dash-top', branchId],
    queryFn: async () => {
      const { data, error } = await br(supabase.from('v_top_products').select('*').order('qty_sold', { ascending: false }).limit(80))
      if (error) throw error
      const m = new Map<string, { name: string; qty: number; revenue: number }>()
      ;(data ?? []).forEach((x: any) => { const c = m.get(x.product_id) ?? { name: x.product_name, qty: 0, revenue: 0 }; c.qty += Number(x.qty_sold); c.revenue += Number(x.revenue); m.set(x.product_id, c) })
      return [...m.values()].sort((a, b) => b.qty - a.qty).slice(0, 6)
    },
  })
  const low = useQuery({ queryKey: ['dash-low', branchId], queryFn: async () => ((await br(supabase.from('v_low_stock').select('product_name,branch_name,qty_on_hand,is_out').limit(6))).data ?? []) as any[] })
  const staff = useQuery({
    queryKey: ['dash-staff', branchId],
    queryFn: async () => {
      const month = toISODate(new Date(new Date().getFullYear(), new Date().getMonth(), 1))
      return ((await br(supabase.from('v_sales_by_employee').select('*').eq('month', month).order('total_sales', { ascending: false }).limit(5))).data ?? []) as any[]
    },
  })
  const recent = useQuery({
    queryKey: ['dash-recent', branchId], enabled: can('sales', 'view'),
    queryFn: async () => {
      const q = supabase.from('sales_invoices').select('id,invoice_no,total,invoice_date,status,customer:customers(name),branch:branches(name)').neq('status', 'cancelled').order('invoice_date', { ascending: false }).limit(6)
      return ((await br(q)).data ?? []) as any[]
    },
  })

  // مركز المهام: عدّادات تحتاج إجراء (تُعرض حسب صلاحيات المستخدم)
  const todo = useQuery({
    queryKey: ['dash-todo', branchId],
    queryFn: async () => {
      const h = { count: 'exact' as const, head: true }
      const cnt = async (build: () => any, ok: boolean): Promise<number | null> => (ok ? ((await build()).count ?? 0) : null)
      const [req, trf, shifts, due, lowC] = await Promise.all([
        cnt(() => br(supabase.from('stock_requests').select('id', h).in('status', ['new', 'under_review'])), can('requests', 'view')),
        cnt(() => br(supabase.from('stock_transfers').select('id', h).in('status', ['issued', 'in_transit', 'has_difference'])), can('transfers', 'view')),
        cnt(() => br(supabase.from('shifts').select('id', h).eq('status', 'open')), can('shifts', 'view')),
        cnt(() => supabase.from('purchase_invoices').select('id', h).eq('status', 'posted').gt('remaining', 0), can('purchases', 'view')),
        cnt(() => br(supabase.from('v_low_stock').select('product_id', h)), can('inventory', 'view')),
      ])
      return { req, trf, shifts, due, lowC }
    },
  })

  // ───── حسابات مشتقة ─────
  const k = useMemo(() => {
    const rows = kpis.data ?? []
    const sum = (f: string) => rows.reduce((s, x: any) => s + Number(x[f] ?? 0), 0)
    return { salesToday: sum('sales_today'), salesMonth: sum('sales_month'), purchases: sum('purchases_month'), expenses: sum('expenses_month'),
      stock: sum('stock_value'), due: sum('customers_due'), balance: sum('branch_balance'), branchesCount: rows.filter((x: any) => x.type === 'branch').length }
  }, [kpis.data])

  const series = useMemo(() => {
    const cur = new Map<string, number>(), prv = new Map<string, number>()
    daily.data?.forEach((x: any) => cur.set(x.day, (cur.get(x.day) ?? 0) + Number(x.total)))
    dailyPrev.data?.forEach((x: any) => prv.set(x.day, (prv.get(x.day) ?? 0) + Number(x.total)))
    const pDays = eachDay(prev.from, prev.to)
    return eachDay(r.from, r.to).map((d, i) => ({ day: d.slice(5), total: cur.get(d) ?? 0, prev: prv.get(pDays[i]) ?? 0 }))
  }, [daily.data, dailyPrev.data, r, prev])

  const salesPeriod = series.reduce((s, x) => s + x.total, 0)
  const salesPrev = series.reduce((s, x) => s + x.prev, 0)
  const invoices = (daily.data ?? []).reduce((s, x: any) => s + Number(x.invoices_count), 0)
  const sparkSales = series.slice(-30).map((x) => x.total)
  const yesterday = (twoDays.data ?? []).filter((x: any) => x.day === addDays(today, -1)).reduce((s, x: any) => s + Number(x.total), 0)
  const todayTotal = (twoDays.data ?? []).filter((x: any) => x.day === today).reduce((s, x: any) => s + Number(x.total), 0) || k.salesToday

  const ranking = useMemo(() => {
    const m = new Map<string, number>()
    daily.data?.forEach((x: any) => m.set(x.branch_id, (m.get(x.branch_id) ?? 0) + Number(x.total)))
    const total = [...m.values()].reduce((a, b) => a + b, 0) || 1
    return [...m.entries()].map(([id, v]) => ({ name: branches?.find((b) => b.id === id)?.name ?? '—', v, share: (v / total) * 100 })).sort((a, b) => b.v - a.v)
  }, [daily.data, branches])

  const loading = kpis.isLoading
  const dateLabel = new Intl.DateTimeFormat('ar-u-nu-latn', { dateStyle: 'full' }).format(new Date())

  const quick: { label: string; to: string; icon: LucideIcon; module: string; action?: string }[] = [
    { label: 'نقطة البيع', to: '/pos', icon: ShoppingCart, module: 'pos' },
    { label: 'منتج جديد', to: '/products/new', icon: PackagePlus, module: 'products', action: 'create' },
    { label: 'طلب بضاعة', to: '/requests/new', icon: ClipboardList, module: 'requests', action: 'create' },
    { label: 'فاتورة شراء', to: '/purchases/new', icon: FilePlus2, module: 'purchases', action: 'create' },
  ].filter((q) => can(q.module, q.action ?? 'view'))

  const todoItems: { label: string; n: number | null | undefined; to: string; icon: LucideIcon; tone: string }[] = [
    { label: 'طلبات بضاعة بانتظار القرار', n: todo.data?.req, to: '/requests', icon: ClipboardList, tone: 'text-sky-700 bg-sky-100' },
    { label: 'تحويلات قيد التنفيذ / باختلاف', n: todo.data?.trf, to: '/transfers', icon: Truck, tone: 'text-violet-700 bg-violet-100' },
    { label: 'منتجات منخفضة أو نافدة', n: todo.data?.lowC, to: '/inventory/main', icon: AlertTriangle, tone: 'text-amber-700 bg-amber-100' },
    { label: 'فواتير شراء غير مسددة', n: todo.data?.due, to: '/purchases', icon: Receipt, tone: 'text-red-700 bg-red-100' },
    { label: 'ورديات مفتوحة الآن', n: todo.data?.shifts, to: '/shifts', icon: Clock, tone: 'text-emerald-700 bg-emerald-100' },
  ].filter((t) => t.n !== null && t.n !== undefined)

  return (
    <div className="space-y-5">
      {/* ───────── ترحيب + اختصارات ───────── */}
      <section className="fade-up relative overflow-hidden rounded-3xl border border-gold-500/30 bg-gradient-to-l from-brand-950 via-brand-900 to-brand-700 p-6 text-cream-100 shadow-[0_18px_40px_-20px_rgba(46,32,20,.7)] lg:p-7">
        <div className="pointer-events-none absolute -start-16 -top-20 h-64 w-64 rounded-full bg-gold-400/20 blur-3xl" />
        <div className="pointer-events-none absolute inset-0 opacity-[.06]" style={{ backgroundImage: 'radial-gradient(#e8c960 1px, transparent 1px)', backgroundSize: '22px 22px' }} />
        <div className="relative flex flex-wrap items-center justify-between gap-5">
          <div>
            <div className="mb-1 flex items-center gap-2 text-sm text-gold-300"><Sparkles className="h-4 w-4" /> {greeting()}</div>
            <h1 className="text-2xl font-bold text-cream-50 lg:text-3xl">{profile?.full_name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-cream-300/90">
              <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4 text-gold-400" />{dateLabel}</span>
              <span className="inline-flex items-center gap-1.5"><Scale className="h-4 w-4 text-gold-400" />{profile?.role.name} · {profile?.branch.name}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {quick.map((q) => (
              <Link key={q.to} to={q.to} className="group flex items-center gap-2 rounded-2xl border border-gold-400/30 bg-white/5 px-4 py-2.5 text-sm font-semibold text-cream-100 backdrop-blur transition hover:border-gold-300 hover:bg-gold-400/15">
                <q.icon className="h-[18px] w-[18px] text-gold-300 transition group-hover:scale-110" /> {q.label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ───────── أدوات الفلترة ───────── */}
      <div className="fade-up flex flex-wrap items-center justify-between gap-3" style={{ animationDelay: '60ms' }}>
        <div className="seg">{PERIODS.map(([k2, l]) => <button key={k2} data-on={period === k2} onClick={() => setPeriod(k2)}>{l}</button>)}</div>
        <div className="flex flex-wrap items-center gap-2">
          {period === 'custom' && <><Input type="date" value={cFrom} onChange={(e) => setCFrom(e.target.value)} className="!w-40" /><Input type="date" value={cTo} onChange={(e) => setCTo(e.target.value)} className="!w-40" /></>}
          {seesAllBranches && <BranchSelect includeAll value={branchId} onChange={setBranchId} className="!w-48" />}
          <span className="hidden text-xs text-brand-300 md:inline">{r.from} ← {r.to}</span>
        </div>
      </div>

      {/* ───────── المؤشرات ───────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard variant="hero" label="مبيعات الفترة" value={fmtMoney(salesPeriod)} icon={TrendingUp} loading={daily.isLoading} delay={80}
          trend={{ pct: pctChange(salesPeriod, salesPrev), label: 'عن الفترة السابقة' }} sub={`${fmtNum(invoices)} فاتورة`} spark={sparkSales} />
        <StatCard label="مبيعات اليوم" value={fmtMoney(todayTotal)} icon={Coins} tone="green" loading={loading} delay={120}
          trend={{ pct: pctChange(todayTotal, yesterday), label: 'عن أمس' }} />
        <StatCard label="مشتريات الشهر" value={fmtMoney(k.purchases)} icon={ShoppingBag} tone="blue" loading={loading} delay={160} />
        <StatCard label="مصروفات الشهر" value={fmtMoney(k.expenses)} icon={Wallet} tone="red" loading={loading} delay={200} sub={k.salesMonth ? `${((k.expenses / k.salesMonth) * 100).toFixed(1)}% من المبيعات` : undefined} />
        <StatCard label="مبيعات الشهر بعد المصروفات" value={fmtMoney(k.salesMonth - k.expenses)} icon={TrendingUp} tone="green" loading={loading} delay={240} sub={`من ${fmtMoney(k.salesMonth)}`} />
        <StatCard label="قيمة المخزون" value={fmtMoney(k.stock)} icon={Boxes} loading={loading} delay={280} />
        <StatCard label="مستحقات على العملاء" value={fmtMoney(k.due)} icon={Users} tone="red" loading={loading} delay={320} />
        <StatCard label={seesAllBranches ? 'مستحقات على الفروع' : 'رصيد الفرع مع الإدارة'} value={fmtMoney(k.balance)} icon={Scale} tone="blue" loading={loading} delay={360} sub={seesAllBranches ? `${k.branchesCount} فرع` : undefined} />
      </div>

      {/* ───────── الرسوم ───────── */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="حركة المبيعات" subtitle="مقارنة الفترة الحالية بالسابقة" delay={120}
          actions={<div className="hidden items-center gap-3 text-xs sm:flex"><span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-gold-500" />الحالية</span><span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-brand-300" />السابقة</span></div>}>
          {daily.isLoading ? <Skeleton className="h-72 w-full" /> : (
            <div className="h-72" dir="ltr">
              <ResponsiveContainer>
                <AreaChart data={series} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gCur" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#c9a24b" stopOpacity={0.45} /><stop offset="100%" stopColor="#c9a24b" stopOpacity={0} /></linearGradient>
                    <linearGradient id="gPrev" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#b48a58" stopOpacity={0.18} /><stop offset="100%" stopColor="#b48a58" stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 6" stroke="#ecdfc2" vertical={false} />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} stroke="#b48a58" interval="preserveStartEnd" minTickGap={24} />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} stroke="#b48a58" width={52} tickFormatter={(v) => compact.format(v)} />
                  <Tooltip content={<ChartTip />} cursor={{ stroke: '#c9a24b', strokeDasharray: '4 4' }} />
                  <Area type="monotone" dataKey="prev" stroke="#b48a58" strokeWidth={1.5} strokeDasharray="5 5" fill="url(#gPrev)" dot={false} />
                  <Area type="monotone" dataKey="total" stroke="#a9842f" strokeWidth={2.8} fill="url(#gCur)" dot={false} activeDot={{ r: 5, fill: '#a9842f', stroke: '#fff', strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel title="ترتيب الفروع" subtitle="حسب مبيعات الفترة" delay={160}>
          {daily.isLoading ? <Skeleton className="h-60 w-full" /> : !ranking.length ? <Empty text="لا مبيعات في هذه الفترة" /> : (
            <ol className="space-y-4">
              {ranking.map((b, i) => (
                <li key={b.name}>
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 font-semibold text-brand-800"><Rank n={i + 1} />{b.name}</span>
                    <span className="font-bold tabular-nums text-brand-900">{fmtMoney(b.v)}</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-cream-200">
                    <div className="h-full rounded-full bg-gradient-to-l from-gold-300 to-gold-600 transition-all duration-700" style={{ width: `${Math.max(b.share, 3)}%` }} />
                  </div>
                  <div className="mt-1 text-[11px] text-brand-300">{b.share.toFixed(1)}% من الإجمالي</div>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>

      {/* ───────── مركز المهام + الأكثر مبيعاً + المخزون ───────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="تحتاج إجراء" subtitle="عناصر معلّقة الآن" delay={200}>
          {todo.isLoading ? <Skeleton className="h-48 w-full" /> : !todoItems.length ? <Empty text="لا توجد مهام متاحة لصلاحياتك" /> : (
            <ul className="space-y-2.5">
              {todoItems.map((t) => (
                <li key={t.label}>
                  <Link to={t.to} className="flex items-center gap-3 rounded-xl border border-cream-200 bg-cream-50 p-3 transition hover:border-gold-300 hover:bg-gold-50">
                    <span className={clsx('flex h-10 w-10 items-center justify-center rounded-xl', t.tone)}><t.icon className="h-[18px] w-[18px]" /></span>
                    <span className="flex-1 text-[13.5px] font-semibold text-brand-700">{t.label}</span>
                    {t.n ? <span className="min-w-8 rounded-full bg-brand-800 px-2.5 py-1 text-center text-xs font-bold text-gold-200">{fmtNum(t.n)}</span>
                      : <CheckCircle2 className="h-5 w-5 text-emerald-500" />}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="الأكثر مبيعاً" subtitle="حسب الكمية" delay={240} link={can('products') ? { to: '/products', label: 'المنتجات' } : undefined}>
          {top.isLoading ? <Skeleton className="h-48 w-full" /> : !top.data?.length ? <Empty text="لا مبيعات بعد" /> : (
            <ul className="space-y-3.5">
              {top.data.map((p, i) => (
                <li key={p.name}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="flex min-w-0 items-center gap-2"><Rank n={i + 1} /><span className="truncate font-semibold text-brand-800">{p.name}</span></span>
                    <span className="shrink-0 text-xs text-brand-400">{fmtNum(p.qty)} قطعة · <b className="text-brand-800">{fmtMoney(p.revenue, false)}</b></span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-cream-200"><div className="h-full rounded-full bg-gradient-to-l from-brand-400 to-brand-700" style={{ width: `${(p.qty / top.data[0].qty) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="تنبيهات المخزون" subtitle="منخفضة ونافدة" delay={280} link={can('inventory') ? { to: '/inventory/main', label: 'المخزن' } : undefined}>
          {low.isLoading ? <Skeleton className="h-48 w-full" /> : !low.data?.length ? <Empty icon text="كل المنتجات بكميات كافية" /> : (
            <ul className="divide-y divide-cream-200">
              {low.data.map((p: any, i: number) => (
                <li key={i} className="flex items-center justify-between py-2.5">
                  <div className="min-w-0"><div className="truncate text-sm font-semibold text-brand-800">{p.product_name}</div><div className="text-xs text-brand-300">{p.branch_name}</div></div>
                  <Badge tone={p.is_out ? 'red' : 'amber'}>{p.is_out ? 'نافد' : `${fmtNum(p.qty_on_hand)} متبقي`}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* ───────── آخر الفواتير + أداء الموظفين ───────── */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="آخر الفواتير" delay={320} pad={false} link={can('sales', 'view') ? { to: '/sales', label: 'كل الفواتير' } : undefined}>
          {!can('sales', 'view') ? <Empty text="غير متاح لصلاحياتك" /> : recent.isLoading ? <div className="p-5"><Skeleton className="h-48 w-full" /></div> : !recent.data?.length ? <Empty text="لا فواتير بعد" /> : (
            <ul className="divide-y divide-cream-200">
              {recent.data.map((i: any) => (
                <li key={i.id}>
                  <Link to={`/sales/${i.id}`} className="flex items-center gap-3 px-5 py-3 transition hover:bg-gold-50">
                    <span className="tile-gold flex h-10 w-10 items-center justify-center rounded-xl"><Receipt className="h-[18px] w-[18px]" /></span>
                    <div className="min-w-0 flex-1"><div className="truncate text-sm font-bold text-brand-800" dir="ltr" style={{ textAlign: 'right' }}>{i.invoice_no}</div>
                      <div className="truncate text-xs text-brand-300">{i.customer?.name ?? 'عميل نقدي'} · {i.branch?.name}</div></div>
                    <div className="text-end"><div className="text-sm font-bold tabular-nums text-brand-900">{fmtMoney(i.total)}</div><div className="text-[11px] text-brand-300">{fmtDateTime(i.invoice_date)}</div></div>
                    <ArrowLeftRight className="hidden h-4 w-4 text-brand-200 sm:block" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="أداء موظفي المبيعات" subtitle="هذا الشهر" delay={360}>
          {staff.isLoading ? <Skeleton className="h-48 w-full" /> : !staff.data?.length ? <Empty text="لا بيانات بعد" /> : (
            <ul className="space-y-3">
              {staff.data.map((s: any, i: number) => (
                <li key={i} className="flex items-center gap-3">
                  <span className={clsx('flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold', i === 0 ? 'bg-gradient-to-br from-gold-300 to-gold-600 text-brand-950 shadow-gold' : 'bg-cream-200 text-brand-600')}>{(s.full_name ?? '—').trim()[0]}</span>
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-brand-800">{s.full_name ?? '—'}</div><div className="text-xs text-brand-300">{fmtNum(s.invoices_count)} فاتورة</div></div>
                  <b className="text-sm tabular-nums text-brand-900">{fmtMoney(s.total_sales, false)}</b>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}

function Rank({ n }: { n: number }) {
  return <span className={clsx('flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold', n === 1 ? 'bg-gradient-to-br from-gold-300 to-gold-600 text-brand-950' : n === 2 ? 'bg-brand-200 text-brand-800' : 'bg-cream-200 text-brand-500')}>{n}</span>
}

function Empty({ text, icon }: { text: string; icon?: boolean }) {
  return <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-sm text-brand-300">{icon ? <CheckCircle2 className="h-8 w-8 text-emerald-500" /> : <Boxes className="h-8 w-8 text-brand-200" />}{text}</div>
}

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const cur = payload.find((p: any) => p.dataKey === 'total')?.value ?? 0
  const prv = payload.find((p: any) => p.dataKey === 'prev')?.value ?? 0
  return (
    <div dir="rtl" className="rounded-xl border border-gold-300 bg-white/95 px-3.5 py-2.5 text-xs shadow-lg backdrop-blur">
      <div className="mb-1.5 font-bold text-brand-700" dir="ltr">{label}</div>
      <div className="flex items-center justify-between gap-6"><span className="flex items-center gap-1.5 text-brand-500"><i className="h-2 w-2 rounded-full bg-gold-500" />الحالية</span><b className="text-brand-900">{fmtMoney(cur)}</b></div>
      <div className="flex items-center justify-between gap-6"><span className="flex items-center gap-1.5 text-brand-400"><i className="h-2 w-2 rounded-full bg-brand-300" />السابقة</span><span className="text-brand-600">{fmtMoney(prv)}</span></div>
    </div>
  )
}
