import { useMemo } from 'react'
import { Spinner } from '@/components/ui/Spinner'
import { useReportRpc } from '../hooks'
import { StatementTable, type StmtRow } from './StatementTable'

/** قائمة الدخل من الأستاذ العام: مبيعات − تكلفة = مجمل الربح − مصروفات + إيرادات أخرى */
export function IncomeStatement({ from, to, branch }: { from: string; to: string; branch: string }) {
  const { data, isLoading } = useReportRpc<any>([from, to, branch], 'fn_income_statement', { p_from: from, p_to: to, p_branch: branch || null })
  const rows = useMemo<StmtRow[]>(() => {
    const all = (data ?? []) as any[]
    const grp = (prefix: string) => all.filter((a) => a.account_code.startsWith(prefix))
    const total = (list: any[]) => list.reduce((s, a) => s + Number(a.amount), 0)
    const items = (list: any[], sign = 1): StmtRow[] => list.filter((a) => Number(a.amount) !== 0).map((a) => ({ label: a.account_name, value: sign * Number(a.amount), indent: 1 }))
    const sales = grp('41'), cogs = grp('5'), opex = grp('6'), other = grp('42')
    const net = total(sales), gp = net - total(cogs)
    const out: StmtRow[] = [
      { label: 'المبيعات', kind: 'head' },
      // المردودات والخصومات تأتي بقيمة سالبة من الدالة فتُطرح تلقائياً
      ...items(sales),
      { label: 'صافي المبيعات', kind: 'sub', value: net },
      { label: 'تكلفة المبيعات', kind: 'head' }, ...items(cogs, -1),
      { label: 'مجمل الربح', kind: 'sub', value: gp },
      { label: 'المصروفات التشغيلية', kind: 'head' }, ...items(opex, -1),
      { label: 'إجمالي المصروفات التشغيلية', kind: 'sub', value: -total(opex) },
      { label: 'إيرادات أخرى', kind: 'head' }, ...items(other),
      { label: 'صافي الربح (الخسارة)', kind: 'total', value: gp - total(opex) + total(other) },
    ]
    return out
  }, [data])
  if (isLoading) return <Spinner />
  return <StatementTable rows={rows} />
}
