import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { Gem, ShieldCheck, Store, Truck } from 'lucide-react'
import { useBranding } from '@/hooks/useLookups'

// شاشة الدخول: لوحة هوية بنية/ذهبية + منطقة النموذج الكريمية
export function AuthLayout() {
  const { data: company } = useBranding()
  const name = company?.name || 'هاشم للطيب والعطور'
  useEffect(() => { document.title = name }, [name])
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* لوحة الهوية */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-brand-950 via-brand-900 to-brand-700 p-12 text-cream-100 lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -start-24 -top-24 h-80 w-80 rounded-full bg-gold-500/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -end-20 h-96 w-96 rounded-full bg-gold-400/10 blur-3xl" />
        <div className="pointer-events-none absolute inset-0 opacity-[.07]"
          style={{ backgroundImage: 'radial-gradient(#e8c960 1px, transparent 1px)', backgroundSize: '26px 26px' }} />

        <div className="relative flex items-center gap-3">
          {company?.logo_url
            ? <img src={company.logo_url} className="h-12 w-12 rounded-xl bg-white object-contain p-1" alt="" />
            : <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-gold-300 to-gold-600 text-xl font-bold text-brand-950 shadow-gold">{name.trim().charAt(0)}</div>}
          <span className="text-lg font-bold text-cream-50">{name}</span>
        </div>

        <div className="relative max-w-md">
          <Gem className="mb-5 h-10 w-10 text-gold-400" />
          <h1 className="text-4xl font-bold leading-snug text-cream-50">أناقة العود،<br /><span className="gold-text">وإدارة بذكاء.</span></h1>
          <p className="mt-4 text-cream-300/90">منصة واحدة لإدارة الفروع والمخزون والمبيعات والحسابات والموظفين.</p>
          <div className="mt-8 grid grid-cols-3 gap-3 text-center text-xs">
            {[[Store, 'الفروع'], [Truck, 'المخزون'], [ShieldCheck, 'الصلاحيات']].map(([I, t]: any) => (
              <div key={t} className="rounded-2xl border border-gold-500/25 bg-white/5 px-3 py-4 backdrop-blur">
                <I className="mx-auto mb-2 h-6 w-6 text-gold-400" />{t}
              </div>
            ))}
          </div>
        </div>
        <div className="relative text-xs text-cream-400/60">© {new Date().getFullYear()} {name}</div>
      </aside>

      {/* النموذج */}
      <main className="flex items-center justify-center bg-cream-100 p-5 sm:p-10">
        <div className="w-full max-w-xl">
          <div className="mb-6 text-center lg:hidden">
            {company?.logo_url
              ? <img src={company.logo_url} className="mx-auto mb-3 h-16 w-16 rounded-2xl bg-white object-contain p-1.5 shadow-gold" alt="" />
              : <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-gold-300 to-gold-600 text-3xl font-bold text-brand-950 shadow-gold">{name.trim().charAt(0)}</div>}
            <h1 className="text-xl font-bold text-brand-800">{name}</h1>
          </div>
          <div className="card p-6 sm:p-8"><Outlet /></div>
        </div>
      </main>
    </div>
  )
}
