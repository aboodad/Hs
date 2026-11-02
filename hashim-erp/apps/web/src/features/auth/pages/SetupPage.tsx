import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { toast } from '@/store/toast.store'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Spinner'
import { useNeedsSetup } from '../useNeedsSetup'

/** الإعداد الأول: إنشاء أول مدير للنظام (يعمل مرة واحدة فقط) */
export default function SetupPage() {
  const nav = useNavigate()
  const { data: needs, isLoading, error } = useNeedsSetup()
  const [f, setF] = useState({ full_name: '', username: '', password: '', confirm: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  if (isLoading) return <Spinner />
  if (!error && needs === false) return <Navigate to="/login" replace />

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg('')
    if (f.password.length < 6) return setMsg('كلمة المرور 6 أحرف على الأقل')
    if (f.password !== f.confirm) return setMsg('كلمتا المرور غير متطابقتين')
    setBusy(true)
    const { data, error } = await supabase.functions.invoke('manage-user', { body: { action: 'bootstrap', ...f } })
    setBusy(false)
    let err = (data as any)?.error as string | undefined
    if (error && !err) { try { err = (await (error as any).context?.json?.())?.error } catch { /* */ } err = err ?? error.message }
    if (err) return setMsg(err)
    toast.success('تم إنشاء حساب مدير النظام. سجّل الدخول الآن.')
    nav('/login', { replace: true })
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-800 text-gold-300"><ShieldCheck className="h-6 w-6" /></div>
        <div><h2 className="text-xl font-bold text-brand-800">الإعداد الأول للنظام</h2><p className="text-sm text-brand-400">أنشئ حساب مدير النظام (يظهر هذا مرة واحدة فقط)</p></div>
      </div>
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">تعذر الاتصال بقاعدة البيانات: تأكد من تشغيل ملفات SQL ومن صحة مفاتيح .env.</div>}
      <Field label="الاسم الكامل"><Input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} required /></Field>
      <Field label="اسم المستخدم" hint="حروف إنجليزية بدون مسافات، مثال: admin"><Input dir="ltr" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="كلمة المرور"><Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></Field>
        <Field label="تأكيد كلمة المرور"><Input type="password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required /></Field>
      </div>
      {msg && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{msg}</div>}
      <Button type="submit" variant="gold" size="lg" className="w-full" loading={busy}>إنشاء مدير النظام</Button>
      <div className="text-center"><Link to="/login" className="text-sm font-medium text-gold-700 hover:underline">لدي حساب بالفعل</Link></div>
    </form>
  )
}
