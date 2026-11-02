// صفحات CRUD مبنية على CrudPage (إعداد فقط بدون تكرار كود)
import { CrudPage } from '@/components/shared/CrudPage'
import { fmtMoney } from '@/lib/formatters'
import { Badge } from '@/components/ui/Badge'

const active = { name: 'is_active', label: 'نشط', type: 'checkbox' as const }

export function CategoriesPage() {
  return <CrudPage title="التصنيفات" table="categories" module="categories" orderBy="sort_order" ascending
    columns={[{ key: 'name', label: 'التصنيف' }, { key: 'sort_order', label: 'الترتيب' }, { key: 'is_active', label: 'الحالة' }]}
    fields={[{ name: 'name', label: 'اسم التصنيف', required: true }, { name: 'sort_order', label: 'الترتيب', type: 'number', default: 0 }, active]} />
}

export function SuppliersPage() {
  return <CrudPage title="الموردون" table="suppliers" module="suppliers" searchKeys={['name', 'phone']} rowLink={(r) => `/suppliers/${r.id}`}
    columns={[{ key: 'name', label: 'المورد' }, { key: 'phone', label: 'الهاتف' }, { key: 'opening_balance', label: 'رصيد افتتاحي', render: (r) => fmtMoney(r.opening_balance) }, { key: 'is_active', label: 'الحالة' }]}
    fields={[{ name: 'name', label: 'اسم المورد', required: true }, { name: 'phone', label: 'الهاتف' }, { name: 'address', label: 'العنوان' },
      { name: 'tax_number', label: 'الرقم الضريبي' }, { name: 'opening_balance', label: 'رصيد افتتاحي', type: 'number', default: 0 }, active]} />
}

export function CustomersPage() {
  return <CrudPage title="العملاء" table="customers" module="customers" searchKeys={['name', 'phone']} rowLink={(r) => `/customers/${r.id}`}
    columns={[{ key: 'name', label: 'العميل' }, { key: 'phone', label: 'الهاتف' }, { key: 'opening_balance', label: 'رصيد افتتاحي', render: (r) => fmtMoney(r.opening_balance) }, { key: 'is_active', label: 'الحالة' }]}
    fields={[{ name: 'name', label: 'اسم العميل', required: true }, { name: 'phone', label: 'الهاتف' }, { name: 'address', label: 'العنوان' },
      { name: 'opening_balance', label: 'رصيد افتتاحي', type: 'number', default: 0 }, { name: 'notes', label: 'ملاحظات', type: 'textarea' }, active]} />
}

export function PaymentMethodsPage() {
  const types = [{ value: 'cash', label: 'نقدي' }, { value: 'transfer', label: 'تحويل' }, { value: 'bank', label: 'حساب بنكي' }, { value: 'other', label: 'أخرى' }]
  return <CrudPage title="طرق الدفع" table="payment_methods" module="cashbox"
    columns={[{ key: 'name', label: 'الاسم' }, { key: 'type', label: 'النوع', render: (r) => types.find((t) => t.value === r.type)?.label }, { key: 'is_cash', label: 'يدخل الصندوق', render: (r) => <Badge tone={r.is_cash ? 'green' : 'gray'}>{r.is_cash ? 'نعم' : 'لا'}</Badge> }, { key: 'is_active', label: 'الحالة' }]}
    fields={[{ name: 'name', label: 'الاسم', required: true }, { name: 'type', label: 'النوع', type: 'select', options: types, required: true, default: 'cash' },
      { name: 'account_info', label: 'بيانات الحساب' },
      { name: 'account_id', label: 'الحساب المحاسبي', type: 'select', optionsFrom: { table: 'accounts', filter: { account_type: 'asset', is_group: false } } }, { name: 'is_cash', label: 'نقدي (يدخل رصيد الصندوق)', type: 'checkbox', default: false }, active]} />
}

export function UnitsPage() {
  return <CrudPage title="وحدات المنتجات" table="units" module="settings"
    columns={[{ key: 'name', label: 'الوحدة' }, { key: 'abbreviation', label: 'الاختصار' }, { key: 'is_active', label: 'الحالة' }]}
    fields={[{ name: 'name', label: 'الاسم', required: true }, { name: 'abbreviation', label: 'الاختصار' }, active]} />
}

