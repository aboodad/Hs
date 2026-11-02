import { Select } from '@/components/ui/Field'
import { useAccounts } from '../hooks'
import type { AccountType } from '../lib'

/** قائمة اختيار حساب فرعي (ورقة) فعّال، مع إمكانية حصر النوع */
export function AccountSelect({ value, onChange, types, className, placeholder = '— اختر الحساب —' }: {
  value: string; onChange: (id: string) => void; types?: AccountType[]; className?: string; placeholder?: string
}) {
  const { data } = useAccounts()
  const list = (data ?? []).filter((a) => !a.is_group && a.is_active && (!types || types.includes(a.account_type)))
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="">{placeholder}</option>
      {list.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
    </Select>
  )
}
