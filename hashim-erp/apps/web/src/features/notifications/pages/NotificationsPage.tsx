import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { fmtDateTime } from '@/lib/formatters'

export default function NotificationsPage() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['notifications', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(100)
      if (error) throw error
      return data ?? []
    },
  })
  const markAll = async () => {
    const ids = (data ?? []).filter((n) => !n.is_read).map((n) => n.id)
    if (ids.length) await supabase.from('notifications').update({ is_read: true }).in('id', ids)
    qc.invalidateQueries({ queryKey: ['notifications'] })
  }
  return (
    <>
      <PageHeader title="الإشعارات" actions={<Button variant="secondary" onClick={markAll}>تعليم الكل كمقروء</Button>} />
      {isLoading ? <Spinner /> : (
        <div className="card divide-y divide-cream-200">
          {!data?.length && <div className="p-10 text-center text-stone-400">لا توجد إشعارات</div>}
          {data?.map((n) => (
            <div key={n.id} className={n.is_read ? 'p-4' : 'bg-brand-50 p-4'}>
              <div className="font-semibold">{n.title}</div>
              {n.body && <div className="text-sm text-stone-600">{n.body}</div>}
              <div className="mt-1 text-xs text-stone-400">{fmtDateTime(n.created_at)}</div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