export function TaxesPage() {
  return <CrudPage title="نسب الضرائب" table="tax_rates" module="taxes"
    columns={[{ key: 'name', label: 'الاسم' }, { key: 'rate', label: 'النسبة %' }, { key: 'applies_to', label: 'تنطبق على', render: (r) => ({ sales: 'المبيعات', purchases: 'المشتريات', both: 'الكل' } as any)[r.applies_to] }, { key: 'is_active', label: 'الحالة' }]}
    fields={[{ name: 'name', label: 'الاسم', required: true }, { name: 'rate', label: 'النسبة %', type: 'number', required: true },
      { name: 'applies_to', label: 'تنطبق على', type: 'select', default: 'both', options: [{ value: 'sales', label: 'المبيعات' }, { value: 'purchases', label: 'المشتريات' }, { value: 'both', label: 'الكل' }] }, active]} />
}

export function EmployeesPage() {
  return <CrudPage title="الموظفون" table="employees" module="employees" select="*, branch:branches!branch_id(name)" searchKeys={['full_name', 'phone']} rowLink={(r) => `/employees/${r.id}`}
    columns={[{ key: 'full_name', label: 'الاسم' }, { key: 'branch', label: 'الفرع', render: (r) => r.branch?.name }, { key: 'job_title', label: 'الوظيفة' },
      { key: 'base_salary', label: 'الراتب', render: (r) => fmtMoney(r.base_salary) }, { key: 'commission_rate', label: 'العمولة %' },
      { key: 'status', label: 'الحالة', render: (r) => <Badge tone={r.status === 'active' ? 'green' : 'red'}>{({ active: 'نشط', suspended: 'موقوف', terminated: 'منتهي' } as any)[r.status]}</Badge> }]}
    fields={[{ name: 'full_name', label: 'الاسم', required: true }, { name: 'branch_id', label: 'الفرع', type: 'select', required: true, optionsFrom: { table: 'branches' } },
      { name: 'job_title', label: 'الوظيفة' }, { name: 'phone', label: 'الهاتف' }, { name: 'national_id', label: 'الهوية' }, { name: 'hire_date', label: 'تاريخ التعيين', type: 'date' },
      { name: 'base_salary', label: 'الراتب الأساسي', type: 'number', default: 0 }, { name: 'commission_rate', label: 'نسبة العمولة %', type: 'number', default: 0 },
      { name: 'status', label: 'الحالة', type: 'select', default: 'active', options: [{ value: 'active', label: 'نشط' }, { value: 'suspended', label: 'موقوف' }, { value: 'terminated', label: 'منتهي' }] }]} />
}

export function BranchesPage() {
  return <CrudPage title="الفروع" table="branches" module="branches" select="*, parent:branches!parent_branch_id(name)" orderBy="name" ascending searchKeys={['name', 'code']} rowLink={(r) => `/branches/${r.id}`}
    columns={[{ key: 'code', label: 'الرمز' }, { key: 'name', label: 'الفرع' }, { key: 'type', label: 'النوع', render: (r) => (r.type === 'main_warehouse' ? 'مخزن رئيسي' : r.is_kiosk ? 'كشك' : 'فرع') }, { key: 'parent', label: 'يتبع فرع', render: (r) => r.parent?.name ?? '—' }, { key: 'phone', label: 'الهاتف' }, { key: 'is_active', label: 'الحالة' }]}
    fields={[{ name: 'code', label: 'الرمز', required: true }, { name: 'name', label: 'الاسم', required: true },
      { name: 'is_kiosk', label: 'هذا كشك (نقطة بيع متنقلة)', type: 'checkbox', default: false },
      { name: 'parent_branch_id', label: 'الفرع التابع له (للكشك فقط)', type: 'select', optionsFrom: { table: 'branches', filter: { type: 'branch', is_kiosk: false } } },
      { name: 'location_note', label: 'موقع الكشك (مهرجان / مول)' },
      { name: 'manager_id', label: 'المدير', type: 'select', optionsFrom: { table: 'employees', label: 'full_name' } },
      { name: 'phone', label: 'الهاتف' }, { name: 'address', label: 'العنوان' }, active]} />
}
