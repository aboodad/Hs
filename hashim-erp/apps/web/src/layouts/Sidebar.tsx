import { NavLink } from 'react-router-dom'
import clsx from 'clsx'
import { X } from 'lucide-react'
import { NAV } from './nav.config'
import { usePermission } from '@/hooks/usePermission'
import { useCompany } from '@/hooks/useLookups'

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { can } = usePermission()
  const { data: company } = useCompany()

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-brand-950/50 backdrop-blur-sm lg:hidden" onClick={onClose} />}
      <aside className={clsx(
        'fixed inset-y-0 start-0 z-40 flex w-64 flex-col bg-gradient-to-b from-brand-900 to-brand-950 text-cream-200 shadow-xl transition-transform lg:static lg:translate-x-0',
        open ? 'translate-x-0' : 'translate-x-full rtl:translate-x-full lg:!translate-x-0',
      )}>
        <div className="flex items-center justify-between border-b border-gold-500/20 px-4 py-5">
          <div className="flex items-center gap-3">
            {company?.logo_url
              ? <img src={company.logo_url} className="h-10 w-10 rounded-xl bg-white object-contain p-0.5" alt="" />
              : <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-gold-300 to-gold-600 text-lg font-bold text-brand-950 shadow-gold">هـ</div>}
            <div className="leading-tight">
              <div className="text-sm font-bold text-cream-50">{company?.name ?? 'هاشم للطيب والعطور'}</div>
              <div className="text-[10px] text-gold-400">نظام الإدارة المتكامل</div>
            </div>
          </div>
          <button className="lg:hidden" onClick={onClose}><X className="h-5 w-5" /></button>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {NAV.map((g) => {
            const items = g.items.filter((i) => i.module === '*' || can(i.module, 'view'))
            if (!items.length) return null
            return (
              <div key={g.title}>
                <div className="mb-1.5 px-3 text-[10.5px] font-semibold tracking-wide text-gold-500/90">{g.title}</div>
                {items.map((i) => (
                  <NavLink key={i.to} to={i.to} end={i.to === '/'} onClick={onClose}
                    className={({ isActive }) => clsx('group relative flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] transition',
                      isActive ? 'bg-gold-500/15 font-semibold text-gold-200' : 'text-cream-300/90 hover:bg-white/5 hover:text-cream-50')}>
                    {({ isActive }) => (<>
                      {isActive && <span className="absolute inset-y-1.5 end-0 w-1 rounded-full bg-gradient-to-b from-gold-300 to-gold-600" />}
                      <i.icon className={clsx('h-[18px] w-[18px] shrink-0', isActive ? 'text-gold-300' : 'text-cream-400/70 group-hover:text-gold-300')} /> {i.label}
                    </>)}
                  </NavLink>
                ))}
              </div>
            )
          })}
        </nav>
        <div className="border-t border-gold-500/20 px-4 py-3 text-center text-[10px] text-cream-400/60">© هاشم للطيب والعطور</div>
      </aside>
    </>
  )
}
