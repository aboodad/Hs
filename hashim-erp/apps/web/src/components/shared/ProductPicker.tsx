import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { fmtMoney } from '@/lib/formatters'

export interface PickedProduct {
  id: string; name: string; barcode: string | null; sku: string
  cost_price: number; wholesale_price: number; retail_price: number
}

/**
 * اختيار منتج: حقل بحث (اسم / باركود / رمز) وتحته قائمة بكل المنتجات الفعّالة.
 * القائمة تُعرض داخل الصفحة (وليست منسدلة عائمة) فلا تُقصّ داخل النوافذ ولا تختفي عند النقر.
 */
export function ProductPicker({ onPick, placeholder = 'ابحث عن منتج (اسم / باركود / رمز)...', priceField = 'cost_price', maxHeight = 'max-h-56' }: {
  onPick: (p: PickedProduct) => void; placeholder?: string; priceField?: 'cost_price' | 'wholesale_price' | 'retail_price'; maxHeight?: string
}) {
  const [q, setQ] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['product-picker', 'all'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id,name,barcode,sku,cost_price,wholesale_price,retail_price')
        .eq('is_active', true)
        .order('name')
        .limit(2000)
      if (error) throw error
      return data as PickedProduct[]
    },
  })

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return data ?? []
    return (data ?? []).filter((p) =>
      p.name.toLowerCase().includes(s) || (p.barcode ?? '').toLowerCase().includes(s) || (p.sku ?? '').toLowerCase().includes(s))
  }, [data, q])

  // نمنع انتقال النقر إلى عنصر <label> المحيط (Field) لأنه كان يعيد التركيز/النقر ويُفسد الاختيار
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()

  return (
    <div onClick={stop} onMouseDown={stop}>
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-2.5 h-4 w-4 text-stone-400" />
        <input className="input ps-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
      </div>
      <div className={`mt-2 overflow-y-auto rounded-xl border border-cream-300 bg-white ${maxHeight}`}>
        {isLoading && <div className="p-3 text-center text-sm text-stone-400">جارٍ التحميل...</div>}
        {!isLoading && rows.length === 0 && <div className="p-3 text-center text-sm text-stone-400">لا نتائج</div>}
        <ul className="divide-y divide-cream-200">
          {rows.map((p) => (
            <li key={p.id}>
              <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-start text-sm hover:bg-brand-50 active:bg-brand-100"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPick(p) }}>
                <span className="min-w-0 flex-1 truncate">{p.name} <span className="text-xs text-stone-400">{p.barcode ?? p.sku}</span></span>
                <span className="shrink-0 text-xs text-stone-500">{fmtMoney(p[priceField])}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {!isLoading && <div className="mt-1 text-[11px] text-stone-400">{rows.length} منتج</div>}
    </div>
  )
}
