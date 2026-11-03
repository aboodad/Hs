import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

export interface Profile {
  id: string
  full_name: string
  branch_id: string
  role_id: string
  employee_id: string | null
  is_active: boolean
  role: { code: string; name: string; all_branches: boolean }
  branch: { name: string; type: string }
}

interface AuthState {
  session: Session | null
  profile: Profile | null
  permissions: Set<string>
  loading: boolean
  init: () => Promise<void>
  signIn: (identifier: string, password: string, expectedRole?: string) => Promise<void>
  signOut: () => Promise<void>
  can: (module: string, action?: string) => boolean
}

// اسم المستخدم/الهاتف يتحول إلى بريد داخلي (انظر ملاحظة ملف SQL)
const toEmail = (id: string) => (id.includes('@') ? id.trim() : `${id.trim().toLowerCase()}@hashim.local`)

let initialized = false

async function loadProfile(uid: string) {
  const { data: p, error } = await supabase
    .from('profiles')
    .select('*, role:roles(code,name,all_branches), branch:branches(name,type)')
    .eq('id', uid)
    .single()
  if (error || !p) throw new Error('لا يوجد ملف مستخدم مرتبط بهذا الحساب')
  if (!p.is_active) throw new Error('هذا الحساب موقوف')

  const { data: rp } = await supabase
    .from('role_permissions')
    .select('permission:permissions(module,action)')
    .eq('role_id', p.role_id)
  const perms = new Set<string>(
    (rp ?? []).map((r: any) => `${r.permission?.module}:${r.permission?.action}`),
  )
  return { profile: p as Profile, permissions: perms }
}

export const useAuth = create<AuthState>((set, get) => ({
  session: null,
  profile: null,
  permissions: new Set(),
  loading: true,

  init: async () => {
    if (initialized) return
    initialized = true
    try {
      // مهلة 10 ثوانٍ حتى لا يبقى التطبيق معلّقاً إن تعذّر الوصول إلى Supabase
      const { data } = await Promise.race([
        supabase.auth.getSession(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('auth timeout')), 10000)),
      ])
      if (data.session) {
        try {
          const { profile, permissions } = await loadProfile(data.session.user.id)
          set({ session: data.session, profile, permissions })
        } catch {
          await supabase.auth.signOut().catch(() => {})
        }
      }
    } catch (e) {
      console.error('[auth.init]', e)
    } finally {
      set({ loading: false })
    }

    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') set({ session: null, profile: null, permissions: new Set() })
      else if (event === 'TOKEN_REFRESHED' && session) set({ session })
    })
  },

  signIn: async (identifier, password, expectedRole) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email: toEmail(identifier), password })
    if (error) throw error
    try {
      const { profile, permissions } = await loadProfile(data.user.id)
      // الدخول حسب الدور: يجب أن يطابق دور الحساب الدور المختار في الشاشة
      if (expectedRole && profile.role.code !== expectedRole) {
        throw new Error(`الدور المختار لا يطابق حسابك. دور حسابك هو «${profile.role.name}». اختر الدور الصحيح.`)
      }
      set({ session: data.session, profile, permissions })
      await supabase.rpc('fn_touch_login')
    } catch (e) {
      await supabase.auth.signOut()
      throw e
    }
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({ session: null, profile: null, permissions: new Set() })
  },

  can: (module, action = 'view') => {
    const { profile, permissions } = get()
    if (!profile) return false
    if (profile.role.code === 'super_admin') return true
    return permissions.has(`${module}:${action}`)
  },
}))
