import { Building2, Calculator, ShieldCheck, ShoppingCart, Store, Tent, Warehouse, type LucideIcon } from 'lucide-react'

export interface RoleCard {
  code: string
  name: string
  desc: string
  icon: LucideIcon
  landing: string // الصفحة التي يُوجَّه إليها بعد الدخول
}

// الأدوار المعتمدة في التحليل (نفس رموز جدول roles في قاعدة البيانات)
export const ROLE_CARDS: RoleCard[] = [
  { code: 'super_admin', name: 'مدير النظام', desc: 'صلاحيات كاملة', icon: ShieldCheck, landing: '/' },
  { code: 'head_office', name: 'الإدارة الرئيسية', desc: 'كل الفروع والمخزن', icon: Building2, landing: '/' },
  { code: 'accountant', name: 'المحاسب', desc: 'المالية والتقارير', icon: Calculator, landing: '/profit-loss' },
  { code: 'warehouse_manager', name: 'مدير المخزن', desc: 'المخزون والتحويلات', icon: Warehouse, landing: '/inventory/main' },
  { code: 'branch_manager', name: 'مدير الفرع', desc: 'إدارة فرع', icon: Store, landing: '/' },
  { code: 'sales_staff', name: 'موظف المبيعات', desc: 'نقطة البيع', icon: ShoppingCart, landing: '/pos' },
  { code: 'kiosk', name: 'كشك / نقطة بيع', desc: 'مهرجانات ومولات', icon: Tent, landing: '/pos' },
]

export const landingFor = (roleCode?: string) => ROLE_CARDS.find((r) => r.code === roleCode)?.landing ?? '/'
