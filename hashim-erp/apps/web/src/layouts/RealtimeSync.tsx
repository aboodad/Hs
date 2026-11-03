import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toast } from '@/store/toast.store'

/** مفاتيح الاستعلامات التي تتجدد عند تغيّر كل جدول (تُطابق أول عنصر في queryKey) */
const KEYS: Record<string, string[]> = {
  stock_balances: ['stock-status', 'pos-stock', 'products', 'requests', 'dash-kpis', 'dash-low', 'branch-kpis', 'branch-low'],
  stock_requests: ['requests', 'dash-kpis'],
  stock_transfers: ['transfers', 'requests', 'stock-status', 'dash-kpis'],
  notifications: ['notifications'],
}

/** اشتراك لحظي (Supabase Realtime): يحدّث الشاشات المفتوحة تلقائياً بدون إعادة تحميل، ويُظهر تنبيهاً عند وصول إشعار جديد */
export function RealtimeSync() {
  const qc = useQueryClient()

  useEffect(() => {
    // دمج التحديثات المتتالية (دفعة حركات مخزون مثلاً) في تحديث واحد
    const pending = new Set<string>()
    let timer: ReturnType<typeof setTimeout> | null = null
    const flush = () => {
      timer = null
      const keys = new Set<string>()
      pending.forEach((t) => KEYS[t]?.forEach((k) => keys.add(k)))
      pending.clear()
      qc.invalidateQueries({ predicate: (q) => keys.has(String(q.queryKey[0])) })
    }
    const schedule = (table: string) => {
      pending.add(table)
      if (!timer) timer = setTimeout(flush, 400)
    }

    let ch = supabase.channel('erp-realtime')
    for (const table of Object.keys(KEYS)) {
      ch = ch.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
        schedule(table)
        if (table === 'notifications' && payload.eventType === 'INSERT') {
          const n = payload.new as { title?: string }
          if (n?.title) toast.info(`🔔 ${n.title}`)
        }
      })
    }
    ch.subscribe()

    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(ch)
    }
  }, [qc])

  return null
}
