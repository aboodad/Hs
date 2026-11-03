import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Eye } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { fmtDateTime, toISODate } from '@/lib/formatters'
import { PageHeader } from '@/components/shared/PageHeader'
import { DataTable, type Column } from '@/components/data/DataTable'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Field'

const ACTION: Record<string, [string, any]> = { insert: ['إضافة', 'green'], update: ['تعديل', 'amber'], delete: ['حذف', 'red'] }
const TABLES: Record<string, string> = {
  sales_invoices: 'فواتير المبيعات', purchase_invoices: 'فواتير المشتريات', stock_transfers: 'التحويلات', stock_requests: 'طلبات البضاعة', stock_counts: 'الجرد', expenses: 'المصروفات',
  other_incomes: 'الإيرادات', branch_settlements: 'التسويات', payrolls: 'الرواتب', employee_adjustments: 'حركات الموظفين', employees: 'الموظفون', profiles: 'المستخدمون',
  role_permissions: 'صلاحيات الأدوار', roles: 'الأدوار', products: 'المنتجات', sales_returns: 'المرتجعات', exchanges: 'الاستبدال', damaged_items: 'التالف', settings: 'الإعدادات', stock_layers: 'تسعيرة الدفعات', shifts: 'الورديات', customers: 'العملاء', suppliers: 'الموردون',
}

const changed = (o: any, n: any) => {
  const keys = new Set([...Object.keys(o ?? {}), ...Object.keys(n ?? {}), ])
  return [...keys].filter((k) => !['updated_at'].includes(k) && JSON.stringify(o?.[k]) !== JSON.stringify(n?.[k]))
}

export default function AuditLogPage() {
  const [from, setFrom] = useState(toISODate(new Date(Date.now() - 6 * 86400000)))
  const [to, setTo] = useState(toISODate(new Date()))
  const [table, setTable] = useState('')
  const [action, setAction] = useState('')
  const [sel, setSel] = useState<any | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['audit', from, to, table, action],
    queryFn: async () => {
      let q = supabase.from('audit_logs').select('*').gte('created_at', `${from}T00:00:00`).lte('created_at', `${to}T23:59:59`).order('created_at', { ascending: false }).limit(300)
      if (table) q = q.eq('table_name', table)
      if (action) q = q.eq('action', action)
      const { data, error } = await q
      if (error) throw error
      // أسماء المستخدمين (audit_logs بلا FK عمداً)
      const ids = [...new Set((data ?? []).map((r) => r.user_id).filter(Boolean))]
      const names = new Map<string, string>()
      if (ids.length) (await supabase.from('profiles').select('id,full_name').in('id', ids)).data?.forEach((p: any) => names.set(p.id, p.full_name))
      return (data ?? []).map((r) => ({ ...r, user_name: r.user_id ? names.get(r.user_id) ?? '—' : 'النظام' }))
    },
  })

  const cols: Column<any>[] = [
    { key: 'created_at', header: 'التاريخ والوقت', render: (r) => fmtDateTime(r.created_at) },
    { key: 'user_name', header: 'المستخدم', render: (r) => <b>{r.user_name}</b> },
    { key: 'table_name', header: 'القسم', render: (r) => TABLES[r.table_name] ?? r.table_name },
    { key: 'action', header: 'العملية', render: (r) => <Badge tone={ACTION[r.action]?.[1]}>{ACTION[r.action]?.[0] ?? r.action}</Badge> },
    { key: 'sum', header: 'الحقول المتغيرة', render: (r) => (r.action === 'update' ? changed(r.old_data, r.new_data).slice(0, 4).join('، ') : '—') },
    { key: '_a', header: '', render: (r) => <Button size="sm" variant="ghost" onClick={() => setSel(r)}><Eye className="h-4 w-4" /></Button> },
  ]

  return (
    <>
      <PageHeader title="سجل العمليات" subtitle="الإجراءات الحساسة: من فعل ماذا ومتى" />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <Select value={table} onChange={(e) => setTable(e.target.value)}><option value="">كل الأقسام</option>{Object.entries(TABLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <Select value={action} onChange={(e) => setAction(e.target.value)}><option value="">كل العمليات</option>{Object.entries(ACTION).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</Select>
      </div>
      <DataTable columns={cols} rows={data} loading={isLoading} onRowClick={setSel} />

      <Modal open={!!sel} onClose={() => setSel(null)} title="تفاصيل العملية" size="lg">
        {sel && (<div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-2"><div><span className="text-brand-300">المستخدم: </span><b>{sel.user_name}</b></div><div><span className="text-brand-300">الوقت: </span>{fmtDateTime(sel.created_at)}</div>
            <div><span className="text-brand-300">القسم: </span>{TABLES[sel.table_name] ?? sel.table_name}</div><div><span className="text-brand-300">العملية: </span>{ACTION[sel.action]?.[0]}</div></div>
          {sel.action === 'update' ? (
            <table className="w-full"><thead className="bg-cream-200 text-xs"><tr><th className="p-2 text-start">الحقل</th><th className="p-2 text-start">قبل</th><th className="p-2 text-start">بعد</th></tr></thead>
              <tbody className="divide-y divide-cream-200">{changed(sel.old_data, sel.new_data).map((k) => (
                <tr key={k}><td className="p-2 font-semibold" dir="ltr">{k}</td><td className="p-2 text-red-700" dir="ltr">{JSON.stringify(sel.old_data?.[k])}</td><td className="p-2 text-emerald-700" dir="ltr">{JSON.stringify(sel.new_data?.[k])}</td></tr>))}</tbody></table>
          ) : (
            <pre dir="ltr" className="max-h-80 overflow-auto rounded-xl bg-cream-100 p-3 text-xs">{JSON.stringify(sel.new_data ?? sel.old_data, null, 2)}</pre>
          )}
        </div>)}
      </Modal>
    </>
  )
}
