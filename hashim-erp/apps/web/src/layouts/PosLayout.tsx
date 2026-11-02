import { Outlet, Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useAuth } from '@/store/auth.store'

// واجهة البيع: بدون سايدبار، بأزرار كبيرة وشاشة كاملة
export function PosLayout() {
  const profile = useAuth((s) => s.profile)
  return (
    <div className="flex h-screen flex-col bg-cream-100">
      <header className="flex items-center justify-between border-b-2 border-gold-500 bg-gradient-to-l from-brand-900 to-brand-800 px-4 py-2.5 text-cream-100">
        <Link to="/" className="flex items-center gap-1 text-sm text-gold-300 hover:text-gold-100"><ArrowRight className="h-4 w-4" /> الرئيسية</Link>
        <div className="text-sm">
          <b className="text-gold-300">{profile?.branch.name}</b> · البائع: {profile?.full_name}
        </div>
      </header>
      <main className="min-h-0 flex-1"><Outlet /></main>
    </div>
  )
}
