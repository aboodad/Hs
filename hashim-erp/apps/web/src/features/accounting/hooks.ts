import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Account } from './lib'

export const useAccounts = () =>
  useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('accounts').select('*').order('code')
      if (error) throw error
      return (data ?? []) as Account[]
    },
    staleTime: 60_000,
  })

export const useAccountMappings = () =>
  useQuery({
    queryKey: ['account-mappings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('account_mappings').select('*').order('label')
      if (error) throw error
      return data ?? []
    },
  })

/** تقرير مالي من دالة قاعدة البيانات (ميزان/قائمة دخل/ميزانية/أستاذ) */
export const useReportRpc = <T,>(key: unknown[], fn: string, args: Record<string, unknown>, enabled = true) =>
  useQuery({
    queryKey: ['acc-report', fn, ...key],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(fn, args)
      if (error) throw error
      return (data ?? []) as T[]
    },
  })
