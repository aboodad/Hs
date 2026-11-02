import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useDebounce } from '@/hooks/useDebounce'
import { fmtMoney } from '@/lib/formatters'

export interface PickedProduct {
  id: string; name: string; barcode: string | null; sku: string
  cost_price: number; wholesale_price: number; retail_price: number
}

/** بحث منتجات بالاسم/الباركود/الرمز مع قائمة منسدلة */
export function ProductPicker({ onPick, placeholder = 'ابحث عن منتج (اسم / باركود / رمز)...', priceField = 'cost_price' }: {
  onPick: (p: PickedProduct) => void; placeholder?: string; priceField?: 'cost_price' | 'wholesale_price' | 'retail_price'
}) {
  const [q, setQ] = useState('')
  const dq = useDebounce(q.trim(), 250)
  const { data } = useQuery({
    queryKey: ['product-picker', dq],
    enabled: dq.length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id,name,barcode,sku,cost_price,wholesale_price,retail_price')
        .eq('is_active', true)
        .or(`name.ilike.%${dq}%,barcode.ilike.%${dq}%,sku.ilike.%${dq}%`)
        .limit(8)
      if (error) throw error
      return data as PickedProduct[]
    },
  })
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute start-3 top-2.5 h-4 w-4 text-stone-400" />
      <input className="input ps-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
      {dq.length >= 2 && data && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-cream-300 bg-white shadow-lg">
          {data.length === 0 && <div className="p-3 text-center text-sm text-stone-400">لا نتائج</div>}
          {data.map((p) => (
            <button key={p.id} type="button" className="flex w-full items-center justify-between px-3 py-2 text-start text-sm hover:bg-brand-50"
              onClick={() => { onPick(p); setQ('') }}>
              <span>{p.name} <span className="text-xs text-stone-400">{p.barcode ?? p.sku}</span></span>
              <span className="text-xs text-stone-500">{fmtMoney(p[priceField])}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
