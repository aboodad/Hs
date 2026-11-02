import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import clsx from 'clsx'

/** لوحة (بطاقة بعنوان) موحّدة لأقسام لوحة التحكم */
export function Panel({ title, subtitle, link, actions, children, className, delay = 0, pad = true }: {
  title: string; subtitle?: string; link?: { to: string; label: string }; actions?: ReactNode
  children: ReactNode; className?: string; delay?: number; pad?: boolean
}) {
  return (
    <section style={{ animationDelay: `${delay}ms` }} className={clsx('card fade-up flex flex-col', className)}>
      <header className="flex items-center justify-between gap-2 border-b border-cream-200 px-5 py-3.5">
        <div>
          <h3 className="flex items-center gap-2 text-[15px] font-bold text-brand-800"><span className="h-4 w-1 rounded-full bg-gradient-to-b from-gold-300 to-gold-600" />{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-brand-300">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">{actions}{link && <Link to={link.to} className="inline-flex items-center gap-0.5 text-xs font-semibold text-gold-700 hover:text-gold-800">{link.label}<ChevronLeft className="h-3.5 w-3.5" /></Link>}</div>
      </header>
      <div className={clsx('min-h-0 flex-1', pad && 'p-5')}>{children}</div>
    </section>
  )
}
