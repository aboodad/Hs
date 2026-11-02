import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDownCircle, ArrowUpCircle, Banknote, Scale } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/store/auth.store'
import { usePermission } from '@/hooks/usePermission'
import { fmtDateTime, fmtMoney, toISODate } from '@/lib/formatters'
import { PageHeader } from '@/components/shared/PageHeader'
import { BranchSelect } from '@/components/shared/BranchSelect'
import { StatCard } from '@/components/shared/StatCard'
import { DataTable, type Column } from '@/components/data/DataTable'
import { Input } from '@/components/ui/Field'
import { Badge } from '@/components/ui/Badge'
import { Tabs } from '@/components/ui/Tabs'
import { PaymentMethodsPage } from '@/features/lookups/pages/LookupPages'

const TX: Record<string, string> = {
  opening: 'رصيد افتتاحي', sale: 'مبيعات', refund: 'مرتجع / استرداد', expense: 'مصروف', collection: 'تحصيل عميل',
  income: 'إيراد آخر', settlement: 'تسوية', supplier_payment: 'دفعة مورد', salary: 'راتب',
}

export default function CashboxPage() {
  const { can, seesAllBranches } = usePermission()
  const myBranch = useAuth((s) => s.profile?.branch_id) ?? ''
  const [tab, setTab] = useState<'box' | 'methods'>('box')
  const [branch, setBranch] = useState(seesAllBranches ? '' : myBranch)
  const [from, setFrom] = useState(toISODate(new Date()))
  const [to, setTo] = useState(toISODate(new Date()))

  const tx = useQuery({
    queryKey: ['cashbox', branch, from, to],
    queryFn: async () => {
      let q = supabase.from('cash_transactions').select('*, method:payment_methods(name,is_cash), branch:branches(name)')
        .gte('created_at', `${from}T00:00:00`).lte('created_at', `${to}T23:59:59`).order('created_at', { ascending: false }).limit(500)
      if (branch) q = q.eq('branch_id', branch)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })
  const shifts = useQuery({
    queryKey: ['cashbox-shifts', branch, from, to],
    queryFn: async () => {
      let q = supabase.from('shifts').select('opening_cash,expected_cash,actual_cash,difference,status')
        .gte('opened_at', `${from}T00:00:00`).lte('opened_at', `${to}T23:59:59`)
      if (branch) q = q.eq('branch_id', branch)
      return (await q).data ?? []
    },
  })

  const rows = tx.data ?? []
  const cash = rows.filter((r: any) => r.method?.is_cash)
  const cashIn = cash.filter((r: any) => r.direction === 'in').reduce((s, r: any) => s + Number(r.amount), 0)
  const cashOut = cash.filter((r: any) => r.direction === 'out').reduce((s, r: any) => s + Number(r.amount), 0)
  const opening = (shifts.data ?? []).reduce((s, r: any) => s + Number(r.opening_cash), 0)
  const expected = opening + cashIn - cashOut
  const closed = (shifts.data ?? []).filter((s: any) => s.status === 'closed')
  const actual = closed.reduce((s, r: any) => s + Number(r.actual_cash ?? 0), 0)
  const diff = closed.reduce((s, r: any) => s + Number(r.difference ?? 0), 0)

  // مجاميع طرق الدفع غير النقدية
  const byMethod = new Map<string, number>()
  rows.forEach((r: any) => { if (r.direction === 'in') byMethod.set(r.method?.name ?? '—', (byMethod.get(r.method?.name ?? '—') ?? 0) + Number(r.amount)) })

  const cols: Column<any>[] = [
    { key: 'created_at', header: 'الوقت', render: (r) => fmtDateTime(r.created_at) },
    { key: 'branch', header: 'الفرع', render: (r) => r.branch?.name },
    { key: 'tx_type', header: 'النوع', render: (r) => TX[r.tx_type] ?? r.tx_type },
    { key: 'method', header: 'الطريقة', render: (r) => <>{r.method?.name ?? '—'} {r.method?.is_cash && <Badge tone="amber">نقدي</Badge>}</> },
    { key: 'dir', header: 'الحركة', render: (r) => (r.direction === 'in' ? <span className="font-bold text-emerald-700">+ {fmtMoney(r.amount)}</span> : <span className="font-bold text-red-600">- {fmtMoney(r.amount)}</span>) },
  ]

  return (
    <>
      <PageHeader title="الصندوق وطرق الدفع" subtitle="حركة الأموال داخل كل فرع" />
      <Tabs tabs={[['box', 'الصندوق'], ['methods', 'طرق الدفع']] as const} value={tab} onChange={setTab} />

      {tab === 'methods' ? (can('cashbox', 'view') && <PaymentMethodsPage />) : (<>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          {seesAllBranches ? <BranchSelect includeAll value={branch} onChange={setBranch} /> : <div />}
        </div>
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="الرصيد الافتتاحي (الورديات)" value={fmtMoney(opening)} icon={Banknote} />
          <StatCard label="داخل نقداً" value={fmtMoney(cashIn)} icon={ArrowDownCircle} tone="green" sub="مبيعات + تحصيلات + إيرادات" />
          <StatCard label="خارج نقداً" value={fmtMoney(cashOut)} icon={ArrowUpCircle} tone="red" sub="مصروفات + مرتجعات" />
          <StatCard label="الرصيد النقدي المتوقع" value={fmtMoney(expected)} icon={Scale} tone="blue" sub={closed.length ? `الفعلي ${fmtMoney(actual)} · الفرق ${fmtMoney(diff)}` : 'لا ورديات مغلقة'} />
        </div>
        {byMethod.size > 0 && (
          <div className="mb-5 flex flex-wrap gap-2">
            {[...byMethod.entries()].map(([k, v]) => <span key={k} className="rounded-full border border-gold-300 bg-gold-50 px-3 py-1 text-xs text-gold-800">{k}: <b>{fmtMoney(v)}</b></span>)}
          </div>
        )}
        <DataTable columns={cols} rows={rows} loading={tx.isLoading} />
      </>)}
    </>
  )
}
