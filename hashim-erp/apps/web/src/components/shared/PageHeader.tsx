import type { ReactNode } from 'react'

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="fade-up mb-6 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="h-9 w-1.5 rounded-full bg-gradient-to-b from-gold-300 to-gold-600" />
        <div>
          <h1 className="text-[22px] font-bold leading-tight text-brand-800">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-brand-400">{subtitle}</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  )
}
