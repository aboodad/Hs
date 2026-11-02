import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import { ProtectedRoute } from './ProtectedRoute'
import { AuthLayout } from '@/layouts/AuthLayout'
import { MainLayout } from '@/layouts/MainLayout'
import { PosLayout } from '@/layouts/PosLayout'
import { Spinner } from '@/components/ui/Spinner'

// تحميل كسول لكل صفحة (يحسّن سرعة الإقلاع خاصة على الجوال)
const L = (loader: () => Promise<any>, name = 'default') =>
  lazy(() => loader().then((m) => ({ default: name === 'default' ? m.default : m[name] })))

// الدخول
const LoginPage = L(() => import('@/features/auth/pages/LoginPage'))
const ForgotPasswordPage = L(() => import('@/features/auth/pages/ForgotPasswordPage'))
const SetupPage = L(() => import('@/features/auth/pages/SetupPage'))
// الرئيسية
const DashboardPage = L(() => import('@/features/dashboard/pages/DashboardPage'))
// المخزون
const ProductsListPage = L(() => import('@/features/products/pages/ProductsListPage'))
const ProductFormPage = L(() => import('@/features/products/pages/ProductFormPage'))
const ProductMovementPage = L(() => import('@/features/products/pages/ProductMovementPage'))
const MainWarehousePage = L(() => import('@/features/inventory/pages/StockPage'), 'MainWarehousePage')
const BranchStockPage = L(() => import('@/features/inventory/pages/StockPage'), 'BranchStockPage')
const PricingPage = L(() => import('@/features/pricing/pages/PricingPage'))
const StockCountsPage = L(() => import('@/features/inventory/pages/StockCountsPage'))
const StockCountDetailPage = L(() => import('@/features/inventory/pages/StockCountDetailPage'))
const DamagedItemsPage = L(() => import('@/features/inventory/pages/DamagedItemsPage'))
const RequestsListPage = L(() => import('@/features/stock-requests/pages/RequestsListPage'))
const RequestFormPage = L(() => import('@/features/stock-requests/pages/RequestFormPage'))
const RequestDetailPage = L(() => import('@/features/stock-requests/pages/RequestDetailPage'))
const TransfersListPage = L(() => import('@/features/transfers/pages/TransfersListPage'))
const TransferDetailPage = L(() => import('@/features/transfers/pages/TransferDetailPage'))
// المشتريات
const SupplierDetailPage = L(() => import('@/features/suppliers/pages/SupplierDetailPage'))
const PurchasesListPage = L(() => import('@/features/purchases/pages/PurchasesListPage'))
const PurchaseFormPage = L(() => import('@/features/purchases/pages/PurchaseFormPage'))
const PurchaseReturnsPage = L(() => import('@/features/purchases/pages/PurchaseReturnsPage'))
// المبيعات
const PosPage = L(() => import('@/features/pos/pages/PosPage'))
const InvoicesListPage = L(() => import('@/features/sales/pages/InvoicesListPage'))
const InvoiceDetailPage = L(() => import('@/features/sales/pages/InvoiceDetailPage'))
const CustomerDetailPage = L(() => import('@/features/customers/pages/CustomerDetailPage'))
const ReturnsListPage = L(() => import('@/features/returns/pages/ReturnsListPage'))
const ExchangesListPage = L(() => import('@/features/exchanges/pages/ExchangesListPage'))
const ExchangeFormPage = L(() => import('@/features/exchanges/pages/ExchangeFormPage'))
const ShiftsListPage = L(() => import('@/features/shifts/pages/ShiftsListPage'))
// المالية
const ExpensesPage = L(() => import('@/features/expenses/pages/ExpensesPage'))
const OtherIncomePage = L(() => import('@/features/income/pages/OtherIncomePage'))
const CashboxPage = L(() => import('@/features/cashbox/pages/CashboxPage'))
const BranchAccountsPage = L(() => import('@/features/finance/pages/BranchAccountsPage'))
const ProfitLossPage = L(() => import('@/features/finance/pages/ProfitLossPage'))
const ChartOfAccountsPage = L(() => import('@/features/accounting/pages/ChartOfAccountsPage'))
const JournalPage = L(() => import('@/features/accounting/pages/JournalPage'))
const LedgerPage = L(() => import('@/features/accounting/pages/LedgerPage'))
const TrialBalancePage = L(() => import('@/features/accounting/pages/TrialBalancePage'))
const BalanceSheetPage = L(() => import('@/features/accounting/pages/BalanceSheetPage'))
// الموظفون
const EmployeeProfilePage = L(() => import('@/features/employees/pages/EmployeeProfilePage'))
const PayrollPage = L(() => import('@/features/payroll/pages/PayrollPage'))
const PayslipPage = L(() => import('@/features/payroll/pages/PayslipPage'))
const CommissionsPage = L(() => import('@/features/commissions/pages/CommissionsPage'))
// التقارير والإدارة
const ReportsHubPage = L(() => import('@/features/reports/pages/ReportsHubPage'))
const ReportViewerPage = L(() => import('@/features/reports/pages/ReportViewerPage'))
const BranchDetailPage = L(() => import('@/features/branches/pages/BranchDetailPage'))
const UsersPage = L(() => import('@/features/users/pages/UsersPage'))
const RolesPage = L(() => import('@/features/roles/pages/RolesPage'))
const AuditLogPage = L(() => import('@/features/audit/pages/AuditLogPage'))
const SettingsPage = L(() => import('@/features/settings/pages/SettingsPage'))
const NotificationsPage = L(() => import('@/features/notifications/pages/NotificationsPage'))
// صفحات CRUD المبنية على الإعداد
const CategoriesPage = L(() => import('@/features/lookups/pages/LookupPages'), 'CategoriesPage')
const SuppliersPage = L(() => import('@/features/lookups/pages/LookupPages'), 'SuppliersPage')
const CustomersPage = L(() => import('@/features/lookups/pages/LookupPages'), 'CustomersPage')
const TaxesPage = L(() => import('@/features/lookups/pages/LookupPages'), 'TaxesPage')
const EmployeesPage = L(() => import('@/features/lookups/pages/LookupPages'), 'EmployeesPage')
const BranchesPage = L(() => import('@/features/lookups/pages/LookupPages'), 'BranchesPage')

