import clsx from 'clsx'

/** تبويبات مقسّمة (Segmented) — بديل موحّد للأزرار المكررة في الصفحات */
export function Tabs<T extends string>({ tabs, value, onChange, className }: {
  tabs: readonly (readonly [T, string])[]; value: T; onChange: (k: T) => void; className?: string
}) {
  return (
    <div className={clsx('mb-5 inline-flex rounded-xl border border-cream-300 bg-white p-1', className)}>
      {tabs.map(([k, l]) => (
        <button key={k} onClick={() => onChange(k)}
          className={clsx('rounded-lg px-5 py-1.5 text-sm font-semibold transition', value === k ? 'bg-brand-700 text-cream-50' : 'text-brand-500 hover:bg-cream-100')}>{l}</button>
      ))}
    </div>
  )
}
