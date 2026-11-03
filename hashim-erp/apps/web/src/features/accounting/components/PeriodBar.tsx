import { Input } from '@/components/ui/Field'
import { BranchSelect } from '@/components/shared/BranchSelect'

/** شريط الفترة والفرع المشترك بين التقارير المالية */
export function PeriodBar({ from, to, branch, onFrom, onTo, onBranch, showBranch, single }: {
  from?: string; to: string; branch: string; onFrom?: (v: string) => void; onTo: (v: string) => void
  onBranch: (v: string) => void; showBranch: boolean; single?: boolean
}) {
  return (
    <>
      {!single && <Input type="date" value={from} onChange={(e) => onFrom?.(e.target.value)} className="w-40" />}
      <Input type="date" value={to} onChange={(e) => onTo(e.target.value)} className="w-40" />
      {showBranch && <BranchSelect includeAll value={branch} onChange={onBranch} className="w-48" />}
    </>
  )
}
