import { useMemo, useState } from 'react'
import { Printer } from 'lucide-react'
import clsx from 'clsx'
import { usePermission } from '@/hooks/usePermission'
import { useAuth } from '@/store/auth.store'
import { fmtMoney, toISODate } from '@/lib/formatters'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { PeriodBar } from '../components/PeriodBar'
import { StatementTable, type StmtRow } from '../components/StatementTable'
import { useAccounts, useReportRpc } from '../hooks'
import { buildTree, flatten, rollup } from '../lib'

export default function BalanceSheetPage() {
  const { seesAllBranches } = usePermission()
  const myBranch = useAuth((s) => s.profile?.branch_id) ?? ''
  const [branch, setBranch] = useState(seesAllBranches ? '' : myBranch)
  const [asOf, setAsOf] = useState(toISODate(new Date()))
  const { data: accounts } = useAccounts()
  const { data, isLoading } = useReportRpc<any>([asOf, branch], 'fn_balance_sheet', { p_as_of: asOf, p_branch: branch || null })

  const model = useMemo(() => {
    const tree = buildTree(accounts ?? [])
    const amt = new Map<string, number>((data ?? []).filter((r: any) => r.account_id).map((r: any) => [r.account_id, Number(r.amount)]))
    const profit = Number((data ?? []).find((r: any) => !r.account_id)?.amount ?? 0)
    const sums = rollup(tree, (id) => amt.get(id) ?? 0)
    const section = (root: string): StmtRow[] => {
      const node = flatten(tree).find((n) => n.code === root)
      if (!node) return []
      const out: StmtRow[] = [{ label: node.name, kind: 'head' }]
      flatten(node.children).forEach((n) => {
        const v = sums.get(n.id) ?? 0
        if (n.is_group) { if (v !== 0) out.push({ label: n.name, kind: 'sub', value: v, indent: n.depth - 1 }) }
        else if (v !== 0) out.push({ label: n.name, value: v, indent: n.depth - 1 })
      })
      return out
    }
    const assets = sums.get(flatten(tree).find((n) => n.code === '1')?.id ?? '') ?? 0
    const liab = sums.get(flatten(tree).find((n) => n.code === '2')?.id ?? '') ?? 0
    const eq = (sums.get(flatten(tree).find((n) => n.code === '3')?.id ?? '') ?? 0) + profit
    const equity = section('3')
    if (profit !== 0) equity.push({ label: 'صافي الربح (الخسارة) المرحّل غير المقفل', value: profit, indent: 1 })
    return {
      assets: [...section('1'), { label: 'إجمالي الأصول', kind: 'total' as const, value: assets }],
      other: [...section('2'), { label: 'إجمالي الخصوم', kind: 'sub' as const, value: liab }, ...equity,
        { label: 'إجمالي حقوق الملكية', kind: 'sub' as const, value: eq }, { label: 'إجمالي الخصوم وحقوق الملكية', kind: 'total' as const, value: liab + eq }],
      diff: Math.round((assets - liab - eq) * 100) / 100,
    }
  }, [accounts, data])

  return (
    <>
      <PageHeader title="الميزانية العمومية" subtitle="المركز المالي في تاريخ محدد (الأصول = الخصوم + حقوق الملكية)"
        actions={<>
          <PeriodBar single to={asOf} branch={branch} onTo={setAsOf} onBranch={setBranch} showBranch={seesAllBranches} />
          <Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" /></Button>
        </>} />
      {isLoading ? <Spinner /> : (<>
        <div className={clsx('mx-auto mb-4 max-w-2xl rounded-xl border p-3 text-center text-sm font-semibold', model.diff === 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700')}>
          {model.diff === 0 ? 'الميزانية متوازنة ✓' : `الميزانية غير متوازنة — الفرق ${fmtMoney(model.diff)} (راجع القيود اليدوية أو فرع محدد بعمليات بين الفروع)`}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <StatementTable rows={model.assets} />
          <StatementTable rows={model.other} />
        </div>
      </>)}
    </>
  )
}
