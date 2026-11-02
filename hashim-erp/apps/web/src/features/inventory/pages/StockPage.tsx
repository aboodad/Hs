import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Boxes, Layers, Coins, AlertTriangle, PackageX, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useMainWarehouse } from '@/hooks/useLookups'
import { usePermission } from '@/hooks/usePermission'
import { useAuth } from '@/store/auth.store'
import { fmtMoney, fmtNum } from '@/lib/formatters'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatCard } from '@/components/shared/StatCard'
import { BranchSelect } from '@/components/shared/BranchSelect'
import { DataTable, type Column } from '@/components/data/DataTable'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Field'
import { Link } from 'react-router-dom'

/** المخزن الرئيسي (mode=main) أو مخزون الفروع (mode=branches) */
export function StockPage({ mode }: { mode: 'main' | 'branches' }) {
  const { data: main } = useMainWarehouse()
  const { seesAllBranches } = usePermission()
  const myBranch = useAuth((s) => s.profile?.branch_id) ?? ''
  const [branchId, setBranchId] = useState('')
  const [search, setSearch] = useState('')
  const [onlyLow, setOnlyLow] = useState(false)

  useEffect(() => {
    if (mode === 'main' && main) setBranchId(main.id)
    if (mode === 'branches' && !branchId) setBranchId(seesAllBranches ? '' : myBranch)
  }, [mode, main, seesAllBranches, myBranch]) // eslint-disable-line

  const { data, isLoading } = useQuery({
    queryKey: ['stock-status', branchId, mode],
    enabled: mode === 'main' ? !!branchId : true,
    queryFn: async () => {
      let q = supabase.from('v_stock_status').select('*').order('product_name').limit(1000)
      if (branchId) q = q.eq('branch_id', branchId)
      else if (mode === 'branches' && main) q = q.neq('branch_id', main.id)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const rows = (data ?? []).filter((r) =>
    (!search || `${r.product_name} ${r.barcode ?? ''} ${r.sku}`.toLowerCase().includes(search.toLowerCase())) && (!onlyLow || r.is_low || r.is_out))

  const totalQty = rows.reduce((s, r) => s + Number(r.qty_on_hand), 0)
  const totalVal = rows.reduce((s, r) => s + Number(r.stock_value), 0)

  const cols: Column<any>[] = [
    { key: 'product_name', header: 'المنتج', render: (r) => <Link className="font-semibold hover:text-brand-700" to={`/products/${r.product_id}/movements`}>{r.product_name}</Link> },
    ...(mode === 'branches' ? [{ key: 'branch_name', header: 'الفرع' } as Column<any>] : []),
    { key: 'barcode', header: 'الباركود', render: (r) => <span dir="ltr" className="text-xs">{r.barcode ?? '—'}</span> },
    { key: 'qty_on_hand', header: 'الكمية الحالية', render: (r) => <Badge tone={r.is_out ? 'red' : r.is_low ? 'amber' : 'green'}>{fmtNum(r.qty_on_hand)}</Badge> },
    { key: 'qty_reserved', header: 'محجوزة للتحويلات', render: (r) => fmtNum(r.qty_reserved) },
    { key: 'qty_available', header: 'المتاحة', render: (r) => <b>{fmtNum(r.qty_available)}</b> },
    { key: 'avg_cost', header: 'التكلفة', render: (r) => fmtMoney(r.avg_cost) },
    { key: 'stock_value', header: 'قيمة المخزون', render: (r) => fmtMoney(r.stock_value) },
  ]

  return (
    <>
      <PageHeader title={mode === 'main' ? 'المخزن الرئيسي' : 'مخزون الفروع'}
        actions={mode === 'branches' && seesAllBranches && <BranchSelect includeAll onlyBranches value={branchId} onChange={setBranchId} className="w-52" />} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="إجمالي المنتجات" value={fmtNum(rows.length)} icon={Boxes} />
        <StatCard label="إجمالي الكميات" value={fmtNum(totalQty)} icon={Layers} tone="blue" />
        <StatCard label="قيمة المخزون" value={fmtMoney(totalVal)} icon={Coins} tone="green" />
        <StatCard label="منخفضة / نافدة" value={`${rows.filter((r) => r.is_low).length} / ${rows.filter((r) => r.is_out).length}`} icon={AlertTriangle} tone="red" />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute start-3 top-2.5 h-4 w-4 text-stone-400" />
          <Input className="ps-9" placeholder="بحث..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /><PackageX className="h-4 w-4 text-red-500" /> المنخفضة والنافدة فقط</label>
      </div>
      <DataTable columns={cols} rows={rows} loading={isLoading} rowKey={(r) => `${r.branch_id}-${r.product_id}`} />
    </>
  )
}
export const MainWarehousePage = () => <StockPage mode="main" />
export const BranchStockPage = () => <StockPage mode="branches" />
