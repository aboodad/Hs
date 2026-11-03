import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, CheckCheck, ChevronLeft } from 'lucide-react'
import clsx from 'clsx'
import { supabase } from '@/lib/supabase'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { fmtDateTime } from '@/lib/formatters'

const PAGE = 50

/** الصفحة التي يفتحها الإشعار حسب الجدول المرتبط به */
const refLink = (table?: string | null, id?: string | null): string | null => {
  if (!table || !id) return null
  if (table === 'stock_requests') return `/requests/${id}`
  if (table === 'stock_transfers') return `/transfers/${id}`
  if (table === 'stock_counts') return `/inventory/counts/${id}`
  return null
}

const TYPE_LABEL: Record<string, string> = {
  low_stock: 'مخزون',
  new_request: 'طلب بضاعة',
  request_decision: 'قرار طلب',
  transfer_arriving: 'تحويل',
  receive_difference: 'فرق استلام',
}

export default function NotificationsPage() {
  const qc = useQueryClient()
  const [filter, setFilter] = useState<'all' | 'unread'>('all')

  const list = useInfiniteQuery({
    queryKey: ['notifications', 'all', filter],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      let q = supabase.from('notifications').select('*').order('created_at', { ascending: false })
        .range(pageParam, pageParam + PAGE - 1)
      if (filter === 'unread') q = q.eq('is_read', false)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length * PAGE : undefined),
  })
  const items = list.data?.pages.flat() ?? []

  const { data: unread = 0 } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: async () => {
      const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('is_read', false)
      return count ?? 0
    },
  })

  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] })
  const markAll = async () => {
    await supabase.from('notifications').update({ is_read: true }).eq('is_read', false)
    refresh()
  }
  const markOne = async (id: string) => {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id)
    refresh()
  }

  return (
    <>
      <PageHeader title="الإشعارات" actions={<Button variant="secondary" onClick={markAll} disabled={!unread}><CheckCheck className="h-4 w-4" /> تعليم الكل كمقروء</Button>} />

      <div className="mb-3 flex gap-2">
        {([['all', 'الكل'], ['unread', `غير المقروءة (${unread})`]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={clsx('rounded-full border px-4 py-1.5 text-sm', filter === k ? 'border-brand-700 bg-brand-700 text-white' : 'border-cream-400 bg-white text-brand-700')}>{l}</button>
        ))}
      </div>

      {list.isLoading ? <Spinner /> : (
        <div className="card divide-y divide-cream-200">
          {!items.length && (
            <div className="flex flex-col items-center gap-2 p-10 text-stone-400"><Bell className="h-8 w-8" />لا توجد إشعارات</div>
          )}
          {items.map((n) => {
            const to = refLink(n.ref_table, n.ref_id)
            return (
              <div key={n.id} className={clsx('flex items-start gap-3 p-4', !n.is_read && 'bg-brand-50')}>
                <span className={clsx('mt-2 h-2 w-2 shrink-0 rounded-full', n.is_read ? 'bg-transparent' : 'bg-red-600')} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{n.title}</span>
                    {TYPE_LABEL[n.type] && <span className="rounded bg-cream-200 px-1.5 text-[11px] text-brand-600">{TYPE_LABEL[n.type]}</span>}
                  </div>
                  {n.body && <div className="text-sm text-stone-600">{n.body}</div>}
                  <div className="mt-1 flex items-center gap-3 text-xs text-stone-400">
                    <span>{fmtDateTime(n.created_at)}</span>
                    {to && <Link to={to} onClick={() => !n.is_read && markOne(n.id)} className="flex items-center text-brand-700">فتح <ChevronLeft className="h-3 w-3" /></Link>}
                    {!n.is_read && <button onClick={() => markOne(n.id)} className="text-brand-700">تعليم كمقروء</button>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {list.hasNextPage && (
        <div className="mt-3 text-center"><Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>عرض المزيد</Button></div>
      )}
    </>
  )
}
