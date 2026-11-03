import { useState } from 'react'
import { Printer } from 'lucide-react'
import { usePermission } from '@/hooks/usePermission'
import { useAuth } from '@/store/auth.store'
import { toISODate } from '@/lib/formatters'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/Button'
import { PeriodBar } from '@/features/accounting/components/PeriodBar'
import { IncomeStatement } from '@/features/accounting/components/IncomeStatement'

// قائمة الدخل تُحسب الآن من الأستاذ العام (القيود المرتبطة بكل العمليات) بدل التقديرات التشغيلية السابقة
export default function ProfitLossPage() {
  const { seesAllBranches } = usePermission()
  const myBranch = useAuth((s) => s.profile?.branch_id) ?? ''
  const [branch, setBranch] = useState(seesAllBranches ? '' : myBranch)
  const [from, setFrom] = useState(toISODate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)))
  const [to, setTo] = useState(toISODate(new Date()))
  return (
    <>
      <PageHeader title="الأرباح والخسائر" subtitle="قائمة الدخل من الأستاذ العام — كل فرع بشكل مستقل أو الشركة كاملة"
        actions={<>
          <PeriodBar from={from} to={to} branch={branch} onFrom={setFrom} onTo={setTo} onBranch={setBranch} showBranch={seesAllBranches} />
          <Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" /></Button>
        </>} />
      <IncomeStatement from={from} to={to} branch={branch} />
    </>
  )
}
