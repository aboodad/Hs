import { Select } from '@/components/ui/Field'
import { useBranches } from '@/hooks/useLookups'

export function BranchSelect({ value, onChange, includeAll, onlyBranches, className }: {
  value: string; onChange: (v: string) => void; includeAll?: boolean; onlyBranches?: boolean; className?: string
}) {
  const { data } = useBranches()
  const list = (data ?? []).filter((b) => b.is_active && (!onlyBranches || b.type === 'branch'))
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      {includeAll && <option value="">كل الفروع</option>}
      {list.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
    </Select>
  )
}
