// التحقق من متغيرات البيئة (الربط بـ Supabase يحتاج هذين المفتاحين فقط)
// الأولوية: ملف .env (وقت البناء) ثم القيم المحفوظة من زر «ربط Supabase» في المتصفح
const LS_KEY = 'hashim-erp:supabase'

function stored(): { url?: string; key?: string } {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') } catch { return {} }
}

const valid = (u: string, k: string) =>
  /^https?:\/\/.+/.test(u) && !u.includes('YOUR-PROJECT') && k.length > 20 && !k.includes('YOUR-ANON-KEY')

const envUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').trim()
const envKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()
const s = stored()
const useEnv = valid(envUrl, envKey)
const url = useEnv ? envUrl : (s.url ?? '').trim()
const key = useEnv ? envKey : (s.key ?? '').trim()

export const env = { supabaseUrl: url, supabaseAnonKey: key }
export const envReady = valid(url, key)

/** يحفظ بيانات الربط من الواجهة (زر ربط Supabase) */
export function saveSupabaseConfig(u: string, k: string) {
  localStorage.setItem(LS_KEY, JSON.stringify({ url: u.trim().replace(/\/+$/, ''), key: k.trim() }))
}
export function clearSupabaseConfig() {
  try { localStorage.removeItem(LS_KEY) } catch { /* ignore */ }
}
export const isStoredConfig = envReady && !useEnv

/** يتحقق فعلياً من الاتصال بالمشروع قبل الحفظ */
export async function testSupabase(u: string, k: string): Promise<string | null> {
  const base = u.trim().replace(/\/+$/, '')
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(base) && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(base))
    return 'رابط المشروع غير صحيح. الشكل: https://xxxx.supabase.co'
  if (k.trim().length < 20) return 'مفتاح anon غير صحيح'
  try {
    const r = await fetch(`${base}/auth/v1/settings`, { headers: { apikey: k.trim() } })
    if (r.status === 401 || r.status === 403) return 'المفتاح مرفوض — تأكد أنه anon / public لنفس المشروع'
    if (!r.ok) return `تعذّر الاتصال (رمز ${r.status})`
    return null
  } catch {
    return 'تعذّر الوصول إلى المشروع — تحقق من الرابط والإنترنت'
  }
}
