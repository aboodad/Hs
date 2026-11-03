import {
  LayoutDashboard, Package, Tags, Warehouse, Store, ClipboardList, Truck, ClipboardCheck, Trash2,
  Building2, ShoppingCart, FileText, Users, RotateCcw, Repeat, Clock, Wallet, Banknote, Landmark,
  Scale, Percent, TrendingUp, UserCog, BadgeDollarSign, Gift, BarChart3, GitBranch, ShieldCheck,
  KeyRound, ScrollText, Bell, Settings, Receipt, BadgePercent, BookOpen, BookCopy, ListTree, Calculator, FileBarChart, type LucideIcon,
} from 'lucide-react'

export interface NavItem { label: string; to: string; module: string; icon: LucideIcon }
export interface NavGroup { title: string; items: NavItem[] }

// نفس القائمة المقترحة في التحليل
export const NAV: NavGroup[] = [
  { title: 'الرئيسية', items: [{ label: 'لوحة التحكم', to: '/', module: 'dashboard', icon: LayoutDashboard }] },
  { title: 'المخزون', items: [
    { label: 'المنتجات', to: '/products', module: 'products', icon: Package },
    { label: 'التصنيفات', to: '/categories', module: 'categories', icon: Tags },
    { label: 'المخزن الرئيسي', to: '/inventory/main', module: 'inventory', icon: Warehouse },
    { label: 'مخزون الفروع', to: '/inventory/branches', module: 'inventory', icon: Store },
    { label: 'التسعيرة', to: '/pricing', module: 'pricing', icon: BadgePercent },
    { label: 'طلبات البضاعة', to: '/requests', module: 'requests', icon: ClipboardList },
    { label: 'التحويلات', to: '/transfers', module: 'transfers', icon: Truck },
    { label: 'الجرد', to: '/inventory/counts', module: 'stock_counts', icon: ClipboardCheck },
    { label: 'التالف', to: '/inventory/damaged', module: 'damaged', icon: Trash2 },
  ] },
  { title: 'المشتريات', items: [
    { label: 'الموردون', to: '/suppliers', module: 'suppliers', icon: Building2 },
    { label: 'فواتير المشتريات', to: '/purchases', module: 'purchases', icon: Receipt },
  ] },
  { title: 'المبيعات', items: [
    { label: 'نقطة البيع', to: '/pos', module: 'pos', icon: ShoppingCart },
    { label: 'الفواتير', to: '/sales', module: 'sales', icon: FileText },
    { label: 'العملاء', to: '/customers', module: 'customers', icon: Users },
    { label: 'المرتجعات', to: '/returns', module: 'returns', icon: RotateCcw },
    { label: 'الاستبدال', to: '/exchanges', module: 'exchanges', icon: Repeat },
    { label: 'الورديات', to: '/shifts', module: 'shifts', icon: Clock },
  ] },
  { title: 'المالية', items: [
    { label: 'المصروفات', to: '/expenses', module: 'expenses', icon: Wallet },
    { label: 'الإيرادات الأخرى', to: '/other-income', module: 'income', icon: Banknote },
    { label: 'الصندوق وطرق الدفع', to: '/cashbox', module: 'cashbox', icon: Landmark },
    { label: 'حسابات الفروع والتسويات', to: '/branch-accounts', module: 'branch_accounts', icon: Scale },
    { label: 'الضرائب', to: '/taxes', module: 'taxes', icon: Percent },
    { label: 'الأرباح والخسائر', to: '/profit-loss', module: 'profit_loss', icon: TrendingUp },
  ] },
  { title: 'المحاسبة', items: [
    { label: 'الدليل المحاسبي', to: '/accounting/chart', module: 'accounting', icon: ListTree },
    { label: 'القيود اليومية', to: '/accounting/journal', module: 'accounting', icon: BookOpen },
    { label: 'دفتر الأستاذ', to: '/accounting/ledger', module: 'accounting', icon: BookCopy },
    { label: 'ميزان المراجعة', to: '/accounting/trial-balance', module: 'accounting', icon: Calculator },
    { label: 'الميزانية العمومية', to: '/accounting/balance-sheet', module: 'accounting', icon: FileBarChart },
  ] },
  { title: 'الموظفون', items: [
    { label: 'الموظفون', to: '/employees', module: 'employees', icon: UserCog },
    { label: 'الرواتب', to: '/payroll', module: 'payroll', icon: BadgeDollarSign },
    { label: 'العمولات', to: '/commissions', module: 'commissions', icon: Gift },
  ] },
  { title: 'التقارير', items: [{ label: 'التقارير', to: '/reports', module: 'reports', icon: BarChart3 }] },
  { title: 'الإدارة', items: [
    { label: 'الفروع', to: '/branches', module: 'branches', icon: GitBranch },
    { label: 'المستخدمون', to: '/users', module: 'users', icon: ShieldCheck },
    { label: 'الأدوار والصلاحيات', to: '/roles', module: 'roles', icon: KeyRound },
    { label: 'سجل العمليات', to: '/audit-log', module: 'audit', icon: ScrollText },
    { label: 'الإشعارات', to: '/notifications', module: '*', icon: Bell },
    { label: 'الإعدادات', to: '/settings', module: 'settings', icon: Settings },
  ] },
]
