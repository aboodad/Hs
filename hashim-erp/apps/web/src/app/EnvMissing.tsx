import { useState } from 'react'
import { KeyRound, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { saveSupabaseConfig, testSupabase } from '@/lib/env'

/** شاشة تظهر فقط إذا لم تُضبط مفاتيح Supabase في ملف .env */
export function EnvMissing() {
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [err, setErr] = useState<string | null>(null)

  async function connect() {
    setErr(null)
    const e = await testSupabase(url, key)
    if (e) { setErr(e); return }
    saveSupabaseConfig(url, key)
    location.reload()
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream-100 p-6">
      <div className="card w-full max-w-xl p-8">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-gold-300 to-gold-600 text-brand-950"><KeyRound className="h-6 w-6" /></div>
          <div><h1 className="text-xl font-bold text-brand-800">مطلوب ربط Supabase</h1><p className="text-sm text-brand-400">آخر خطوة قبل تشغيل النظام</p></div>
        </div>
        <div className="mb-6 space-y-3 rounded-2xl border border-gold-300 bg-gold-50/50 p-4">
          <p className="text-sm font-semibold text-brand-800">ربط سريع</p>
          <input dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxx.supabase.co"
            className="w-full rounded-xl border border-cream-400 bg-white px-3 py-2 text-sm" />
          <input dir="ltr" value={key} onChange={(e) => setKey(e.target.value)} placeholder="anon public key (eyJ...)"
            className="w-full rounded-xl border border-cream-400 bg-white px-3 py-2 text-sm" />
          {err && <p className="text-sm text-red-700">{err}</p>}
          <Button variant="gold" className="w-full" disabled={!url || !key} onClick={connect}><Link2 className="h-4 w-4" /> ربط Supabase</Button>
          <p className="text-xs text-brand-400">تُحفظ القيمتان في هذا المتصفح فقط. للنشر الدائم على Vercel استخدم متغيرات البيئة أدناه.</p>
        </div>
        <ol className="list-decimal space-y-3 pe-5 text-sm leading-7 text-brand-700">
          <li>انسخ الملف <code className="rounded bg-cream-200 px-1.5" dir="ltr">.env.example</code> إلى <code className="rounded bg-cream-200 px-1.5" dir="ltr">.env</code> داخل <code className="rounded bg-cream-200 px-1.5" dir="ltr">apps/web</code>.</li>
          <li>من لوحة Supabase افتح <b>Project Settings ← API</b> وانسخ القيمتين:
            <pre dir="ltr" className="mt-2 rounded-xl bg-cream-100 p-3 text-xs">{`VITE_SUPABASE_URL=https://xxxx.supabase.co\nVITE_SUPABASE_ANON_KEY=eyJ...`}</pre></li>
          <li><b>على Vercel:</b> Project ← Settings ← Environment Variables ← أضف <code dir="ltr">VITE_SUPABASE_URL</code> و<code dir="ltr">VITE_SUPABASE_ANON_KEY</code> (Production + Preview) ثم <b>Redeploy</b> (المتغيرات تُدمج وقت البناء).</li>
          <li>محلياً: أعد تشغيل الخادم: <code className="rounded bg-cream-200 px-1.5" dir="ltr">npm run dev</code></li>
        </ol>
        <p className="mt-5 rounded-xl border border-gold-300 bg-gold-50 p-3 text-xs text-gold-800">استخدم مفتاح <b>anon / public</b> فقط. لا تضع مفتاح service_role في هذا الملف أبداً.</p>
      </div>
    </div>
  )
}
