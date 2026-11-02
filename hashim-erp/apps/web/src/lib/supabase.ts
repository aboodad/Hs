import { createClient } from '@supabase/supabase-js'
import { env, envReady } from './env'

// عند غياب المفاتيح نستخدم قيماً مؤقتة حتى لا ينهار التطبيق، وتظهر شاشة تعليمات الإعداد (EnvMissing)
export const supabase = createClient(
  envReady ? env.supabaseUrl : 'http://localhost:54321',
  envReady ? env.supabaseAnonKey : 'missing-anon-key',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
)

// لتفعيل الأنواع الكاملة: npm run gen:types ثم createClient<Database>(...)
