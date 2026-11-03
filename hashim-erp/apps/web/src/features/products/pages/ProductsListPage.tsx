import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Pencil, Barcode, History, Power } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errMsg } from '@/lib/errors'
import { toast } from '@/store/toast.store'
import { usePermission } from '@/hooks/usePermission'
import { useDebounce } from '@/hooks/useDebounce'
import { useCategories } from '@/hooks/useLookups'
import { fmtMoney, fmtNum } from '@/lib/formatters'
import { PageHeader } from '@/components/shared/PageHeader'
import { DataTable, type Column } from '@/components/data/DataTable'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Field'
import { BarcodePrintDialog } from '../components/BarcodePrintDialog'

export default function ProductsListPage() {
  const { can } = usePermission()
  const nav = useNavigate()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [barcodeFor, setBarcodeFor] = useState<any | null>(null)
  const dSearch = useDebounce(search.trim())
  const { data: cats } = useCategories()

  const { data, isLoading } = useQuery({
    queryKey: ['products', 'list', dSearch, category],
    queryFn: async () => {
      let q = supabase.from('products').select('*, category:categories(name), unit:units(name)').order('name').limit(300)
      if (category) q = q.eq('category_id', category)
      if (dSearch) q = q.or(`name.ilike.%${dSearch}%,barcode.ilike.%${dSearch}%,sku.ilike.%${dSearch}%`)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  // مجموع الكميات في المواقع المسموح بها
  const { data: stock } = useQuery({
    queryKey: ['products', 'stock-sum'],
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_balances').select('product_id,qty_on_hand')
      if (error) return {} as Record<string, number>
      const m: Record<string, number> = {}
      data?.forEach((r) => { m[r.product_id] = (m[r.product_id] ?? 0) + Number(r.qty_on_hand) })
      return m
    },
  })

  const toggle = async (p: any) => {
    const { error } = await supabase.from('products').update({ is_active: !p.is_active }).eq('id', p.id)
    if (error) return toast.error(errMsg(error))
    toast.success(p.is_active ? 'تم إيقاف المنتج' : 'تم تفعيل المنتج')
    qc.invalidateQueries({ queryKey: ['products'] })
  }

  const cols: Column<any>[] = [
    { key: 'image', header: '', className: 'w-14', render: (p) => p.image_url
        ? <img src={p.image_url} alt="" className="h-10 w-10 rounded object-cover" />
        : <div className="h-10 w-10 rounded bg-cream-200" /> },
    { key: 'name', header: 'المنتج', render: (p) => <div><div className="font-semibold">{p.name}</div><div className="text-xs text-stone-400">{p.sku}{p.size_label ? ` · ${p.size_label}` : ''}</div></div> },
    { key: 'barcode', header: 'الباركود', render: (p) => <span dir="ltr" className="text-xs">{p.barcode ?? '—'}</span> },
    { key: 'category', header: 'التصنيف', render: (p) => p.category?.name ?? '—' },
    { key: 'qty', header: 'الكمية', render: (p) => {
        const q = stock?.[p.id] ?? 0
        return <Badge tone={q <= 0 ? 'red' : q <= Number(p.min_stock) ? 'amber' : 'green'}>{fmtNum(q)}</Badge> } },
    { key: 'cost_price', header: 'الشراء', render: (p) => fmtMoney(p.cost_price) },
    { key: 'wholesale_price', header: 'الجملة', render: (p) => fmtMoney(p.wholesale_price) },
    { key: 'retail_price', header: 'البيع', render: (p) => <b>{fmtMoney(p.retail_price)}</b> },
    { key: 'is_active', header: 'الحالة', render: (p) => <Badge tone={p.is_active ? 'green' : 'gray'}>{p.is_active ? 'نشط' : 'موقوف'}</Badge> },
    { key: '_a', header: '', className: 'text-end', render: (p) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {can('products', 'update') && <Button size="sm" variant="ghost" title="تعديل" onClick={() => nav(`/products/${p.id}/edit`)}><Pencil className="h-4 w-4" /></Button>}
          <Button size="sm" variant="ghost" title="طباعة الباركود" disabled={!p.barcode} onClick={() => setBarcodeFor(p)}><Barcode className="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" title="حركة المنتج" onClick={() => nav(`/products/${p.id}/movements`)}><History className="h-4 w-4" /></Button>
          {can('products', 'update') && <Button size="sm" variant="ghost" title={p.is_active ? 'إيقاف' : 'تفعيل'} onClick={() => toggle(p)}><Power className={p.is_active ? 'h-4 w-4 text-red-500' : 'h-4 w-4 text-emerald-600'} /></Button>}
        </div>) },
  ]

  return (
    <>
      <PageHeader title="المنتجات" subtitle="إدارة منتجات هاشم للطيب والعطور"
        actions={can('products', 'create') && <Link to="/products/new"><Button><Plus className="h-4 w-4" /> إضافة منتج</Button></Link>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_220px]">
        <div className="relative"><Search className="pointer-events-none absolute start-3 top-2.5 h-4 w-4 text-stone-400" />
          <Input className="ps-9" placeholder="بحث بالاسم أو الباركود أو الرمز..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <Select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">كل التصنيفات</option>
          {cats?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </div>
      <DataTable columns={cols} rows={data} loading={isLoading} onRowClick={(p) => can('products', 'update') && nav(`/products/${p.id}/edit`)} />
      <BarcodePrintDialog product={barcodeFor} onClose={() => setBarcodeFor(null)} />
    </>
  )
}
