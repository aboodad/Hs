import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export const useBranches = () =>
  useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const { data, error } = await supabase.from('branches').select('id,code,name,type,is_active').order('name')
      if (error) throw error
      return data ?? []
    },
    staleTime: 5 * 60_000,
  })

export const useMainWarehouse = () => {
  const q = useBranches()
  return { ...q, data: q.data?.find((b) => b.type === 'main_warehouse') }
}

export const usePaymentMethods = () =>
  useQuery({
    queryKey: ['payment_methods'],
    queryFn: async () => {
      const { data, error } = await supabase.from('payment_methods').select('id,name,type,is_cash').eq('is_active', true).order('name')
      if (error) throw error
      return data ?? []
    },
    staleTime: 5 * 60_000,
  })

export const useCategories = () =>
  useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data, error } = await supabase.from('categories').select('id,name').eq('is_active', true).order('sort_order')
      if (error) throw error
      return data ?? []
    },
    staleTime: 5 * 60_000,
  })

/** جدول مرجعي فعّال مرتب بالاسم (id + name + أعمدة إضافية اختيارية) */
const useActiveList = (table: string, columns: string, orderBy: string, filter: Record<string, unknown> = { is_active: true }) =>
  useQuery({
    queryKey: ['lookup', table, columns],
    queryFn: async () => {
      let q = supabase.from(table).select(columns)
      Object.entries(filter).forEach(([k, v]) => { q = q.eq(k, v as any) })
      const { data, error } = await q.order(orderBy)
      if (error) throw error
      return (data ?? []) as any[]
    },
    staleTime: 5 * 60_000,
  })
export const useSuppliers = () => useActiveList('suppliers', 'id,name', 'name')
export const useExpenseCategories = () => useActiveList('expense_categories', 'id,name,kind', 'name')
export const useIncomeTypes = () => useActiveList('income_types', 'id,name', 'name')
export const useActiveEmployees = () => useActiveList('employees', 'id,full_name', 'full_name', { status: 'active' })

export const useCompany = () =>
  useQuery({
    queryKey: ['company'],
    queryFn: async () => {
      const { data } = await supabase.from('company_profile').select('*').limit(1).maybeSingle()
      return data
    },
    staleTime: 10 * 60_000,
  })

/** وردية المستخدم المفتوحة (إن وُجدت) */
export const useOpenShift = (userId?: string) =>
  useQuery({
    queryKey: ['open-shift', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.from('shifts').select('*').eq('user_id', userId!).eq('status', 'open').maybeSingle()
      if (error) throw error
      return data
    },
  })

/** قراءة إعداد عام من جدول settings (branch_id = null) */
export const useSetting = <T,>(key: string, fallback: T) =>
  useQuery({
    queryKey: ['setting', key],
    queryFn: async () => {
      const { data } = await supabase.from('settings').select('value').eq('key', key).is('branch_id', null).maybeSingle()
      return ((data?.value as T) ?? fallback) as T
    },
    staleTime: 60_000,
  })

/** حفظ إعداد عام (تحديث إن وُجد وإلا إدراج) */
export async function saveSetting(key: string, value: unknown) {
  const { data } = await supabase.from('settings').select('id').eq('key', key).is('branch_id', null).maybeSingle()
  const res = data
    ? await supabase.from('settings').update({ value }).eq('id', data.id)
    : await supabase.from('settings').insert({ key, value })
  if (res.error) throw res.error
}

// ── هوية الشركة (الاسم + الشعار) لشاشة الدخول: تُقرأ قبل تسجيل الدخول عبر دالة عامة، وتُخزَّن محلياً للظهور الفوري
const BRANDING_KEY = 'hashim.branding'
export interface Branding { name?: string; logo_url?: string | null }
const cachedBranding = (): Branding | undefined => {
  try { return JSON.parse(localStorage.getItem(BRANDING_KEY) ?? 'null') ?? undefined } catch { return undefined }
}
export const saveBrandingCache = (b: Branding) => { try { localStorage.setItem(BRANDING_KEY, JSON.stringify(b)) } catch { /* ignore */ } }

export const useBranding = () =>
  useQuery({
    queryKey: ['branding'],
    initialData: cachedBranding,
    initialDataUpdatedAt: 0,
    staleTime: 60_000,
    retry: 1,
    queryFn: async (): Promise<Branding> => {
      const { data, error } = await supabase.rpc('fn_public_branding')
      if (error) throw error
      const b = (data ?? {}) as Branding
      saveBrandingCache(b)
      return b
    },
  })
