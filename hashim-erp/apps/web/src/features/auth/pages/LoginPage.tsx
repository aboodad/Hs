import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Check, Eye, EyeOff, Lock, User } from 'lucide-react'
import clsx from 'clsx'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { useAuth } from '@/store/auth.store'
import { errMsg } from '@/lib/errors'
import { ROLE_CARDS, landingFor } from '../roles'
import { useNeedsSetup } from '../useNeedsSetup'

const schema = z.object({
  identifier: z.string().min(2, 'أدخل اسم المستخدم أو رقم الهاتف'),
  password: z.string().min(6, 'كلمة المرور 6 أحرف على الأقل'),
})
type Form = z.infer<typeof schema>

const LAST_ROLE_KEY = 'hashim.lastRole'

export default function LoginPage() {
  const signIn = useAuth((s) => s.signIn)
  const session = useAuth((s) => s.session)
  const profile = useAuth((s) => s.profile)
  const nav = useNavigate()
  const loc = useLocation() as any
  const [role, setRole] = useState<string>(() => localStorage.getItem(LAST_ROLE_KEY) ?? '')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const setup = useNeedsSetup()
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({ resolver: zodResolver(schema) })

  if (session && profile) return <Navigate to={loc.state?.from ?? landingFor(profile.role.code)} replace />

  const selected = ROLE_CARDS.find((r) => r.code === role)

  const onSubmit = async (v: Form) => {
    if (!role) return setError('اختر دور الدخول أولاً')
    setError('')
    try {
      await signIn(v.identifier, v.password, role)
      localStorage.setItem(LAST_ROLE_KEY, role)
      nav(loc.state?.from ?? landingFor(role), { replace: true })
    } catch (e) {
      setError(errMsg(e))
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {setup.data === true && (
        <div className="rounded-xl border border-gold-300 bg-gold-50 p-3 text-sm text-gold-800">
          النظام جديد ولا يوجد مستخدمون. <Link to="/setup" className="font-bold underline">أنشئ حساب مدير النظام</Link>
        </div>
      )}
      {setup.isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          تعذر الاتصال بقاعدة البيانات. تأكد من: ١) مفاتيح <b dir="ltr">.env</b> ٢) تشغيل ملفات SQL (راجع README).
        </div>
      )}
      <div>
        <h2 className="text-2xl font-bold text-brand-800">مرحباً بعودتك</h2>
        <p className="mt-1 text-sm text-brand-400">اختر دورك ثم أدخل بيانات الدخول</p>
      </div>

      {/* اختيار الدور */}
      <div>
        <div className="mb-2 text-xs font-semibold text-brand-600">الدخول بصفة</div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {ROLE_CARDS.map((r) => {
            const on = role === r.code
            return (
              <button key={r.code} type="button" onClick={() => { setRole(r.code); setError('') }}
                className={clsx('relative rounded-2xl border p-3 text-start transition',
                  on ? 'border-gold-500 bg-gradient-to-br from-gold-50 to-cream-100 shadow-gold ring-2 ring-gold-300/60'
                     : 'border-cream-300 bg-cream-50 hover:border-gold-300 hover:bg-white')}>
                {on && <span className="absolute end-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-gold-500 text-white"><Check className="h-3 w-3" /></span>}
                <span className={clsx('mb-2 flex h-9 w-9 items-center justify-center rounded-xl', on ? 'bg-brand-800 text-gold-300' : 'bg-cream-200 text-brand-600')}>
                  <r.icon className="h-[18px] w-[18px]" />
                </span>
                <div className={clsx('text-[13px] font-bold leading-tight', on ? 'text-brand-800' : 'text-brand-700')}>{r.name}</div>
                <div className="mt-0.5 text-[11px] text-brand-300">{r.desc}</div>
              </button>
            )
          })}
        </div>
      </div>

      {/* بيانات الدخول */}
      <div className="space-y-4">
        <Field label="اسم المستخدم أو رقم الهاتف" error={errors.identifier?.message}>
          <div className="relative">
            <User className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-gold-600" />
            <Input className="ps-10" autoComplete="username" placeholder="مثال: sales.riyadh" {...register('identifier')} />
          </div>
        </Field>
        <Field label="كلمة المرور" error={errors.password?.message}>
          <div className="relative">
            <Lock className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-gold-600" />
            <Input className="px-10" type={show ? 'text' : 'password'} autoComplete="current-password" {...register('password')} />
            <button type="button" tabIndex={-1} onClick={() => setShow(!show)} className="absolute end-3 top-3 text-brand-300 hover:text-brand-600">
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      <Button type="submit" variant="gold" size="lg" className="w-full" arrow loading={isSubmitting}>
        {selected ? `دخول كـ ${selected.name}` : 'تسجيل الدخول'}
      </Button>
      <div className="text-center"><Link to="/forgot-password" className="text-sm font-medium text-gold-700 hover:underline">نسيت كلمة المرور؟</Link></div>
    </form>
  )
}
