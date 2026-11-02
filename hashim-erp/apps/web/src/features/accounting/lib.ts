// أنواع ومساعدات المحاسبة (مشتركة بين كل صفحات القسم)
export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'

export interface Account {
  id: string; code: string; name: string; account_type: AccountType
  parent_id: string | null; is_group: boolean; is_system: boolean; is_active: boolean; note?: string | null
}
export interface AccountNode extends Account { children: AccountNode[]; depth: number }

export const TYPE_LABEL: Record<AccountType, string> = {
  asset: 'أصول', liability: 'خصوم', equity: 'حقوق ملكية', revenue: 'إيرادات', expense: 'مصروفات',
}
/** الأصول والمصروفات رصيدها الطبيعي مدين؛ الباقي دائن */
export const isDebitNormal = (t: AccountType) => t === 'asset' || t === 'expense'

/** يبني الشجرة مرتبة بالرمز */
export function buildTree(accounts: Account[]): AccountNode[] {
  const map = new Map<string, AccountNode>(accounts.map((a) => [a.id, { ...a, children: [], depth: 0 }]))
  const roots: AccountNode[] = []
  const sorted = [...map.values()].sort((a, b) => a.code.localeCompare(b.code))
  sorted.forEach((n) => {
    const p = n.parent_id ? map.get(n.parent_id) : undefined
    if (p) p.children.push(n); else roots.push(n)
  })
  const setDepth = (n: AccountNode, d: number) => { n.depth = d; n.children.forEach((c) => setDepth(c, d + 1)) }
  roots.forEach((r) => setDepth(r, 0))
  return roots
}
export const flatten = (nodes: AccountNode[]): AccountNode[] => nodes.flatMap((n) => [n, ...flatten(n.children)])

/** يجمع قيمة كل حساب رئيسي من فروعه */
export function rollup(nodes: AccountNode[], get: (id: string) => number): Map<string, number> {
  const out = new Map<string, number>()
  const walk = (n: AccountNode): number => {
    const v = n.is_group ? n.children.reduce((s, c) => s + walk(c), 0) : get(n.id)
    out.set(n.id, v); return v
  }
  nodes.forEach(walk)
  return out
}

/** مصدر القيد التلقائي: تسمية ورابط المستند الأصلي */
export const SOURCE_LABEL: Record<string, string> = {
  sales_invoices: 'فاتورة بيع', customer_payments: 'تحصيل عميل', sales_returns: 'مرتجع مبيعات', exchanges: 'استبدال',
  purchase_invoices: 'فاتورة شراء', supplier_payments: 'دفعة مورد', purchase_returns: 'مرتجع مشتريات',
  expenses: 'مصروف', other_incomes: 'إيراد آخر', damaged_items: 'تالف', stock_counts: 'جرد', stock_transfers: 'تحويل',
  shifts: 'فرق وردية', branch_settlements: 'تسوية فرع', payrolls: 'راتب', employee_adjustments: 'سلفة موظف',
  customers: 'رصيد افتتاحي', suppliers: 'رصيد افتتاحي', stock_movements: 'مخزون أول المدة',
}
export const sourceLink = (type?: string | null, id?: string | null): string | null => {
  if (!type || !id) return null
  switch (type) {
    case 'sales_invoices': return `/sales/${id}`
    case 'stock_transfers': return `/transfers/${id}`
    case 'payrolls': return `/payroll/${id}`
    case 'customers': return `/customers/${id}`
    case 'suppliers': return `/suppliers/${id}`
    case 'purchase_invoices': case 'purchase_returns': case 'supplier_payments': return '/purchases'
    case 'expenses': return '/expenses'
    case 'other_incomes': return '/other-income'
    case 'branch_settlements': return '/branch-accounts'
    case 'stock_counts': return '/inventory/counts'
    case 'damaged_items': return '/inventory/damaged'
    case 'shifts': return '/shifts'
    case 'sales_returns': return '/returns'
    case 'exchanges': return '/exchanges'
    default: return null
  }
}
