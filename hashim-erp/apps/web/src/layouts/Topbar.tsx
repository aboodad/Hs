import { Menu, LogOut, MapPin } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/store/auth.store'
import { NotificationBell } from './NotificationBell'

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const profile = useAuth((s) => s.profile)
  const signOut = useAuth((s) => s.signOut)
  const nav = useNavigate()
  const initial = profile?.full_name?.trim()?.[0] ?? 'م'

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-cream-300/70 bg-cream-50/80 px-4 py-3 backdrop-blur-md lg:px-6">
      <button className="rounded-xl p-2 text-brand-600 hover:bg-cream-200 lg:hidden" onClick={onMenu}><Menu className="h-5 w-5" /></button>
      <div className="hidden items-center gap-1.5 rounded-full border border-gold-300/60 bg-gold-50 px-3 py-1 text-sm text-gold-800 lg:flex">
        <MapPin className="h-4 w-4" /> <b>{profile?.branch.name}</b>
      </div>
      <div className="flex items-center gap-3">
        <NotificationBell />
        <div className="flex items-center gap-2.5 rounded-full border border-cream-300 bg-white py-1 pe-3 ps-1 shadow-sm">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-gold-300 to-gold-600 text-sm font-bold text-brand-950">{initial}</div>
          <div className="hidden leading-tight sm:block">
            <div className="text-[13px] font-semibold text-brand-900">{profile?.full_name}</div>
            <div className="text-[10.5px] text-gold-700">{profile?.role.name}</div>
          </div>
        </div>
        <button title="تسجيل الخروج" className="rounded-xl p-2 text-brand-500 hover:bg-red-50 hover:text-red-700"
          onClick={async () => { await signOut(); nav('/login') }}>
          <LogOut className="h-5 w-5" />
        </button>
      </div>
    </header>
  )
}
