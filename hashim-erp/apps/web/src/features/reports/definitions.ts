import { supabase } from '@/lib/supabase'
import { sumBy } from '@/lib/formatters'

export interface ReportCtx { from: string; to: string; branch: string; supplier: string; customer: string }
export interface ReportCol { key: string; header: string; type?: 'money' | 'num' | 'date' | 'datetime'; value?: (r: any) => string | number | null }
export interface ReportDef {
  code: string; title: string; group: string; desc: string
  needs?: ('branch' | 'supplier' | 'customer')[]   // فلاتر إلزامية إضافية
  noDates?: boolean
  cols: ReportCol[]
  totals?: string[]                                  // أعمدة تُجمع في صف الإجمالي
  fetch: (c: ReportCtx) => Promise<any[]>
}

const ts = (c: ReportCtx) => ({ a: `${c.from}T00:00:00`, b: `${c.to}T23:59:59` })
const monthStart = (d: string) => d.slice(0, 7) + '-01'
const ok = <T,>(r: { data: T | null; error: any }) => { if (r.error) throw r.error; return (r.data ?? []) as any[] }

const branchNames = async () => {
  const { data } = await supabase.from('branches').select('id,name')
  return new Map((data ?? []).map((b: any) => [b.id, b.name]))
}

export const REPORTS: ReportDef[] = [
  // ───────────── المبيعات ─────────────
  { code: 'sales', title: 'تقرير المبيعات', group: 'المبيعات', desc: 'فواتير البيع بالتفصيل',
    totals: ['subtotal', 'discount', 'tax_amount', 'total'],
    cols: [{ key: 'invoice_no', header: 'رقم الفاتورة' }, { key: 'invoice_date', header: 'التاريخ', type: 'datetime' }, { key: 'branch', header: 'الفرع', value: (r) => r.branch?.name },
      { key: 'customer', header: 'العميل', value: (r) => r.customer?.name ?? 'نقدي' }, { key: 'seller', header: 'موظف البيع', value: (r) => r.seller?.full_name },
      { key: 'subtotal', header: 'الإجمالي', type: 'money' }, { key: 'discount', header: 'الخصم', type: 'money' }, { key: 'tax_amount', header: 'الضريبة', type: 'money' },
      { key: 'total', header: 'الصافي', type: 'money' }, { key: 'status', header: 'الحالة' }],
    fetch: async (c) => { const t = ts(c); let q = supabase.from('sales_invoices').select('*, branch:branches(name), customer:customers(name), seller:employees!sold_by(full_name)').gte('invoice_date', t.a).lte('invoice_date', t.b).neq('status', 'cancelled').order('invoice_date'); if (c.branch) q = q.eq('branch_id', c.branch); return ok(await q.limit(5000)) } },

  { code: 'returns', title: 'تقرير المرتجعات', group: 'المبيعات', desc: 'مرتجعات المبيعات وأسبابها',
    totals: ['refund_amount'],
    cols: [{ key: 'return_no', header: 'رقم المرتجع' }, { key: 'return_date', header: 'التاريخ', type: 'datetime' }, { key: 'invoice', header: 'الفاتورة الأصلية', value: (r) => r.invoice?.invoice_no },
      { key: 'branch', header: 'الفرع', value: (r) => r.branch?.name }, { key: 'customer', header: 'العميل', value: (r) => r.customer?.name ?? 'نقدي' },
      { key: 'reason', header: 'السبب' }, { key: 'refund_amount', header: 'المبلغ المسترد', type: 'money' }],
    fetch: async (c) => { const t = ts(c); let q = supabase.from('sales_returns').select('*, invoice:sales_invoices(invoice_no), branch:branches(name), customer:customers(name)').gte('return_date', t.a).lte('return_date', t.b).eq('status', 'posted').order('return_date'); if (c.branch) q = q.eq('branch_id', c.branch); return ok(await q.limit(5000)) } },

  { code: 'exchanges', title: 'تقرير الاستبدالات', group: 'المبيعات', desc: 'الاستبدالات وفروق الأسعار',
    totals: ['returned_total', 'new_total', 'difference'],
    cols: [{ key: 'exchange_no', header: 'رقم الاستبدال' }, { key: 'created_at', header: 'التاريخ', type: 'datetime' }, { key: 'invoice', header: 'الفاتورة الأصلية', value: (r) => r.invoice?.invoice_no },
      { key: 'branch', header: 'الفرع', value: (r) => r.branch?.name }, { key: 'returned_total', header: 'قيمة المرجَع', type: 'money' },
      { key: 'new_total', header: 'قيمة البديل', type: 'money' }, { key: 'difference', header: 'الفرق (+ على العميل)', type: 'money' }],
    fetch: async (c) => { const t = ts(c); let q = supabase.from('exchanges').select('*, invoice:sales_invoices!original_invoice_id(invoice_no), branch:branches(name)').gte('created_at', t.a).lte('created_at', t.b).eq('status', 'posted').order('created_at'); if (c.branch) q = q.eq('branch_id', c.branch); return ok(await q.limit(5000)) } },

  // ───────────── المشتريات ─────────────
  { code: 'purchases', title: 'تقرير المشتريات', group: 'المشتريات', desc: 'فواتير الشراء والمدفوع والمتبقي',
    totals: ['discount', 'tax_amount', 'total', 'paid_amount', 'remaining'],
    cols: [{ key: 'invoice_no', header: 'رقم الفاتورة' }, { key: 'invoice_date', header: 'التاريخ', type: 'date' }, { key: 'supplier', header: 'المورد', value: (r) => r.supplier?.name },
      { key: 'discount', header: 'الخصم', type: 'money' }, { key: 'tax_amount', header: 'الضريبة', type: 'money' }, { key: 'total', header: 'القيمة', type: 'money' },
      { key: 'paid_amount', header: 'المدفوع', type: 'money' }, { key: 'remaining', header: 'المتبقي', type: 'money' }, { key: 'payment_status', header: 'حالة الدفع' }],
    fetch: async (c) => { let q = supabase.from('purchase_invoices').select('*, supplier:suppliers(name)').gte('invoice_date', c.from).lte('invoice_date', c.to).eq('status', 'posted').order('invoice_date'); if (c.branch) q = q.eq('branch_id', c.branch); return ok(await q.limit(5000)) } },

  { code: 'supplier_statement', title: 'كشف حساب مورد', group: 'المشتريات', desc: 'فواتير ومدفوعات ومرتجعات المورد برصيد جارٍ', needs: ['supplier'], noDates: true,
    cols: [{ key: 'date', header: 'التاريخ', type: 'date' }, { key: 'desc', header: 'البيان' }, { key: 'debit', header: 'مدين (مشتريات)', type: 'money' }, { key: 'credit', header: 'دائن (مدفوع/مرتجع)', type: 'money' }, { key: 'balance', header: 'الرصيد', type: 'money' }],
    fetch: async (c) => {
      const [s, inv, pay, ret] = await Promise.all([
        supabase.from('suppliers').select('opening_balance').eq('id', c.supplier).single(),
        supabase.from('purchase_invoices').select('invoice_no,invoice_date,total').eq('supplier_id', c.supplier).eq('status', 'posted'),
        supabase.from('supplier_payments').select('paid_at,amount,ref_no').eq('supplier_id', c.supplier),
        supabase.from('purchase_returns').select('return_no,return_date,total').eq('supplier_id', c.supplier).eq('status', 'posted')])
      const ev: any[] = [
        ...(inv.data ?? []).map((r: any) => ({ date: r.invoice_date, desc: `فاتورة ${r.invoice_no}`, debit: Number(r.total), credit: 0 })),
        ...(pay.data ?? []).map((r: any) => ({ date: r.paid_at, desc: `دفعة ${r.ref_no ?? ''}`, debit: 0, credit: Number(r.amount) })),
        ...(ret.data ?? []).map((r: any) => ({ date: r.return_date, desc: `مرتجع ${r.return_no}`, debit: 0, credit: Number(r.total) }))]
      ev.sort((a, b) => String(a.date).localeCompare(String(b.date)))
      let bal = Number(s.data?.opening_balance ?? 0)
      return [{ date: null, desc: 'رصيد افتتاحي', debit: 0, credit: 0, balance: bal }, ...ev.map((e) => ({ ...e, balance: (bal += e.debit - e.credit) }))]
    } },

  { code: 'customer_statement', title: 'كشف حساب عميل', group: 'المبيعات', desc: 'فواتير العميل ومدفوعاته برصيد جارٍ', needs: ['customer'], noDates: true,
    cols: [{ key: 'date', header: 'التاريخ', type: 'date' }, { key: 'desc', header: 'البيان' }, { key: 'debit', header: 'مدين (فواتير)', type: 'money' }, { key: 'credit', header: 'دائن (مدفوع)', type: 'money' }, { key: 'balance', header: 'الرصيد المستحق', type: 'money' }],
    fetch: async (c) => {
      const [cu, inv, pay] = await Promise.all([
        supabase.from('customers').select('opening_balance').eq('id', c.customer).single(),
        supabase.from('sales_invoices').select('invoice_no,invoice_date,total,pays:sales_payments(amount)').eq('customer_id', c.customer).neq('status', 'cancelled'),
        supabase.from('customer_payments').select('paid_at,amount').eq('customer_id', c.customer)])
      const ev: any[] = []
      ;(inv.data ?? []).forEach((r: any) => {
        ev.push({ date: String(r.invoice_date).slice(0, 10), desc: `فاتورة ${r.invoice_no}`, debit: Number(r.total), credit: 0 })
        const paid = (r.pays ?? []).reduce((s: number, p: any) => s + Number(p.amount), 0)
        if (paid > 0) ev.push({ date: String(r.invoice_date).slice(0, 10), desc: `مدفوع عند البيع ${r.invoice_no}`, debit: 0, credit: paid })
      })
      ;(pay.data ?? []).forEach((r: any) => ev.push({ date: r.paid_at, desc: 'تحصيل', debit: 0, credit: Number(r.amount) }))
      ev.sort((a, b) => String(a.date).localeCompare(String(b.date)))
      let bal = Number(cu.data?.opening_balance ?? 0)
      return [{ date: null, desc: 'رصيد افتتاحي', debit: 0, credit: 0, balance: bal }, ...ev.map((e) => ({ ...e, balance: (bal += e.debit - e.credit) }))]
    } },

  // ───────────── المخزون ─────────────
  { code: 'inventory', title: 'تقرير المخزون', group: 'المخزون', desc: 'الأرصدة الحالية وقيمتها', noDates: true,
    totals: ['qty_on_hand', 'stock_value'],
    cols: [{ key: 'branch_name', header: 'الموقع' }, { key: 'product_name', header: 'المنتج' }, { key: 'barcode', header: 'الباركود' }, { key: 'qty_on_hand', header: 'الكمية', type: 'num' },
      { key: 'qty_reserved', header: 'محجوزة', type: 'num' }, { key: 'avg_cost', header: 'التكلفة', type: 'money' }, { key: 'stock_value', header: 'القيمة', type: 'money' },
      { key: 'state', header: 'الحالة', value: (r) => (r.is_out ? 'نافد' : r.is_low ? 'منخفض' : 'جيد') }],
    fetch: async (c) => { let q = supabase.from('v_stock_status').select('*').order('product_name'); if (c.branch) q = q.eq('branch_id', c.branch); return ok(await q.limit(5000)) } },

  { code: 'lots', title: 'تقرير دفعات التسعيرة', group: 'المخزون', desc: 'المخزون موزعاً حسب سعر الشراء لكل منتج', noDates: true,
    totals: ['qty_on_hand', 'value'],
    cols: [{ key: 'branch', header: 'الموقع', value: (r) => r.branch?.name }, { key: 'product', header: 'المنتج', value: (r) => r.product?.name }, { key: 'purchase_price', header: 'سعر الشراء', type: 'money' },
      { key: 'unit_cost', header: 'التكلفة الفعلية', type: 'money' }, { key: 'qty_on_hand', header: 'الكمية', type: 'num' }, { key: 'value', header: 'القيمة', type: 'money', value: (r) => Number(r.qty_on_hand) * Number(r.unit_cost) },
      { key: 'retail_price', header: 'سعر البيع', type: 'money', value: (r) => r.retail_price ?? r.product?.retail_price }, { key: 'first_received_at', header: 'أول توريد', type: 'date' }],
    fetch: async (c) => { let q = supabase.from('stock_layers').select('*, product:products(name,retail_price), branch:branches(name)').gt('qty_on_hand', 0).order('product_id'); if (c.branch) q = q.eq('branch_id', c.branch); return ok(await q.limit(5000)).map((r: any) => ({ ...r, value: Number(r.qty_on_hand) * Number(r.unit_cost) })) } },

  { code: 'movements', title: 'تقرير حركة المخزون', group: 'المخزون', desc: 'كل حركات الوارد والصادر',
    totals: ['qty_in', 'qty_out'],
    cols: [{ key: 'created_at', header: 'الوقت', type: 'datetime' }, { key: 'branch', header: 'الموقع', value: (r) => r.branch?.name }, { key: 'product', header: 'المنتج', value: (r) => r.product?.name },
      { key: 'movement_type', header: 'النوع' }, { key: 'qty_in', header: 'وارد', type: 'num' }, { key: 'qty_out', header: 'صادر', type: 'num' }, { key: 'unit_cost', header: 'التكلفة', type: 'money' }],
    fetch: async (c) => { const t = ts(c); let q = supabase.from('stock_movements').select('*, branch:branches(name), product:products(name)').gte('created_at', t.a).lte('created_at', t.b).order('created_at'); if (c.branch) q = q.eq('branch_id', c.branch); return ok(await q.limit(5000)) } },

  { code: 'transfers', title: 'تقرير تحويلات البضاعة', group: 'المخزون', desc: 'التحويلات بين المخزن والفروع',
    totals: ['total_wholesale_value'],
    cols: [{ key: 'transfer_no', header: 'رقم التحويل' }, { key: 'transfer_date', header: 'التاريخ', type: 'date' }, { key: 'from', header: 'من', value: (r) => r.from_b?.name }, { key: 'to', header: 'إلى', value: (r) => r.to_b?.name },
      { key: 'total_wholesale_value', header: 'القيمة (جملة)', type: 'money' }, { key: 'status', header: 'الحالة' }],
    fetch: async (c) => { let q = supabase.from('stock_transfers').select('*, from_b:branches!from_branch_id(name), to_b:branches!to_branch_id(name)').gte('transfer_date', c.from).lte('transfer_date', c.to).order('transfer_date'); if (c.branch) q = q.or(`from_branch_id.eq.${c.branch},to_branch_id.eq.${c.branch}`); return ok(await q.limit(5000)) } },

  { code: 'requests', title: 'تقرير طلبات الفروع', group: 'المخزون', desc: 'طلبات البضاعة وحالاتها ومن اعتمدها',
    cols: [{ key: 'request_no', header: 'رقم الطلب' }, { key: 'created_at', header: 'التاريخ', type: 'datetime' }, { key: 'branch', header: 'الفرع', value: (r) => r.branch?.name }, { key: 'items', header: 'الأصناف', type: 'num', value: (r) => r.items?.length ?? 0 },
      { key: 'status', header: 'الحالة' }, { key: 'creator', header: 'أنشأه', value: (r) => r.creator?.full_name }, { key: 'approver', header: 'اعتمده', value: (r) => r.approver?.full_name }],
    fetch: async (c) => { const t = ts(c); let q = supabase.from('stock_requests').select('*, branch:branches(name), items:stock_request_items(id), creator:profiles!created_by(full_name), approver:profiles!approved_by(full_name)').gte('created_at', t.a).lte('created_at', t.b).order('created_at'); if (c.branch) q = q.eq('branch_id', c.branch); return ok(await q.limit(5000)) } },

  { code: 'counts', title: 'تقرير الجرد', group: 'المخزون', desc: 'فروقات الجرد المعتمدة',
    totals: ['diff_qty', 'diff_value'],
    cols: [{ key: 'count_no', header: 'رقم الجرد', value: (r) => r.count?.count_no }, { key: 'branch', header: 'الموقع', value: (r) => r.count?.branch?.name }, { key: 'product', header: 'المنتج', value: (r) => r.product?.name },
      { key: 'system_qty', header: 'النظام', type: 'num' }, { key: 'actual_qty', header: 'الفعلي', type: 'num' }, { key: 'diff_qty', header: 'الفرق', type: 'num' }, { key: 'diff_value', header: 'قيمة الفرق', type: 'money' }, { key: 'reason', header: 'السبب' }],
    fetch: async (c) => { const t = ts(c); let q = supabase.from('stock_count_items').select('*, product:products(name), count:stock_counts!inner(count_no,branch_id,status,approved_at,branch:branches(name))').eq('count.status', 'approved').gte('count.approved_at', t.a).lte('count.approved_at', t.b).neq('diff_qty', 0); if (c.branch) q = q.eq('count.branch_id', c.branch); return ok(await q.limit(5000)) } },

  { code: 'damaged', title: 'تقرير التالف', group: 'المخزون', desc: 'المنتجات التالفة وقيمتها',
    totals: ['qty', 'total_value'],
    cols: [{ key: 'damaged_at', header: 'التاريخ', type: 'date' }, { key: 'branch', header: 'الموقع', value: (r) => r.branch?.name }, { key: 'product', header: 'المنتج', value: (r) => r.product?.name },
      { key: 'qty', header: 'الكمية', type: 'num' }, { key: 'reason', header: 'السبب' }, { key: 'source_type', header: 'المصدر' }, { key: 'total_value', header: 'القيمة', type: 'money' }],
    fetch: async (c) => { let q = supabase.from('damaged_items').select('*, branch:branches(name), product:products(name)').gte('damaged_at', c.from).lte('damaged_at', c.to).order('damaged_at'); if (c.branch) q = q.eq('branch_id', c.branch); return ok(await q.limit(5000)) } },

  // ───────────── المالية ─────────────
  { code: 'expenses', title: 'تقرير المصروفات', group: 'المالية', desc: 'المصروفات حسب النوع والفرع',
    totals: ['amount'],
    cols: [{ key: 'expense_date', header: 'التاريخ', type: 'date' }, { key: 'category', header: 'النوع', value: (r) => r.category?.name }, { key: 'branch', header: 'الفرع', value: (r) => r.branch?.name },
      { key: 'method', header: 'الطريقة', value: (r) => r.method?.name }, { key: 'description', header: 'الوصف' }, { key: 'amount', header: 'المبلغ', type: 'money' }],
    fetch: async (c) => { let q = supabase.from('expenses').select('*, category:expense_categories(name), branch:branches(name), method:payment_methods(name)').gte('expense_date', c.from).lte('expense_date', c.to).eq('status', 'posted').order('expense_date'); if (c.branch) q = q.eq('branch_id', c.branch); return ok(await q.limit(5000)) } },

  { code: 'tax', title: 'التقرير الضريبي', group: 'المالية', desc: 'ضريبة المبيعات والمشتريات وأثر المرتجعات لكل فرع',
    totals: ['sales_tax', 'returns_tax', 'purchases_tax', 'net_tax'],
    cols: [{ key: 'branch', header: 'الفرع' }, { key: 'sales_tax', header: 'ضريبة المبيعات', type: 'money' }, { key: 'returns_tax', header: 'ضريبة المرتجعات', type: 'money' },
      { key: 'purchases_tax', header: 'ضريبة المشتريات', type: 'money' }, { key: 'net_tax', header: 'الصافي المستحق', type: 'money' }],
    fetch: async (c) => {
      const t = ts(c); const names = await branchNames()
      const [s, p, r] = await Promise.all([
        supabase.from('sales_invoices').select('branch_id,tax_amount').gte('invoice_date', t.a).lte('invoice_date', t.b).neq('status', 'cancelled'),
        supabase.from('purchase_invoices').select('branch_id,tax_amount').gte('invoice_date', c.from).lte('invoice_date', c.to).eq('status', 'posted'),
        supabase.from('sales_return_items').select('refund_amount, item:sales_invoice_items(tax_rate), ret:sales_returns!inner(branch_id,return_date,status)').eq('ret.status', 'posted').gte('ret.return_date', t.a).lte('ret.return_date', t.b)])
      const m = new Map<string, any>()
      const row = (id: string) => { if (!m.has(id)) m.set(id, { branch: names.get(id) ?? '—', branch_id: id, sales_tax: 0, returns_tax: 0, purchases_tax: 0 }); return m.get(id) }
      ;(s.data ?? []).forEach((x: any) => (row(x.branch_id).sales_tax += Number(x.tax_amount)))
      ;(p.data ?? []).forEach((x: any) => (row(x.branch_id).purchases_tax += Number(x.tax_amount)))
      ;(r.data ?? []).forEach((x: any) => { const rate = Number(x.item?.tax_rate ?? 0); row(x.ret.branch_id).returns_tax += Number(x.refund_amount) - Number(x.refund_amount) / (1 + rate / 100) })
      return [...m.values()].filter((x) => !c.branch || x.branch_id === c.branch).map((x) => ({ ...x, net_tax: x.sales_tax - x.returns_tax - x.purchases_tax }))
    } },

  { code: 'pnl', title: 'تقرير الأرباح والخسائر', group: 'المالية', desc: 'أداء كل فرع (مجمّع على الفترة)',
    totals: ['gross_sales', 'discounts', 'returns_value', 'net_sales', 'cogs', 'gross_profit', 'total_expenses', 'other_income', 'net_profit'],
    cols: [{ key: 'branch', header: 'الفرع' }, { key: 'gross_sales', header: 'المبيعات', type: 'money' }, { key: 'discounts', header: 'الخصومات', type: 'money' }, { key: 'returns_value', header: 'المرتجعات', type: 'money' },
      { key: 'net_sales', header: 'صافي المبيعات', type: 'money' }, { key: 'cogs', header: 'تكلفة المباع', type: 'money' }, { key: 'gross_profit', header: 'الربح الإجمالي', type: 'money' },
      { key: 'total_expenses', header: 'المصروفات', type: 'money' }, { key: 'other_income', header: 'إيرادات أخرى', type: 'money' }, { key: 'net_profit', header: 'صافي الربح', type: 'money' }],
    fetch: async (c) => {
      const names = await branchNames()
      const ids = c.branch ? [c.branch] : [...names.keys()]
      const out: any[] = []
      for (const id of ids) {
        const rows = ok(await supabase.rpc('fn_income_statement', { p_from: c.from, p_to: c.to, p_branch: id }))
        const by = (p: string) => rows.filter((r: any) => r.account_code.startsWith(p)).reduce((s: number, r: any) => s + Number(r.amount), 0)
        const gross = by('4101'), disc = -by('4103'), ret = -by('4102'), net = by('41'), cogs = by('5'), exp = by('6'), oth = by('42')
        if (![gross, disc, ret, cogs, exp, oth].some(Boolean)) continue
        out.push({ branch: names.get(id) ?? '—', gross_sales: gross, discounts: disc, returns_value: ret, net_sales: net, cogs, gross_profit: net - cogs, total_expenses: exp, other_income: oth, net_profit: net - cogs - exp + oth })
      }
      return out
    } },

  { code: 'branch_performance', title: 'تقرير أداء الفروع', group: 'المالية', desc: 'مقارنة الفروع: مبيعات، فواتير، متوسط الفاتورة',
    totals: ['invoices', 'total'],
    cols: [{ key: 'branch', header: 'الفرع' }, { key: 'invoices', header: 'عدد الفواتير', type: 'num' }, { key: 'total', header: 'إجمالي المبيعات', type: 'money' }, { key: 'avg', header: 'متوسط الفاتورة', type: 'money' }, { key: 'share', header: 'الحصة %', type: 'num' }],
    fetch: async (c) => {
      const names = await branchNames()
      const rows = ok(await supabase.from('v_sales_daily').select('*').gte('day', c.from).lte('day', c.to))
      const m = new Map<string, any>(); rows.forEach((r: any) => { const a = m.get(r.branch_id) ?? { branch: names.get(r.branch_id) ?? '—', invoices: 0, total: 0 }; a.invoices += Number(r.invoices_count); a.total += Number(r.total); m.set(r.branch_id, a) })
      const all = [...m.values()]; const tot = sumBy(all, 'total') || 1
      return all.map((a) => ({ ...a, avg: a.invoices ? a.total / a.invoices : 0, share: Math.round((a.total / tot) * 1000) / 10 }))
    } },

  { code: 'branch_statement', title: 'كشف حساب الفرع', group: 'المالية', desc: 'الحساب الجاري للفرع مع الإدارة', needs: ['branch'],
    cols: [{ key: 'entry_date', header: 'التاريخ', type: 'date' }, { key: 'desc', header: 'البيان' }, { key: 'debit', header: 'عليه', type: 'money' }, { key: 'credit', header: 'له', type: 'money' }, { key: 'balance', header: 'الرصيد', type: 'money' }],
    fetch: async (c) => {
      const rows = ok(await supabase.from('branch_ledger').select('*').eq('branch_id', c.branch).order('entry_date').order('id'))
      const label: any = { goods_received: 'بضاعة مستلمة', goods_returned: 'بضاعة مرتجعة', settlement: 'تسوية', adjustment: 'تعديل' }
      let bal = 0
      return rows.map((r: any) => ({ ...r, desc: label[r.entry_type], balance: (bal += Number(r.debit) - Number(r.credit)) })).filter((r: any) => r.entry_date >= c.from && r.entry_date <= c.to)
    } },

  // ───────────── الموظفون ─────────────
  { code: 'employees', title: 'تقرير الموظفين', group: 'الموظفون', desc: 'مبيعات كل موظف في الفترة',
    totals: ['invoices', 'total'],
    cols: [{ key: 'name', header: 'الموظف' }, { key: 'branch', header: 'الفرع' }, { key: 'invoices', header: 'عدد الفواتير', type: 'num' }, { key: 'total', header: 'إجمالي المبيعات', type: 'money' }],
    fetch: async (c) => {
      const names = await branchNames()
      let q = supabase.from('v_sales_by_employee').select('*').gte('month', monthStart(c.from)).lte('month', c.to); if (c.branch) q = q.eq('branch_id', c.branch)
      const m = new Map<string, any>()
      ok(await q).forEach((r: any) => { const k = String(r.employee_id); const a = m.get(k) ?? { name: r.full_name ?? '—', branch: names.get(r.branch_id) ?? '—', invoices: 0, total: 0 }; a.invoices += Number(r.invoices_count); a.total += Number(r.total_sales); m.set(k, a) })
      return [...m.values()].sort((a, b) => b.total - a.total)
    } },

  { code: 'commissions', title: 'تقرير العمولات', group: 'الموظفون', desc: 'عمولات موظفي المبيعات حسب الفترات',
    totals: ['total_sales', 'eligible_sales', 'amount'],
    cols: [{ key: 'period', header: 'الفترة', value: (r) => `${r.period?.month}/${r.period?.year}` }, { key: 'employee', header: 'الموظف', value: (r) => r.employee?.full_name }, { key: 'branch', header: 'الفرع', value: (r) => r.branch?.name },
      { key: 'total_sales', header: 'إجمالي مبيعاته', type: 'money' }, { key: 'eligible_sales', header: 'المحتسب', type: 'money' }, { key: 'rate', header: 'النسبة %', type: 'num' }, { key: 'amount', header: 'العمولة', type: 'money' }, { key: 'status', header: 'الحالة' }],
    fetch: async (c) => {
      let q = supabase.from('commissions').select('*, period:payroll_periods(year,month), employee:employees(full_name), branch:branches(name)'); if (c.branch) q = q.eq('branch_id', c.branch)
      const f = c.from.slice(0, 7), t = c.to.slice(0, 7)
      return ok(await q).filter((r: any) => { const k = `${r.period.year}-${String(r.period.month).padStart(2, '0')}`; return k >= f && k <= t })
    } },

  { code: 'payroll', title: 'تقرير الرواتب', group: 'الموظفون', desc: 'كشوف الرواتب حسب الفترات',
    totals: ['base_salary', 'commission_amount', 'bonuses', 'deductions', 'advances', 'net_salary'],
    cols: [{ key: 'period', header: 'الفترة', value: (r) => `${r.period?.month}/${r.period?.year}` }, { key: 'employee', header: 'الموظف', value: (r) => r.employee?.full_name }, { key: 'branch', header: 'الفرع', value: (r) => r.branch?.name },
      { key: 'base_salary', header: 'الأساسي', type: 'money' }, { key: 'commission_amount', header: 'العمولة', type: 'money' }, { key: 'bonuses', header: 'مكافآت', type: 'money' },
      { key: 'deductions', header: 'خصومات', type: 'money' }, { key: 'advances', header: 'سلف', type: 'money' }, { key: 'net_salary', header: 'الصافي', type: 'money' }, { key: 'status', header: 'الحالة' }],
    fetch: async (c) => {
      let q = supabase.from('payrolls').select('*, period:payroll_periods(year,month), employee:employees(full_name), branch:branches(name)'); if (c.branch) q = q.eq('branch_id', c.branch)
      const f = c.from.slice(0, 7), t = c.to.slice(0, 7)
      return ok(await q).filter((r: any) => { const k = `${r.period.year}-${String(r.period.month).padStart(2, '0')}`; return k >= f && k <= t })
    } },
]

export const REPORT_GROUPS = ['المبيعات', 'المشتريات', 'المخزون', 'المالية', 'الموظفون']
