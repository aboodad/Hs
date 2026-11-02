import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { fmtDateTime } from '@/lib/formatters'

export function NotificationBell() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)

  const { data } = useQuery({
    queryKey: ['notifications', 'latest'],
    queryFn: async () => {
      const { data, error } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(8)
      if (error) throw error
      return data ?? []
    },
  })

  // تحديث لحظي عند وصول إشعار جديد
  useEffect(() => {
    const ch = supabase.channel('notif-bell')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' },
        () => qc.invalidateQueries({ queryKey: ['notifications'] }))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [qc])

  const unread = (data ?? []).filter((n) => !n.is_read).length

  const markAll = async () => {
    const ids = (data ?? []).filter((n) => !n.is_read).map((n) => n.id)
    if (ids.length) await supabase.from('notifications').update({ is_read: true }).in('id', ids)
    qc.invalidateQueries({ queryKey: ['notifications'] })
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="relative rounded-lg p-2 text-stone-600 hover:bg-cream-200">
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{unread}</span>}
      </button>
      {open && (
        <div className="card absolute end-0 z-50 mt-2 w-80 max-w-[90vw]">
          <div className="flex items-center justify-between border-b border-cream-200 px-4 py-2">
            <b className="text-sm">الإشعارات</b>
            <button className="text-xs text-brand-700" onClick={markAll}>تعليم الكل كمقروء</button>
          </div>
          <div className="max-h-80 divide-y divide-cream-200 overflow-y-auto">
            {!data?.length && <div className="p-6 text-center text-sm text-stone-400">لا توجد إشعارات</div>}
            {data?.map((n) => (
              <div key={n.id} className={n.is_read ? 'p-3' : 'bg-brand-50 p-3'}>
                <div className="text-sm font-semibold">{n.title}</div>
                {n.body && <div className="text-xs text-stone-500">{n.body}</div>}
                <div className="mt-1 text-[11px] text-stone-400">{fmtDateTime(n.created_at)}</div>
              </div>
            ))}
          </div>
          <Link to="/notifications" onClick={() => setOpen(false)} className="block border-t border-cream-200 p-2 text-center text-xs text-brand-700">عرض الكل</Link>
        </div>
      )}
    </div>
  )
}
