import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { PageHeader } from '@/components/shared/PageHeader'
import { DataTable, type Column } from '@/components/data/DataTable'
import { fmtDateTime, fmtNum } from '@/lib/formatters'

const TYPES: Record<string, string> = {
  opening: 'رصيد افتتاحي', purchase: 'شراء', purchase_return: 'مرتجع شراء', sale: 'بيع', sale_return: 'مرتجع بيع',
  transfer_out: 'تحويل صادر', transfer_in: 'تحويل وارد', count_adjustment: 'تسوية جرد', damage: 'تالف',
  exchange_in: 'استبدال (وارد)', exchange_out: 'استبدال (صادر)', adjustment: 'تعديل',
}

export default function ProductMovementPage() {
  const { id } = useParams()
  const { data: product } = useQuery({
    queryKey: ['product', id],
    queryFn: async () => (await supabase.from('products').select('name,sku').eq('id', id!).single()).data,
  })
  const { data, isLoading } = useQuery({
    queryKey: ['product-movements', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_movements').select('*, branch:branches(name)')
        .eq('product_id', id!).order('created_at', { ascending: false }).limit(200)
      if (error) throw error
      return data ?? []
    },
  })
  const cols: Column<any>[] = [
    { key: 'created_at', header: 'التاريخ', render: (r) => fmtDateTime(r.created_at) },
    { key: 'branch', header: 'الموقع', render: (r) => r.branch?.name },
    { key: 'movement_type', header: 'نوع الحركة', render: (r) => TYPES[r.movement_type] ?? r.movement_type },
    { key: 'qty_in', header: 'وارد', render: (r) => (Number(r.qty_in) ? <span className="text-emerald-700">+{fmtNum(r.qty_in)}</span> : '—') },
    { key: 'qty_out', header: 'صادر', render: (r) => (Number(r.qty_out) ? <span className="text-red-600">-{fmtNum(r.qty_out)}</span> : '—') },
    { key: 'unit_cost', header: 'التكلفة', render: (r) => fmtNum(r.unit_cost) },
    { key: 'note', header: 'ملاحظة', render: (r) => r.note ?? '' },
  ]
  return (
    <>
      <PageHeader title={`حركة المنتج: ${product?.name ?? ''}`} subtitle={product?.sku}
        actions={<Link to="/products" className="btn border border-stone-300 bg-white text-stone-700"><ArrowRight className="h-4 w-4" /> رجوع</Link>} />
      <DataTable columns={cols} rows={data} loading={isLoading} />
    </>
  )
}