const w = (el: JSX.Element) => <Suspense fallback={<Spinner />}>{el}</Suspense>
// مسار محمي بصلاحية قسم: [path, module, element, action?]
const guarded = (path: string, module: string, el: JSX.Element, action = 'view') => ({
  path, element: <ProtectedRoute module={module} action={action} />, children: [{ index: true, element: w(el) }],
})

const router = createBrowserRouter([
  { element: <AuthLayout />, children: [
    { path: '/login', element: w(<LoginPage />) },
    { path: '/forgot-password', element: w(<ForgotPasswordPage />) },
    { path: '/setup', element: w(<SetupPage />) },
  ] },

  // نقطة البيع (تخطيط مستقل بملء الشاشة)
  { element: <ProtectedRoute module="pos" />, children: [{ element: <PosLayout />, children: [{ path: '/pos', element: w(<PosPage />) }] }] },

  { element: <ProtectedRoute />, children: [{ element: <MainLayout />, children: [
    guarded('/', 'dashboard', <DashboardPage />),

    // المخزون
    guarded('/products', 'products', <ProductsListPage />),
    guarded('/products/new', 'products', <ProductFormPage />, 'create'),
    guarded('/products/:id/edit', 'products', <ProductFormPage />, 'update'),
    guarded('/products/:id/movements', 'products', <ProductMovementPage />),
    guarded('/categories', 'categories', <CategoriesPage />),
    guarded('/inventory/main', 'inventory', <MainWarehousePage />),
    guarded('/inventory/branches', 'inventory', <BranchStockPage />),
    guarded('/pricing', 'pricing', <PricingPage />),
    guarded('/inventory/counts', 'stock_counts', <StockCountsPage />),
    guarded('/inventory/counts/:id', 'stock_counts', <StockCountDetailPage />),
    guarded('/inventory/damaged', 'damaged', <DamagedItemsPage />),
    guarded('/requests', 'requests', <RequestsListPage />),
    guarded('/requests/new', 'requests', <RequestFormPage />, 'create'),
    guarded('/requests/:id', 'requests', <RequestDetailPage />),
    guarded('/transfers', 'transfers', <TransfersListPage />),
    guarded('/transfers/:id', 'transfers', <TransferDetailPage />),

    // المشتريات
    guarded('/suppliers', 'suppliers', <SuppliersPage />),
    guarded('/suppliers/:id', 'suppliers', <SupplierDetailPage />),
    guarded('/purchases', 'purchases', <PurchasesListPage />),
    guarded('/purchases/new', 'purchases', <PurchaseFormPage />, 'create'),
    guarded('/purchases/returns', 'purchases', <PurchaseReturnsPage />),

    // المبيعات
    guarded('/sales', 'sales', <InvoicesListPage />),
    guarded('/sales/:id', 'sales', <InvoiceDetailPage />),
    guarded('/customers', 'customers', <CustomersPage />),
    guarded('/customers/:id', 'customers', <CustomerDetailPage />),
    guarded('/returns', 'returns', <ReturnsListPage />),
    guarded('/exchanges', 'exchanges', <ExchangesListPage />),
    guarded('/exchanges/new', 'exchanges', <ExchangeFormPage />, 'create'),
    guarded('/shifts', 'shifts', <ShiftsListPage />),

    // المالية
    guarded('/expenses', 'expenses', <ExpensesPage />),
    guarded('/other-income', 'income', <OtherIncomePage />),
    guarded('/cashbox', 'cashbox', <CashboxPage />),
    guarded('/branch-accounts', 'branch_accounts', <BranchAccountsPage />),
    guarded('/taxes', 'taxes', <TaxesPage />),
    guarded('/profit-loss', 'profit_loss', <ProfitLossPage />),
    guarded('/accounting/chart', 'accounting', <ChartOfAccountsPage />),
    guarded('/accounting/journal', 'accounting', <JournalPage />),
    guarded('/accounting/ledger', 'accounting', <LedgerPage />),
    guarded('/accounting/trial-balance', 'accounting', <TrialBalancePage />),
    guarded('/accounting/balance-sheet', 'accounting', <BalanceSheetPage />),

    // الموظفون
    guarded('/employees', 'employees', <EmployeesPage />),
    guarded('/employees/:id', 'employees', <EmployeeProfilePage />),
    guarded('/payroll', 'payroll', <PayrollPage />),
    guarded('/payroll/:id', 'payroll', <PayslipPage />),
    guarded('/commissions', 'commissions', <CommissionsPage />),

    // التقارير
    guarded('/reports', 'reports', <ReportsHubPage />),
    guarded('/reports/:code', 'reports', <ReportViewerPage />),

    // الإدارة
    guarded('/branches', 'branches', <BranchesPage />),
    guarded('/branches/:id', 'branches', <BranchDetailPage />),
    guarded('/users', 'users', <UsersPage />),
    guarded('/roles', 'roles', <RolesPage />),
    guarded('/audit-log', 'audit', <AuditLogPage />),
    guarded('/settings', 'settings', <SettingsPage />),
    { path: '/notifications', element: w(<NotificationsPage />) },
  ] }] },

  { path: '*', element: <Navigate to="/" replace /> },
])

export default function AppRouter() {
  return <RouterProvider router={router} />
}
