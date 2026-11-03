import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/** true = لا يوجد أي مستخدم بعد (يحتاج إعداداً أولياً). الخطأ يعني أن ملفات SQL لم تُشغَّل أو المفاتيح خاطئة. */
export const useNeedsSetup = () =>
  useQuery({
    queryKey: ['needs-setup'],
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_needs_setup')
      if (error) throw error
      return data as boolean
    },
  })
