import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Printer } from 'lucide-react'
import clsx from 'clsx'
import { supabase } from '@/lib/supabase'
import { usePermission } from '@/hooks/usePermission'
import { useAuth } from '@/store/auth.store'
import { fmtMoney, toISODate } from '@/lib/formatters'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { PeriodBar } from '../components/PeriodBar'
import { useAccounts, useReportRpc } from '../hooks'
import { buildTree, flatten, rollup } from '../lib'

const dr = (v: number) => (v > 0 ? fmtMoney(v, false) : '')

export default function TrialBalancePage() {
  const { seesAllBranches } = usePermission()
  const myBranch = useAuth((s) => s.profile?.branch_id) ?? ''
  const [branch, setBranch] = useState(seesAllBranches ? '' : myBranch)
  const [from, setFrom] = useState(toISODate(new Date(new Date().getFullYear(), 0, 1)))
  const [to, setTo] = useState(toISODate(new Date()))
  const { data: accounts } = useAccounts()
  const { data, isLoading } = useReportRpc<any>([branch, from, to], 'fn_trial_balance', { p_from: from, p_to: to, p_branch: branch || null })
  const rec = useQuery({ queryKey: ['acc-reconciliation'], queryFn: async () => (await supabase.from('v_accounting_reconciliation').select('*')).data ?? [] })

  const tree = useMemo(() => buildTree(accounts ?? []), [accounts])
  const by = useMemo(() => new Map((data ?? []).map((r: any) => [r.account_id, r])), [data])
  const agg = (k: string) => rollup(tree, (id) => Number((by.get(id) as any)?.[k] ?? 0))
  const op = useMemo(() => agg('opening'), [tree, by])
  const pd = useMemo(() => agg('period_debit'), [tree, by])
  const pc = useMemo(() => agg('period_credit'), [tree, by])
  const cl = useMemo(() => agg('closing'), [tree, by])
  const rows = flatten(tree).filter((a) => (op.get(a.id) ?? 0) || (pd.get(a.id) ?? 0) || (pc.get(a.id) ?? 0))
  const leaves = rows.filter((a) => !a.is_group)
  const tot = (m: Map<string, number>, pos: boolean) => leaves.reduce((s, a) => { const v = m.get(a.id) ?? 0; return s + (pos ? Math.max(v, 0) : Math.max(-v, 0)) }, 0)

  return (
    <>
      <PageHeader title="ميزان المراجعة" subtitle="أرصدة كل الحسابات وحركتها خلال الفترة"
        actions={<>
          <PeriodBar from={from} to={to} branch={branch} onFrom={setFrom} onTo={setTo} onBranch={setBranch} showBranch={seesAllBranches} />
          <Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" /></Button>
        </>} />
      {isLoading ? <Spinner /> : (
        <div className="card fade-up overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-cream-100 text-xs text-brand-700">
              <tr><th rowSpan={2} className="px-4 py-2 text-start">الحساب</th><th colSpan={2} className="px-2 py-1 text-center">رصيد أول المدة</th>
                <th colSpan={2} className="px-2 py-1 text-center">حركة الفترة</th><th colSpan={2} className="px-2 py-1 text-center">الرصيد الختامي</th></tr>
              <tr>{['مدين', 'دائن', 'مدين', 'دائن', 'مدين', 'دائن'].map((h, i) => <th key={i} className="px-3 py-1 text-start font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-cream-200">
              {rows.map((a) => {
                const o = op.get(a.id) ?? 0, c = cl.get(a.id) ?? 0
                return (
                  <tr key={a.id} className={clsx(a.is_group && 'bg-cream-50 font-bold')}>
                    <td className="px-4 py-2" style={{ paddingInlineStart: 16 + a.depth * 18 }}><span className="font-mono text-xs text-brand-300" dir="ltr">{a.code}</span> {a.name}</td>
                    <td className="px-3 py-2" dir="ltr">{dr(o)}</td><td className="px-3 py-2" dir="ltr">{dr(-o)}</td>
                    <td className="px-3 py-2" dir="ltr">{dr(pd.get(a.id) ?? 0)}</td><td className="px-3 py-2" dir="ltr">{dr(pc.get(a.id) ?? 0)}</td>
                    <td className="px-3 py-2" dir="ltr">{dr(c)}</td><td className="px-3 py-2" dir="ltr">{dr(-c)}</td>
                  </tr>
                )
              })}
              <tr className="bg-brand-50 font-bold">
                <td className="px-4 py-3">الإجمالي</td>
                <td className="px-3 py-3" dir="ltr">{fmtMoney(tot(op, true), false)}</td><td className="px-3 py-3" dir="ltr">{fmtMoney(tot(op, false), false)}</td>
                <td className="px-3 py-3" dir="ltr">{fmtMoney(leaves.reduce((s, a) => s + (pd.get(a.id) ?? 0), 0), false)}</td>
                <td className="px-3 py-3" dir="ltr">{fmtMoney(leaves.reduce((s, a) => s + (pc.get(a.id) ?? 0), 0), false)}</td>
                <td className="px-3 py-3" dir="ltr">{fmtMoney(tot(cl, true), false)}</td><td className="px-3 py-3" dir="ltr">{fmtMoney(tot(cl, false), false)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="card mt-6 p-5 print:hidden">
        <h3 className="mb-1 font-bold text-brand-800">مطابقة الأستاذ العام مع الدفاتر المساعدة</h3>
        <p className="mb-3 text-xs text-brand-400">الفرق يجب أن يكون صفراً؛ أي فرق يدل على عملية لم تُقيَّد أو سجل قديم يحتاج مراجعة.</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {(rec.data ?? []).map((r: any) => {
            const diff = Number(r.ledger_balance) - Number(r.subledger_balance)
            return (
              <div key={r.code} className={clsx('rounded-xl border p-3 text-sm', Math.abs(diff) < 0.01 ? 'border-emerald-200 bg-emerald-50' : 'border-amber-300 bg-amber-50')}>
                <div className="font-bold">{r.label}</div>
                <div className="text-xs text-brand-500">الأستاذ: {fmtMoney(r.ledger_balance)}</div>
                <div className="text-xs text-brand-500">الدفتر المساعد: {fmtMoney(r.subledger_balance)}</div>
                <div className={clsx('mt-1 font-bold', Math.abs(diff) < 0.01 ? 'text-emerald-700' : 'text-amber-700')}>الفرق: {fmtMoney(diff)}</div>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
