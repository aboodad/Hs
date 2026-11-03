import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { supabase } from '@/lib/supabase'
import { errMsg } from '@/lib/errors'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setError('')
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/login` })
    setLoading(false)
    if (error) setError(errMsg(error)); else setDone(true)
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h2 className="text-lg font-bold">استعادة كلمة المرور</h2>
      {done ? (
        <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">تم إرسال رابط الاستعادة إلى بريدك الإلكتروني.</div>
      ) : (
        <>
          <p className="text-sm text-stone-500">أدخل البريد الإلكتروني المرتبط بحسابك. إن كان حسابك باسم مستخدم فقط، تواصل مع مدير النظام لإعادة التعيين.</p>
          <Field label="البريد الإلكتروني"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          <Button type="submit" className="w-full" loading={loading}>إرسال الرابط</Button>
        </>
      )}
      <div className="text-center"><Link to="/login" className="text-sm text-gold-700 hover:underline">العودة لتسجيل الدخول</Link></div>
    </form>
  )
}
