-- =====================================================================
--  نظام إدارة هاشم للطيب والعطور  |  Hashim Perfumes ERP
--  مخطط قاعدة البيانات الكامل لـ Supabase (PostgreSQL 15+)
--  شغّله مرة واحدة على مشروع جديد من: Supabase Dashboard > SQL Editor
-- =====================================================================
--  المحتويات:
--   1) الامتدادات والأنواع (Enums)
--   2) الجداول (54 جدولاً) + الفهارس
--   3) دوال مساعدة + Triggers
--   4) دوال العمليات الحرجة (RPC)
--   5) RLS (الأمان والصلاحيات)
--   6) Views للتقارير ولوحة التحكم
--   7) Storage + Realtime + بيانات أولية (Seed)
-- =====================================================================

create extension if not exists pg_trgm;

-- ───────────────────────── 1) الأنواع ─────────────────────────
create type branch_type        as enum ('main_warehouse','branch');
create type payment_method_type as enum ('cash','transfer','bank','other');
create type tax_applies_to     as enum ('sales','purchases','both');
create type employee_status    as enum ('active','suspended','terminated');
create type movement_type      as enum ('opening','purchase','purchase_return','sale','sale_return',
                                        'transfer_out','transfer_in','count_adjustment','damage',
                                        'exchange_in','exchange_out','adjustment');
create type doc_status         as enum ('draft','posted','cancelled');
create type pay_status         as enum ('unpaid','partial','paid');
create type count_status       as enum ('draft','in_progress','approved','cancelled');
create type request_status     as enum ('new','under_review','approved','partially_approved','rejected',
                                        'issued','in_transit','received');
create type transfer_status    as enum ('created','issued','in_transit','received','has_difference');
create type shift_status       as enum ('open','closed');
create type sale_status        as enum ('completed','partially_returned','returned','cancelled');
create type item_condition     as enum ('resalable','damaged');
create type exchange_direction as enum ('returned','given');
create type cash_tx_type       as enum ('opening','sale','refund','expense','collection','income',
                                        'settlement','supplier_payment','salary');
create type flow_direction     as enum ('in','out');
create type ledger_entry_type  as enum ('goods_received','goods_returned','settlement','adjustment');
create type approval_state     as enum ('pending','approved','rejected');
create type expense_kind       as enum ('salary','rent','electricity','water','internet','commission','other');
create type adjustment_type    as enum ('bonus','deduction','advance');
create type period_status      as enum ('open','calculated','approved','paid');
create type payroll_status     as enum ('draft','approved','paid');
create type commission_status  as enum ('pending','approved','paid');

-- ───────────────────────── 2) الجداول ─────────────────────────
-- ملاحظة: العلامة created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() تُستبدل بالحقول المشتركة (created_at, updated_at, created_by)
--         والعلامة created_at timestamptz not null default now(),
  created_by uuid default auth.uid() بـ (created_at, created_by) فقط.

-- ===== الأدوار والصلاحيات =====
create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  description text,
  is_system   boolean not null default false,
  all_branches boolean not null default false,   -- يرى كل الفروع (الإدارة/المحاسب/المخزن)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table public.permissions (
  id      uuid primary key default gen_random_uuid(),
  module  text not null,
  action  text not null check (action in ('view','create','update','delete','print','export','approve','cancel')),
  unique (module, action)
);

create table public.role_permissions (
  role_id       uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

-- ===== الفروع والموظفون =====
create table public.branches (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null,
  type       branch_type not null default 'branch',
  manager_id uuid,                                  -- FK يُضاف بعد جدول employees
  phone      text,
  address    text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
-- مخزن رئيسي واحد فقط
create unique index uq_single_main_warehouse on public.branches ((type)) where type = 'main_warehouse';

create table public.employees (
  id              uuid primary key default gen_random_uuid(),
  branch_id       uuid not null references public.branches(id),
  full_name       text not null,
  job_title       text,
  phone           text,
  national_id     text,
  hire_date       date,
  base_salary     numeric(14,2) not null default 0 check (base_salary >= 0),
  commission_rate numeric(5,2)  not null default 0 check (commission_rate between 0 and 100),
  status          employee_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
alter table public.branches
  add constraint fk_branches_manager foreign key (manager_id) references public.employees(id) on delete set null;

create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  employee_id   uuid references public.employees(id) on delete set null,
  branch_id     uuid not null references public.branches(id),
  role_id       uuid not null references public.roles(id),
  username      text unique,
  phone         text unique,
  full_name     text not null,
  is_active     boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

-- ===== الإعدادات والنظام =====
create table public.company_profile (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  logo_url       text,
  tax_number     text,
  phone          text,
  address        text,
  invoice_footer text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table public.settings (
  id        uuid primary key default gen_random_uuid(),
  key       text not null,
  value     jsonb not null default '{}'::jsonb,
  branch_id uuid references public.branches(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create unique index uq_settings_key_branch on public.settings (key, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table public.document_sequences (
  id        uuid primary key default gen_random_uuid(),
  doc_type  text not null,
  branch_id uuid not null references public.branches(id) on delete cascade,
  year      int  not null,
  prefix    text not null,
  next_no   int  not null default 1,
  unique (doc_type, branch_id, year)
);

create table public.audit_logs (
  id         bigint generated always as identity primary key,
  user_id    uuid,                                   -- بدون FK عمداً: السجل غير قابل للتعديل
  module     text,
  action     text not null,
  table_name text,
  record_id  uuid,
  old_data   jsonb,
  new_data   jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid references public.profiles(id) on delete cascade,
  role_id   uuid references public.roles(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  type      text not null,
  title     text not null,
  body      text,
  ref_table text,
  ref_id    uuid,
  is_read   boolean not null default false,   -- ملاحظة: إشعار الدور مشترك، قراءته تؤثر على الجميع
  created_at timestamptz not null default now()
);

create table public.approval_requests (
  id           uuid primary key default gen_random_uuid(),
  module       text not null,
  ref_table    text,
  ref_id       uuid,
  requested_by uuid references public.profiles(id) default auth.uid(),
  approved_by  uuid references public.profiles(id),
  status       approval_state not null default 'pending',
  note         text,
  decided_at   timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

-- ===== البيانات الأساسية =====
create table public.tax_rates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  rate       numeric(5,2) not null check (rate >= 0),
  applies_to tax_applies_to not null default 'both',
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table public.units (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  abbreviation text,
  is_active    boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  parent_id  uuid references public.categories(id) on delete set null,
  sort_order int not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table public.products (
  id              uuid primary key default gen_random_uuid(),
  sku             text not null unique,
  barcode         text unique,
  name            text not null,
  category_id     uuid references public.categories(id),
  unit_id         uuid references public.units(id),
  size_label      text,
  image_url       text,
  cost_price      numeric(14,2) not null default 0 check (cost_price >= 0),
  wholesale_price numeric(14,2) not null default 0 check (wholesale_price >= 0),
  retail_price    numeric(14,2) not null default 0 check (retail_price >= 0),
  min_stock       numeric(14,3) not null default 0 check (min_stock >= 0),
  tax_rate_id     uuid references public.tax_rates(id),
  is_active       boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index idx_products_name_trgm on public.products using gin (name gin_trgm_ops);
create index idx_products_category on public.products (category_id);

create table public.payment_methods (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  type         payment_method_type not null default 'cash',
  account_info text,
  is_cash      boolean not null default false,   -- يدخل في رصيد الصندوق النقدي
  is_active    boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table public.suppliers (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  phone           text,
  address         text,
  tax_number      text,
  opening_balance numeric(14,2) not null default 0,
  is_active       boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table public.customers (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  phone           text unique,
  address         text,
  notes           text,
  opening_balance numeric(14,2) not null default 0,
  is_active       boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index idx_customers_name_trgm on public.customers using gin (name gin_trgm_ops);

-- ===== المخزون =====
create table public.stock_balances (
  branch_id    uuid not null references public.branches(id),
  product_id   uuid not null references public.products(id),
  qty_on_hand  numeric(14,3) not null default 0 check (qty_on_hand >= 0),
  qty_reserved numeric(14,3) not null default 0 check (qty_reserved >= 0),
  avg_cost     numeric(14,4) not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (branch_id, product_id)
);
create index idx_stock_balances_product on public.stock_balances (product_id);

create table public.stock_movements (
  id            bigint generated always as identity primary key,
  branch_id     uuid not null references public.branches(id),
  product_id    uuid not null references public.products(id),
  movement_type movement_type not null,
  qty_in        numeric(14,3) not null default 0 check (qty_in >= 0),
  qty_out       numeric(14,3) not null default 0 check (qty_out >= 0),
  unit_cost     numeric(14,4) not null default 0,
  ref_type      text,
  ref_id        uuid,
  note          text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check (qty_in > 0 or qty_out > 0)
);
create index idx_movements_product_branch on public.stock_movements (product_id, branch_id, created_at desc);
create index idx_movements_ref on public.stock_movements (ref_type, ref_id);

create table public.stock_counts (
  id          uuid primary key default gen_random_uuid(),
  count_no    text not null unique,
  branch_id   uuid not null references public.branches(id),
  status      count_status not null default 'draft',
  started_at  timestamptz,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  note        text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table public.stock_count_items (
  id         uuid primary key default gen_random_uuid(),
  count_id   uuid not null references public.stock_counts(id) on delete cascade,
  product_id uuid not null references public.products(id),
  system_qty numeric(14,3) not null default 0,
  actual_qty numeric(14,3) check (actual_qty >= 0),
  diff_qty   numeric(14,3) generated always as (actual_qty - system_qty) stored,
  diff_value numeric(14,2),
  reason     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (count_id, product_id)
);

create table public.damaged_items (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references public.branches(id),
  product_id  uuid not null references public.products(id),
  qty         numeric(14,3) not null check (qty > 0),
  unit_cost   numeric(14,4) not null default 0,
  total_value numeric(14,2) generated always as (round(qty * unit_cost, 2)) stored,
  reason      text,
  source_type text not null default 'manual' check (source_type in ('manual','sales_return','count')),
  source_id   uuid,
  reported_by uuid references public.profiles(id) default auth.uid(),
  damaged_at  date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

-- ===== المشتريات =====
create table public.purchase_invoices (
  id             uuid primary key default gen_random_uuid(),
  invoice_no     text not null unique,
  supplier_id    uuid not null references public.suppliers(id),
  branch_id      uuid not null references public.branches(id),
  invoice_date   date not null default current_date,
  subtotal       numeric(14,2) not null default 0,
  discount       numeric(14,2) not null default 0,
  tax_amount     numeric(14,2) not null default 0,
  extra_costs    numeric(14,2) not null default 0,
  total          numeric(14,2) not null default 0,
  paid_amount    numeric(14,2) not null default 0,
  remaining      numeric(14,2) not null default 0,
  payment_status pay_status not null default 'unpaid',
  status         doc_status not null default 'posted',
  note           text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index idx_purchase_inv_supplier on public.purchase_invoices (supplier_id, invoice_date desc);

create table public.purchase_invoice_items (
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.purchase_invoices(id) on delete cascade,
  product_id uuid not null references public.products(id),
  qty        numeric(14,3) not null check (qty > 0),
  unit_cost  numeric(14,4) not null check (unit_cost >= 0),
  discount   numeric(14,2) not null default 0,
  tax_rate   numeric(5,2)  not null default 0,
  line_total numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index idx_purchase_items_invoice on public.purchase_invoice_items (invoice_id);

create table public.supplier_payments (
  id                uuid primary key default gen_random_uuid(),
  supplier_id       uuid not null references public.suppliers(id),
  invoice_id        uuid references public.purchase_invoices(id),
  amount            numeric(14,2) not null check (amount > 0),
  payment_method_id uuid references public.payment_methods(id),
  paid_at           date not null default current_date,
  ref_no            text,
  attachment_url    text,
  note              text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index idx_supplier_payments_supplier on public.supplier_payments (supplier_id, paid_at desc);

create table public.purchase_returns (
  id          uuid primary key default gen_random_uuid(),
  return_no   text not null unique,
  invoice_id  uuid references public.purchase_invoices(id),
  supplier_id uuid not null references public.suppliers(id),
  branch_id   uuid not null references public.branches(id),
  return_date date not null default current_date,
  total       numeric(14,2) not null default 0,
  status      doc_status not null default 'draft',
  reason      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table public.purchase_return_items (
  id         uuid primary key default gen_random_uuid(),
  return_id  uuid not null references public.purchase_returns(id) on delete cascade,
  product_id uuid not null references public.products(id),
  qty        numeric(14,3) not null check (qty > 0),
  unit_cost  numeric(14,4) not null default 0,
  line_total numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

-- ===== طلبات البضاعة والتحويلات =====
create table public.stock_requests (
  id          uuid primary key default gen_random_uuid(),
  request_no  text not null unique,
  branch_id   uuid not null references public.branches(id),
  status      request_status not null default 'new',
  note        text,
  reviewed_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index idx_requests_branch_status on public.stock_requests (branch_id, status);

create table public.stock_request_items (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references public.stock_requests(id) on delete cascade,
  product_id    uuid not null references public.products(id),
  qty_requested numeric(14,3) not null check (qty_requested > 0),
  qty_approved  numeric(14,3) check (qty_approved >= 0),
  note          text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (request_id, product_id)
);

create table public.stock_request_status_log (
  id         bigint generated always as identity primary key,
  request_id uuid not null references public.stock_requests(id) on delete cascade,
  status     text not null,
  changed_by uuid references public.profiles(id) default auth.uid(),
  changed_at timestamptz not null default now(),
  note       text
);

create table public.stock_transfers (
  id                    uuid primary key default gen_random_uuid(),
  transfer_no           text not null unique,
  request_id            uuid references public.stock_requests(id),
  from_branch_id        uuid not null references public.branches(id),
  to_branch_id          uuid not null references public.branches(id),
  transfer_date         date not null default current_date,
  total_wholesale_value numeric(14,2) not null default 0,
  status                transfer_status not null default 'created',
  issued_by             uuid references public.profiles(id),
  received_by           uuid references public.profiles(id),
  received_at           timestamptz,
  note                  text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check (from_branch_id <> to_branch_id)
);
create index idx_transfers_to on public.stock_transfers (to_branch_id, status);

create table public.stock_transfer_items (
  id              uuid primary key default gen_random_uuid(),
  transfer_id     uuid not null references public.stock_transfers(id) on delete cascade,
  product_id      uuid not null references public.products(id),
  qty_sent        numeric(14,3) not null check (qty_sent > 0),
  qty_received    numeric(14,3) check (qty_received >= 0),
  wholesale_price numeric(14,2) not null default 0,
  unit_cost       numeric(14,4) not null default 0,
  diff_qty        numeric(14,3) generated always as (qty_sent - coalesce(qty_received, qty_sent)) stored,
  diff_note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index idx_transfer_items_transfer on public.stock_transfer_items (transfer_id);

-- ===== المبيعات =====
create table public.shifts (
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid not null references public.branches(id),
  user_id       uuid not null references public.profiles(id),
  employee_id   uuid references public.employees(id),
  opened_at     timestamptz not null default now(),
  closed_at     timestamptz,
  opening_cash  numeric(14,2) not null default 0,
  total_sales   numeric(14,2) not null default 0,
  cash_sales    numeric(14,2) not null default 0,
  other_sales   numeric(14,2) not null default 0,
  returns_total numeric(14,2) not null default 0,
  expected_cash numeric(14,2),
  actual_cash   numeric(14,2),
  difference    numeric(14,2),
  status        shift_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create unique index uq_one_open_shift_per_user on public.shifts (user_id) where status = 'open';
create index idx_shifts_branch on public.shifts (branch_id, opened_at desc);

create table public.sales_invoices (
  id            uuid primary key default gen_random_uuid(),
  invoice_no    text not null unique,
  branch_id     uuid not null references public.branches(id),
  shift_id      uuid references public.shifts(id),
  customer_id   uuid references public.customers(id),
  sold_by       uuid references public.employees(id),
  invoice_date  timestamptz not null default now(),
  subtotal      numeric(14,2) not null default 0,
  discount      numeric(14,2) not null default 0,
  tax_amount    numeric(14,2) not null default 0,
  total         numeric(14,2) not null default 0,
  paid_amount   numeric(14,2) not null default 0,
  change_amount numeric(14,2) not null default 0,
  remaining     numeric(14,2) not null default 0,
  status        sale_status not null default 'completed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index idx_sales_branch_date on public.sales_invoices (branch_id, invoice_date desc);
create index idx_sales_customer on public.sales_invoices (customer_id);
create index idx_sales_shift on public.sales_invoices (shift_id);

create table public.sales_invoice_items (
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.sales_invoices(id) on delete cascade,
  product_id uuid not null references public.products(id),
  qty        numeric(14,3) not null check (qty > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  unit_cost  numeric(14,4) not null default 0,     -- لقطة التكلفة وقت البيع
  discount   numeric(14,2) not null default 0,
  tax_rate   numeric(5,2)  not null default 0,
  line_total numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index idx_sales_items_invoice on public.sales_invoice_items (invoice_id);
create index idx_sales_items_product on public.sales_invoice_items (product_id);

create table public.sales_payments (
  id                uuid primary key default gen_random_uuid(),
  invoice_id        uuid not null references public.sales_invoices(id) on delete cascade,
  payment_method_id uuid not null references public.payment_methods(id),
  amount            numeric(14,2) not null check (amount > 0),
  received_amount   numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index idx_sales_payments_invoice on public.sales_payments (invoice_id);

create table public.customer_payments (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid not null references public.customers(id),
  invoice_id        uuid references public.sales_invoices(id),
  branch_id         uuid not null references public.branches(id),
  shift_id          uuid references public.shifts(id),
  amount            numeric(14,2) not null check (amount > 0),
  payment_method_id uuid not null references public.payment_methods(id),
  paid_at           date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table public.sales_returns (
  id               uuid primary key default gen_random_uuid(),
  return_no        text not null unique,
  invoice_id       uuid not null references public.sales_invoices(id),
  branch_id        uuid not null references public.branches(id),
  customer_id      uuid references public.customers(id),
  shift_id         uuid references public.shifts(id),
  return_date      timestamptz not null default now(),
  refund_amount    numeric(14,2) not null default 0,
  refund_method_id uuid references public.payment_methods(id),
  reason           text,
  status           doc_status not null default 'posted',
  approved_by      uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index idx_sales_returns_branch on public.sales_returns (branch_id, return_date desc);

create table public.sales_return_items (
  id              uuid primary key default gen_random_uuid(),
  return_id       uuid not null references public.sales_returns(id) on delete cascade,
  invoice_item_id uuid not null references public.sales_invoice_items(id),
  product_id      uuid not null references public.products(id),
  qty             numeric(14,3) not null check (qty > 0),
  reason          text,
  condition       item_condition not null default 'resalable',
  refund_amount   numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table public.exchanges (
  id                   uuid primary key default gen_random_uuid(),
  exchange_no          text not null unique,
  original_invoice_id  uuid not null references public.sales_invoices(id),
  branch_id            uuid not null references public.branches(id),
  customer_id          uuid references public.customers(id),
  shift_id             uuid references public.shifts(id),
  returned_total       numeric(14,2) not null default 0,
  new_total            numeric(14,2) not null default 0,
  difference           numeric(14,2) not null default 0,   -- موجب: على العميل / سالب: للعميل
  settlement_method_id uuid references public.payment_methods(id),
  status               doc_status not null default 'posted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table public.exchange_items (
  id          uuid primary key default gen_random_uuid(),
  exchange_id uuid not null references public.exchanges(id) on delete cascade,
  direction   exchange_direction not null,
  product_id  uuid not null references public.products(id),
  qty         numeric(14,3) not null check (qty > 0),
  unit_price  numeric(14,2) not null default 0,
  condition   item_condition not null default 'resalable',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

-- ===== المالية =====
create table public.expense_categories (
  id        uuid primary key default gen_random_uuid(),
  name      text not null unique,
  kind      expense_kind not null default 'other',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table public.expenses (
  id                      uuid primary key default gen_random_uuid(),
  branch_id               uuid not null references public.branches(id),
  category_id             uuid not null references public.expense_categories(id),
  amount                  numeric(14,2) not null check (amount > 0),
  expense_date            date not null default current_date,
  payment_method_id       uuid references public.payment_methods(id),
  responsible_employee_id uuid references public.employees(id),
  shift_id                uuid references public.shifts(id),   -- إن دُفع من صندوق الوردية
  description             text,
  attachment_url          text,
  status                  doc_status not null default 'posted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index idx_expenses_branch_date on public.expenses (branch_id, expense_date desc);

create table public.income_types (
  id        uuid primary key default gen_random_uuid(),
  name      text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table public.other_incomes (
  id                uuid primary key default gen_random_uuid(),
  income_type_id    uuid not null references public.income_types(id),
  branch_id         uuid not null references public.branches(id),
  amount            numeric(14,2) not null check (amount > 0),
  income_date       date not null default current_date,
  payment_method_id uuid references public.payment_methods(id),
  shift_id          uuid references public.shifts(id),
  description       text,
  attachment_url    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table public.cash_transactions (
  id                bigint generated always as identity primary key,
  branch_id         uuid not null references public.branches(id),
  shift_id          uuid references public.shifts(id),
  payment_method_id uuid references public.payment_methods(id),
  tx_type           cash_tx_type not null,
  direction         flow_direction not null,
  amount            numeric(14,2) not null check (amount > 0),
  ref_type          text,
  ref_id            uuid,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index idx_cash_tx_shift on public.cash_transactions (shift_id);
create index idx_cash_tx_branch_date on public.cash_transactions (branch_id, created_at desc);

create table public.branch_settlements (
  id                uuid primary key default gen_random_uuid(),
  branch_id         uuid not null references public.branches(id),
  amount            numeric(14,2) not null check (amount > 0),
  settlement_date   date not null default current_date,
  payment_method_id uuid references public.payment_methods(id),
  ref_no            text,
  note              text,
  attachment_url    text,
  approved_by       uuid references public.profiles(id),
  status            approval_state not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table public.branch_ledger (
  id         bigint generated always as identity primary key,
  branch_id  uuid not null references public.branches(id),
  entry_type ledger_entry_type not null,
  debit      numeric(14,2) not null default 0 check (debit >= 0),    -- على الفرع (بضاعة مستلمة)
  credit     numeric(14,2) not null default 0 check (credit >= 0),   -- للفرع (تسوية/مرتجع)
  ref_type   text,
  ref_id     uuid,
  entry_date date not null default current_date,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index idx_branch_ledger_branch on public.branch_ledger (branch_id, entry_date desc);

-- ===== الرواتب والعمولات =====
create table public.payroll_periods (
  id     uuid primary key default gen_random_uuid(),
  year   int not null,
  month  int not null check (month between 1 and 12),
  status period_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (year, month)
);

create table public.payrolls (
  id                uuid primary key default gen_random_uuid(),
  period_id         uuid not null references public.payroll_periods(id),
  employee_id       uuid not null references public.employees(id),
  branch_id         uuid not null references public.branches(id),
  base_salary       numeric(14,2) not null default 0,
  commission_amount numeric(14,2) not null default 0,
  bonuses           numeric(14,2) not null default 0,
  deductions        numeric(14,2) not null default 0,
  advances          numeric(14,2) not null default 0,
  net_salary        numeric(14,2) generated always as
                      (base_salary + commission_amount + bonuses - deductions - advances) stored,
  status            payroll_status not null default 'draft',
  approved_by       uuid references public.profiles(id),
  paid_at           timestamptz,
  payment_method_id uuid references public.payment_methods(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (period_id, employee_id)
);

create table public.employee_adjustments (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  adj_type    adjustment_type not null,
  amount      numeric(14,2) not null check (amount > 0),
  adj_date    date not null default current_date,
  reason      text,
  payroll_id  uuid references public.payrolls(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table public.commissions (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references public.employees(id),
  branch_id      uuid not null references public.branches(id),
  period_id      uuid not null references public.payroll_periods(id),
  total_sales    numeric(14,2) not null default 0,
  eligible_sales numeric(14,2) not null default 0,
  rate           numeric(5,2)  not null default 0,
  amount         numeric(14,2) not null default 0,
  status         commission_status not null default 'pending',
  payroll_id     uuid references public.payrolls(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (period_id, employee_id)
);

-- ───────────────────────── 3) دوال مساعدة + Triggers ─────────────────────────

-- تحديث updated_at
create or replace function public.trg_set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare r record;
begin
  for r in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'updated_at'
  loop
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function public.trg_set_updated_at()', r.table_name);
  end loop;
end $$;

-- ===== دوال الصلاحيات (تُستخدم في سياسات RLS) =====
create or replace function public.auth_branch_id() returns uuid
language sql stable security definer set search_path = public as $$
  select branch_id from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p join public.roles r on r.id = p.role_id
    where p.id = auth.uid() and p.is_active and r.code = 'super_admin')
$$;

create or replace function public.sees_all_branches() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p join public.roles r on r.id = p.role_id
    where p.id = auth.uid() and p.is_active and (r.all_branches or r.code = 'super_admin'))
$$;

create or replace function public.can_access_branch(p_branch uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_branch is not null and (public.sees_all_branches() or p_branch = public.auth_branch_id())
$$;

create or replace function public.has_permission(p_module text, p_action text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_super_admin() or exists (
    select 1
    from public.profiles p
    join public.role_permissions rp on rp.role_id = p.role_id
    join public.permissions pm on pm.id = rp.permission_id
    where p.id = auth.uid() and p.is_active and pm.module = p_module and pm.action = p_action)
$$;

-- ===== ترقيم المستندات (داخلي) =====
create or replace function public.internal_next_doc_no(p_doc_type text, p_branch uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_year int := extract(year from now())::int;
  v_no int; v_prefix text; v_code text;
begin
  insert into public.document_sequences as ds (doc_type, branch_id, year, prefix, next_no)
  values (p_doc_type, p_branch, v_year,
          case p_doc_type when 'sale' then 'INV' when 'purchase' then 'PUR' when 'request' then 'REQ'
                          when 'transfer' then 'TRF' when 'sreturn' then 'RET' when 'preturn' then 'PRT'
                          when 'exchange' then 'EXC' when 'count' then 'CNT' else upper(left(p_doc_type, 3)) end,
          2)
  on conflict (doc_type, branch_id, year) do update set next_no = ds.next_no + 1
  returning ds.next_no - 1, ds.prefix into v_no, v_prefix;

  select code into v_code from public.branches where id = p_branch;
  return v_prefix || '-' || coalesce(v_code, 'X') || '-' || v_year || '-' || lpad(v_no::text, 6, '0');
end $$;

-- Trigger عام لتعبئة رقم المستند عند الإدخال: trg_set_doc_no('sale','invoice_no')
create or replace function public.trg_set_doc_no() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_col text := tg_argv[1];
  j jsonb := to_jsonb(new);
  v_branch uuid;
begin
  if j ->> v_col is null then
    v_branch := coalesce(j ->> 'branch_id', j ->> 'from_branch_id')::uuid;
    new := jsonb_populate_record(new, jsonb_build_object(v_col, public.internal_next_doc_no(tg_argv[0], v_branch)));
  end if;
  return new;
end $$;

create trigger doc_no before insert on public.sales_invoices    for each row execute function public.trg_set_doc_no('sale','invoice_no');
create trigger doc_no before insert on public.purchase_invoices for each row execute function public.trg_set_doc_no('purchase','invoice_no');
create trigger doc_no before insert on public.stock_requests    for each row execute function public.trg_set_doc_no('request','request_no');
create trigger doc_no before insert on public.stock_transfers   for each row execute function public.trg_set_doc_no('transfer','transfer_no');
create trigger doc_no before insert on public.sales_returns     for each row execute function public.trg_set_doc_no('sreturn','return_no');
create trigger doc_no before insert on public.purchase_returns  for each row execute function public.trg_set_doc_no('preturn','return_no');
create trigger doc_no before insert on public.exchanges         for each row execute function public.trg_set_doc_no('exchange','exchange_no');
create trigger doc_no before insert on public.stock_counts      for each row execute function public.trg_set_doc_no('count','count_no');

-- ===== الإشعارات (داخلي) =====
create or replace function public.internal_notify(
  p_type text, p_title text, p_body text, p_ref_table text, p_ref_id uuid, p_branch uuid, p_roles text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (type, title, body, ref_table, ref_id, branch_id, role_id)
  select p_type, p_title, p_body, p_ref_table, p_ref_id, p_branch, r.id
  from public.roles r where r.code = any (p_roles);
end $$;

-- ===== تطبيق حركة المخزون على الأرصدة =====
create or replace function public.trg_stock_movement_apply() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old_qty numeric; v_old_avg numeric; v_new_avg numeric; v_new_qty numeric;
  v_min numeric; v_name text;
begin
  insert into public.stock_balances (branch_id, product_id) values (new.branch_id, new.product_id)
  on conflict do nothing;

  select qty_on_hand, avg_cost into v_old_qty, v_old_avg
  from public.stock_balances where branch_id = new.branch_id and product_id = new.product_id for update;

  v_new_qty := v_old_qty + new.qty_in - new.qty_out;
  if v_new_qty < 0 then
    raise exception 'INSUFFICIENT_STOCK: product %, branch %', new.product_id, new.branch_id;
  end if;

  v_new_avg := v_old_avg;
  if new.qty_in > 0 and new.movement_type in ('purchase','transfer_in','opening') and new.unit_cost > 0 then
    v_new_avg := ((v_old_qty * v_old_avg) + (new.qty_in * new.unit_cost)) / (v_old_qty + new.qty_in);
  end if;

  update public.stock_balances
     set qty_on_hand = v_new_qty, avg_cost = v_new_avg, updated_at = now()
   where branch_id = new.branch_id and product_id = new.product_id;

  -- تنبيه انخفاض المخزون عند عبور الحد الأدنى
  if new.qty_out > 0 then
    select min_stock, name into v_min, v_name from public.products where id = new.product_id;
    if v_min > 0 and v_old_qty > v_min and v_new_qty <= v_min then
      perform public.internal_notify('low_stock', 'انخفاض مخزون: ' || v_name,
        'الكمية الحالية ' || v_new_qty || ' (الحد الأدنى ' || v_min || ')',
        'products', new.product_id, new.branch_id, array['warehouse_manager','head_office','branch_manager']);
    end if;
  end if;
  return new;
end $$;

create trigger apply_movement after insert on public.stock_movements
  for each row execute function public.trg_stock_movement_apply();

-- منع تعديل/حذف حركات المخزون (دفتر غير قابل للتغيير)
create or replace function public.trg_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'IMMUTABLE_LEDGER: % on % is not allowed', tg_op, tg_table_name;
end $$;
create trigger immutable before update or delete on public.stock_movements for each row execute function public.trg_immutable();
create trigger immutable before update or delete on public.cash_transactions for each row execute function public.trg_immutable();
create trigger immutable before update or delete on public.branch_ledger for each row execute function public.trg_immutable();
create trigger immutable before update or delete on public.audit_logs for each row execute function public.trg_immutable();

-- ===== التالف اليدوي ينقص المخزون =====
create or replace function public.trg_damaged_apply() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_cost numeric;
begin
  if new.source_type = 'manual' then
    select avg_cost into v_cost from public.stock_balances
     where branch_id = new.branch_id and product_id = new.product_id;
    insert into public.stock_movements (branch_id, product_id, movement_type, qty_out, unit_cost, ref_type, ref_id, note)
    values (new.branch_id, new.product_id, 'damage', new.qty, coalesce(v_cost, 0), 'damaged_items', new.id, new.reason);
  end if;
  return new;
end $$;
create trigger apply_damage after insert on public.damaged_items
  for each row execute function public.trg_damaged_apply();
-- تكلفة التالف تُعبّأ تلقائياً إن لم تُرسل
create or replace function public.trg_damaged_cost() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.unit_cost = 0 then
    select avg_cost into new.unit_cost from public.stock_balances
     where branch_id = new.branch_id and product_id = new.product_id;
    new.unit_cost := coalesce(new.unit_cost, 0);
  end if;
  return new;
end $$;
create trigger damage_cost before insert on public.damaged_items
  for each row execute function public.trg_damaged_cost();

-- ===== دفعات الموردين تحدّث الفاتورة =====
create or replace function public.trg_supplier_payment_apply() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_inv public.purchase_invoices%rowtype;
begin
  if new.invoice_id is not null then
    select * into v_inv from public.purchase_invoices where id = new.invoice_id for update;
    if not found or v_inv.status <> 'posted' then raise exception 'INVALID_INVOICE'; end if;
    if v_inv.supplier_id <> new.supplier_id then raise exception 'SUPPLIER_MISMATCH'; end if;
    if new.amount > v_inv.remaining then raise exception 'PAYMENT_EXCEEDS_REMAINING'; end if;
    update public.purchase_invoices
       set paid_amount = paid_amount + new.amount,
           remaining = total - (paid_amount + new.amount),
           payment_status = (case when total - (paid_amount + new.amount) <= 0 then 'paid'
                                  else 'partial' end)::pay_status
     where id = new.invoice_id;
  end if;
  return new;
end $$;
create trigger apply_payment after insert on public.supplier_payments
  for each row execute function public.trg_supplier_payment_apply();

-- ===== تحصيل العملاء يحدّث الفاتورة والصندوق =====
create or replace function public.trg_customer_payment_apply() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_inv public.sales_invoices%rowtype;
begin
  if new.invoice_id is not null then
    select * into v_inv from public.sales_invoices where id = new.invoice_id for update;
    if not found or v_inv.status = 'cancelled' then raise exception 'INVALID_INVOICE'; end if;
    if new.amount > v_inv.remaining then raise exception 'PAYMENT_EXCEEDS_REMAINING'; end if;
    update public.sales_invoices
       set paid_amount = paid_amount + new.amount,
           remaining = remaining - new.amount
     where id = new.invoice_id;
  end if;
  insert into public.cash_transactions (branch_id, shift_id, payment_method_id, tx_type, direction, amount, ref_type, ref_id)
  values (new.branch_id, new.shift_id, new.payment_method_id, 'collection', 'in', new.amount, 'customer_payments', new.id);
  return new;
end $$;
create trigger apply_payment after insert on public.customer_payments
  for each row execute function public.trg_customer_payment_apply();

-- ===== المصروفات والإيرادات تُسجَّل في دفتر الصندوق =====
create or replace function public.trg_expense_cash() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.cash_transactions (branch_id, shift_id, payment_method_id, tx_type, direction, amount, ref_type, ref_id)
  values (new.branch_id, new.shift_id, new.payment_method_id, 'expense', 'out', new.amount, 'expenses', new.id);
  return new;
end $$;
create trigger cash_entry after insert on public.expenses
  for each row execute function public.trg_expense_cash();

create or replace function public.trg_income_cash() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.cash_transactions (branch_id, shift_id, payment_method_id, tx_type, direction, amount, ref_type, ref_id)
  values (new.branch_id, new.shift_id, new.payment_method_id, 'income', 'in', new.amount, 'other_incomes', new.id);
  return new;
end $$;
create trigger cash_entry after insert on public.other_incomes
  for each row execute function public.trg_income_cash();

-- ===== تسوية الفرع: عند الاعتماد تُقيَّد في حساب الفرع =====
create or replace function public.trg_settlement_apply() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    if auth.uid() is not null and not public.has_permission('branch_accounts', 'approve') then
      raise exception 'FORBIDDEN: approve settlement';
    end if;
    new.approved_by := coalesce(auth.uid(), new.approved_by);
    insert into public.branch_ledger (branch_id, entry_type, credit, ref_type, ref_id, entry_date)
    values (new.branch_id, 'settlement', new.amount, 'branch_settlements', new.id, new.settlement_date);
  end if;
  return new;
end $$;
create trigger apply_settlement before insert or update on public.branch_settlements
  for each row execute function public.trg_settlement_apply();
-- ملاحظة: القيد في branch_ledger يُنشأ داخل BEFORE trigger؛ ref_id يشير لصف موجود لأن id له قيمة افتراضية.

-- ===== سجل حالات الطلب + إشعارات =====
create or replace function public.trg_request_events() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status then
    insert into public.stock_request_status_log (request_id, status) values (new.id, new.status::text);
  end if;
  if tg_op = 'INSERT' then
    perform public.internal_notify('new_request', 'طلب بضاعة جديد', 'طلب رقم ' || new.request_no,
      'stock_requests', new.id, new.branch_id, array['warehouse_manager','head_office']);
  elsif old.status is distinct from new.status and new.status in ('approved','partially_approved','rejected') then
    perform public.internal_notify('request_decision', 'تم البتّ في طلبكم رقم ' || new.request_no,
      'الحالة الجديدة: ' || new.status::text, 'stock_requests', new.id, new.branch_id, array['branch_manager']);
  end if;
  return new;
end $$;
create trigger request_events after insert or update of status on public.stock_requests
  for each row execute function public.trg_request_events();

-- ===== سجل العمليات (Audit) =====
create or replace function public.trg_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
begin
  if tg_op = 'UPDATE' and v_old - 'updated_at' = v_new - 'updated_at' then
    return new;
  end if;
  insert into public.audit_logs (user_id, module, action, table_name, record_id, old_data, new_data)
  values (auth.uid(), tg_argv[0], lower(tg_op), tg_table_name,
          nullif(coalesce(v_new ->> 'id', v_old ->> 'id'), '')::uuid, v_old, v_new);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

do $$
declare r record;
begin
  for r in select * from (values
    ('sales_invoices','sales'), ('purchase_invoices','purchases'), ('stock_transfers','transfers'),
    ('stock_requests','requests'), ('stock_counts','stock_counts'), ('expenses','expenses'),
    ('other_incomes','income'), ('branch_settlements','branch_accounts'), ('payrolls','payroll'),
    ('employee_adjustments','payroll'), ('employees','employees'), ('profiles','users'),
    ('role_permissions','roles'), ('roles','roles'), ('products','products'),
    ('sales_returns','returns'), ('exchanges','exchanges'), ('damaged_items','damaged'),
    ('settings','settings'), ('shifts','shifts'), ('customers','customers'), ('suppliers','suppliers')
  ) as t(tbl, module)
  loop
    execute format('create trigger audit after insert or update or delete on public.%I
                    for each row execute function public.trg_audit(%L)', r.tbl, r.module);
  end loop;
end $$;

-- ───────────────────────── 4) دوال العمليات (RPC) ─────────────────────────
-- تُستدعى من الواجهة: supabase.rpc('fn_create_sale', { p: {...} })
-- كل دالة تعمل داخل معاملة واحدة (كل شيء أو لا شيء).

-- ===== فتح وردية =====
create or replace function public.fn_open_shift(p_opening_cash numeric default 0) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_prof public.profiles%rowtype; v_id uuid;
begin
  if not public.has_permission('shifts','create') then raise exception 'FORBIDDEN'; end if;
  select * into v_prof from public.profiles where id = auth.uid() and is_active;
  if not found then raise exception 'NO_PROFILE'; end if;
  if exists (select 1 from public.shifts where user_id = auth.uid() and status = 'open') then
    raise exception 'SHIFT_ALREADY_OPEN';
  end if;
  insert into public.shifts (branch_id, user_id, employee_id, opening_cash)
  values (v_prof.branch_id, v_prof.id, v_prof.employee_id, coalesce(p_opening_cash, 0))
  returning id into v_id;
  return v_id;
end $$;

-- ===== إغلاق وردية =====
create or replace function public.fn_close_shift(p_shift uuid, p_actual_cash numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.shifts%rowtype;
  v_total numeric; v_cash_sales numeric; v_other numeric; v_returns numeric; v_net_cash numeric; v_expected numeric;
begin
  select * into s from public.shifts where id = p_shift for update;
  if not found then raise exception 'SHIFT_NOT_FOUND'; end if;
  if s.status <> 'open' then raise exception 'SHIFT_NOT_OPEN'; end if;
  if s.user_id <> auth.uid() and not public.has_permission('shifts','approve') then raise exception 'FORBIDDEN'; end if;
  if p_actual_cash is null or p_actual_cash < 0 then raise exception 'INVALID_ACTUAL_CASH'; end if;

  select coalesce(sum(total), 0) into v_total
    from public.sales_invoices where shift_id = s.id and status <> 'cancelled';

  select coalesce(sum(sp.amount) filter (where pm.is_cash), 0),
         coalesce(sum(sp.amount) filter (where not pm.is_cash), 0)
    into v_cash_sales, v_other
    from public.sales_payments sp
    join public.sales_invoices si on si.id = sp.invoice_id
    join public.payment_methods pm on pm.id = sp.payment_method_id
   where si.shift_id = s.id and si.status <> 'cancelled';

  select coalesce(sum(refund_amount), 0) into v_returns
    from public.sales_returns where shift_id = s.id and status = 'posted';

  select coalesce(sum(case when ct.direction = 'in' then ct.amount else -ct.amount end), 0) into v_net_cash
    from public.cash_transactions ct
    join public.payment_methods pm on pm.id = ct.payment_method_id
   where ct.shift_id = s.id and pm.is_cash;

  v_expected := s.opening_cash + v_net_cash;

  update public.shifts
     set closed_at = now(), status = 'closed',
         total_sales = v_total, cash_sales = v_cash_sales, other_sales = v_other, returns_total = v_returns,
         expected_cash = v_expected, actual_cash = p_actual_cash, difference = p_actual_cash - v_expected
   where id = s.id;

  return jsonb_build_object('shift_id', s.id, 'total_sales', v_total, 'cash_sales', v_cash_sales,
    'other_sales', v_other, 'returns_total', v_returns, 'expected_cash', v_expected,
    'actual_cash', p_actual_cash, 'difference', p_actual_cash - v_expected);
end $$;

-- ===== إنشاء فاتورة بيع (POS) =====
-- p = {
--   customer_id?, discount?,                       -- خصم على مستوى الفاتورة
--   items:    [{product_id, qty, unit_price?, discount?}],
--   payments: [{payment_method_id, amount, received_amount?}]
-- }
-- الضريبة تُحسب غير شاملة (تُضاف فوق السعر) حسب نسبة ضريبة المنتج.
create or replace function public.fn_create_sale(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_shift public.shifts%rowtype;
  v_prof public.profiles%rowtype;
  v_inv uuid; v_inv_no text;
  it jsonb; pay jsonb;
  v_prod public.products%rowtype; v_bal public.stock_balances%rowtype;
  v_qty numeric; v_price numeric; v_disc numeric; v_rate numeric; v_net numeric; v_tax numeric;
  v_subtotal numeric := 0; v_discount numeric := 0; v_taxtotal numeric := 0;
  v_header_disc numeric := coalesce((p ->> 'discount')::numeric, 0);
  v_total numeric; v_paid numeric := 0; v_received numeric := 0; v_amt numeric; v_recv numeric;
  v_customer uuid := nullif(p ->> 'customer_id', '')::uuid;
  v_change numeric; v_remaining numeric;
begin
  if not public.has_permission('pos','create') then raise exception 'FORBIDDEN'; end if;
  select * into v_shift from public.shifts where user_id = v_uid and status = 'open';
  if not found then raise exception 'NO_OPEN_SHIFT'; end if;
  select * into v_prof from public.profiles where id = v_uid;
  if jsonb_array_length(coalesce(p -> 'items', '[]'::jsonb)) = 0 then raise exception 'EMPTY_CART'; end if;
  if v_header_disc < 0 then raise exception 'INVALID_DISCOUNT'; end if;

  insert into public.sales_invoices (branch_id, shift_id, customer_id, sold_by)
  values (v_shift.branch_id, v_shift.id, v_customer, v_prof.employee_id)
  returning id, invoice_no into v_inv, v_inv_no;

  for it in select * from jsonb_array_elements(p -> 'items') loop
    select * into v_prod from public.products where id = (it ->> 'product_id')::uuid and is_active;
    if not found then raise exception 'PRODUCT_NOT_FOUND: %', it ->> 'product_id'; end if;

    v_qty   := (it ->> 'qty')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'INVALID_QTY'; end if;
    v_price := coalesce((it ->> 'unit_price')::numeric, v_prod.retail_price);
    v_disc  := coalesce((it ->> 'discount')::numeric, 0);
    v_rate  := coalesce((select rate from public.tax_rates where id = v_prod.tax_rate_id and is_active), 0);
    v_net   := v_qty * v_price - v_disc;
    if v_net < 0 or v_disc < 0 then raise exception 'INVALID_DISCOUNT'; end if;
    v_tax   := round(v_net * v_rate / 100, 2);

    select * into v_bal from public.stock_balances
     where branch_id = v_shift.branch_id and product_id = v_prod.id for update;
    if not found or (v_bal.qty_on_hand - v_bal.qty_reserved) < v_qty then
      raise exception 'INSUFFICIENT_STOCK: %', v_prod.name;
    end if;

    insert into public.sales_invoice_items (invoice_id, product_id, qty, unit_price, unit_cost, discount, tax_rate, line_total)
    values (v_inv, v_prod.id, v_qty, v_price, v_bal.avg_cost, v_disc, v_rate, v_net + v_tax);

    insert into public.stock_movements (branch_id, product_id, movement_type, qty_out, unit_cost, ref_type, ref_id)
    values (v_shift.branch_id, v_prod.id, 'sale', v_qty, v_bal.avg_cost, 'sales_invoices', v_inv);

    v_subtotal := v_subtotal + v_qty * v_price;
    v_discount := v_discount + v_disc;
    v_taxtotal := v_taxtotal + v_tax;
  end loop;

  v_discount := v_discount + v_header_disc;
  v_total := v_subtotal - v_discount + v_taxtotal;
  if v_total < 0 then raise exception 'INVALID_TOTAL'; end if;

  for pay in select * from jsonb_array_elements(coalesce(p -> 'payments', '[]'::jsonb)) loop
    v_amt  := (pay ->> 'amount')::numeric;
    v_recv := coalesce((pay ->> 'received_amount')::numeric, v_amt);
    if v_amt is null or v_amt <= 0 then raise exception 'INVALID_PAYMENT'; end if;
    insert into public.sales_payments (invoice_id, payment_method_id, amount, received_amount)
    values (v_inv, (pay ->> 'payment_method_id')::uuid, v_amt, v_recv);
    insert into public.cash_transactions (branch_id, shift_id, payment_method_id, tx_type, direction, amount, ref_type, ref_id)
    values (v_shift.branch_id, v_shift.id, (pay ->> 'payment_method_id')::uuid, 'sale', 'in', v_amt, 'sales_invoices', v_inv);
    v_paid := v_paid + v_amt;
    v_received := v_received + v_recv;
  end loop;

  if v_paid > v_total then raise exception 'OVERPAID'; end if;
  v_remaining := v_total - v_paid;
  if v_remaining > 0 and v_customer is null then raise exception 'CUSTOMER_REQUIRED_FOR_CREDIT'; end if;
  v_change := greatest(v_received - v_paid, 0);

  update public.sales_invoices
     set subtotal = v_subtotal, discount = v_discount, tax_amount = v_taxtotal, total = v_total,
         paid_amount = v_paid, change_amount = v_change, remaining = v_remaining
   where id = v_inv;

  return jsonb_build_object('id', v_inv, 'invoice_no', v_inv_no, 'total', v_total,
                            'paid', v_paid, 'change', v_change, 'remaining', v_remaining);
end $$;

-- ===== ترحيل فاتورة شراء (إنشاء + ترحيل) =====
-- p = { supplier_id, branch_id, invoice_date?, discount?, extra_costs?, note?,
--       paid_amount?, payment_method_id?,
--       items: [{product_id, qty, unit_cost, discount?, tax_rate?}] }
create or replace function public.fn_post_purchase(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_branch uuid := (p ->> 'branch_id')::uuid;
  v_supplier uuid := (p ->> 'supplier_id')::uuid;
  v_inv uuid; v_inv_no text; it jsonb;
  v_hdisc numeric := coalesce((p ->> 'discount')::numeric, 0);
  v_extra numeric := coalesce((p ->> 'extra_costs')::numeric, 0);
  v_paid  numeric := coalesce((p ->> 'paid_amount')::numeric, 0);
  v_qty numeric; v_cost numeric; v_disc numeric; v_rate numeric; v_net numeric; v_tax numeric;
  v_sum_net numeric := 0; v_subtotal numeric := 0; v_ldisc numeric := 0; v_taxtotal numeric := 0;
  v_alloc numeric; v_landed numeric; v_total numeric;
begin
  if not public.has_permission('purchases','create') then raise exception 'FORBIDDEN'; end if;
  if not public.can_access_branch(v_branch) then raise exception 'FORBIDDEN_BRANCH'; end if;
  if jsonb_array_length(coalesce(p -> 'items', '[]'::jsonb)) = 0 then raise exception 'EMPTY_INVOICE'; end if;

  -- تمريرة أولى: مجموع صافي البنود لتوزيع التكاليف الإضافية
  for it in select * from jsonb_array_elements(p -> 'items') loop
    v_sum_net := v_sum_net + (it ->> 'qty')::numeric * (it ->> 'unit_cost')::numeric
                 - coalesce((it ->> 'discount')::numeric, 0);
  end loop;
  v_alloc := v_extra - v_hdisc;

  insert into public.purchase_invoices (supplier_id, branch_id, invoice_date, note, status)
  values (v_supplier, v_branch, coalesce((p ->> 'invoice_date')::date, current_date), p ->> 'note', 'posted')
  returning id, invoice_no into v_inv, v_inv_no;

  for it in select * from jsonb_array_elements(p -> 'items') loop
    v_qty  := (it ->> 'qty')::numeric;
    v_cost := (it ->> 'unit_cost')::numeric;
    v_disc := coalesce((it ->> 'discount')::numeric, 0);
    v_rate := coalesce((it ->> 'tax_rate')::numeric, 0);
    if v_qty is null or v_qty <= 0 or v_cost is null or v_cost < 0 then raise exception 'INVALID_ITEM'; end if;
    v_net := v_qty * v_cost - v_disc;
    v_tax := round(v_net * v_rate / 100, 2);
    v_landed := case when v_sum_net > 0
                     then (v_net + v_alloc * v_net / v_sum_net) / v_qty
                     else v_cost end;
    v_landed := greatest(v_landed, 0);

    insert into public.purchase_invoice_items (invoice_id, product_id, qty, unit_cost, discount, tax_rate, line_total)
    values (v_inv, (it ->> 'product_id')::uuid, v_qty, v_cost, v_disc, v_rate, v_net + v_tax);

    insert into public.stock_movements (branch_id, product_id, movement_type, qty_in, unit_cost, ref_type, ref_id)
    values (v_branch, (it ->> 'product_id')::uuid, 'purchase', v_qty, v_landed, 'purchase_invoices', v_inv);

    update public.products set cost_price = round(v_landed, 2) where id = (it ->> 'product_id')::uuid;

    v_subtotal := v_subtotal + v_qty * v_cost;
    v_ldisc := v_ldisc + v_disc;
    v_taxtotal := v_taxtotal + v_tax;
  end loop;

  v_ldisc := v_ldisc + v_hdisc;
  v_total := v_subtotal - v_ldisc + v_taxtotal + v_extra;
  if v_total < 0 then raise exception 'INVALID_TOTAL'; end if;
  if v_paid < 0 or v_paid > v_total then raise exception 'INVALID_PAID_AMOUNT'; end if;

  update public.purchase_invoices
     set subtotal = v_subtotal, discount = v_ldisc, tax_amount = v_taxtotal, extra_costs = v_extra,
         total = v_total, paid_amount = 0, remaining = v_total, payment_status = 'unpaid'
   where id = v_inv;

  if v_paid > 0 then   -- الـ trigger يحدّث المدفوع والمتبقي
    insert into public.supplier_payments (supplier_id, invoice_id, amount, payment_method_id)
    values (v_supplier, v_inv, v_paid, nullif(p ->> 'payment_method_id', '')::uuid);
  end if;

  return jsonb_build_object('id', v_inv, 'invoice_no', v_inv_no, 'total', v_total,
                            'paid', v_paid, 'remaining', v_total - v_paid);
end $$;

-- ===== اعتماد طلب بضاعة =====
-- p_items = [{item_id, qty_approved}]  (اتركه null لاعتماد كل الكميات المطلوبة)
create or replace function public.fn_approve_request(p_request uuid, p_items jsonb default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  r public.stock_requests%rowtype; i public.stock_request_items%rowtype;
  v_qty numeric; v_tot_req numeric := 0; v_tot_app numeric := 0; v_status request_status;
begin
  if not public.has_permission('requests','approve') then raise exception 'FORBIDDEN'; end if;
  select * into r from public.stock_requests where id = p_request for update;
  if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
  if r.status not in ('new','under_review') then raise exception 'INVALID_STATUS: %', r.status; end if;

  for i in select * from public.stock_request_items where request_id = p_request loop
    if p_items is null then
      v_qty := i.qty_requested;
    else
      v_qty := coalesce((select (e ->> 'qty_approved')::numeric
                           from jsonb_array_elements(p_items) e
                          where (e ->> 'item_id')::uuid = i.id limit 1), 0);
    end if;
    if v_qty < 0 or v_qty > i.qty_requested then raise exception 'INVALID_APPROVED_QTY'; end if;
    update public.stock_request_items set qty_approved = v_qty where id = i.id;
    v_tot_req := v_tot_req + i.qty_requested;
    v_tot_app := v_tot_app + v_qty;
  end loop;

  v_status := case when v_tot_app = 0 then 'rejected'
                   when v_tot_app < v_tot_req then 'partially_approved'
                   else 'approved' end;
  update public.stock_requests
     set status = v_status, approved_by = auth.uid(), approved_at = now(),
         reviewed_by = coalesce(reviewed_by, auth.uid())
   where id = p_request;
  return v_status::text;
end $$;

-- ===== إنشاء تحويل (حجز الكميات) =====
-- p = { from_branch_id, to_branch_id, request_id?, note?, items: [{product_id, qty}] }
create or replace function public.fn_create_transfer(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_from uuid := (p ->> 'from_branch_id')::uuid; v_to uuid := (p ->> 'to_branch_id')::uuid;
  v_id uuid; v_no text; it jsonb; v_prod public.products%rowtype; v_bal public.stock_balances%rowtype;
  v_qty numeric; v_total numeric := 0;
begin
  if not public.has_permission('transfers','create') then raise exception 'FORBIDDEN'; end if;
  if not public.can_access_branch(v_from) then raise exception 'FORBIDDEN_BRANCH'; end if;
  if v_from = v_to then raise exception 'SAME_BRANCH'; end if;
  if jsonb_array_length(coalesce(p -> 'items', '[]'::jsonb)) = 0 then raise exception 'EMPTY_TRANSFER'; end if;

  insert into public.stock_transfers (request_id, from_branch_id, to_branch_id, note, status)
  values (nullif(p ->> 'request_id', '')::uuid, v_from, v_to, p ->> 'note', 'created')
  returning id, transfer_no into v_id, v_no;

  for it in select * from jsonb_array_elements(p -> 'items') loop
    v_qty := (it ->> 'qty')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'INVALID_QTY'; end if;
    select * into v_prod from public.products where id = (it ->> 'product_id')::uuid;
    if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
    select * into v_bal from public.stock_balances where branch_id = v_from and product_id = v_prod.id for update;
    if not found or (v_bal.qty_on_hand - v_bal.qty_reserved) < v_qty then
      raise exception 'INSUFFICIENT_STOCK: %', v_prod.name;
    end if;
    update public.stock_balances set qty_reserved = qty_reserved + v_qty, updated_at = now()
     where branch_id = v_from and product_id = v_prod.id;
    insert into public.stock_transfer_items (transfer_id, product_id, qty_sent, wholesale_price, unit_cost)
    values (v_id, v_prod.id, v_qty, v_prod.wholesale_price, v_bal.avg_cost);
    v_total := v_total + v_qty * v_prod.wholesale_price;
  end loop;

  update public.stock_transfers set total_wholesale_value = v_total where id = v_id;
  return jsonb_build_object('id', v_id, 'transfer_no', v_no, 'total_wholesale_value', v_total);
end $$;

-- ===== صرف التحويل (خصم من المخزن الرئيسي) =====
create or replace function public.fn_issue_transfer(p_transfer uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.stock_transfers%rowtype; i public.stock_transfer_items%rowtype;
begin
  if not public.has_permission('transfers','approve') then raise exception 'FORBIDDEN'; end if;
  select * into t from public.stock_transfers where id = p_transfer for update;
  if not found then raise exception 'TRANSFER_NOT_FOUND'; end if;
  if t.status <> 'created' then raise exception 'INVALID_STATUS: %', t.status; end if;
  if not public.can_access_branch(t.from_branch_id) then raise exception 'FORBIDDEN_BRANCH'; end if;

  for i in select * from public.stock_transfer_items where transfer_id = t.id loop
    insert into public.stock_movements (branch_id, product_id, movement_type, qty_out, unit_cost, ref_type, ref_id)
    values (t.from_branch_id, i.product_id, 'transfer_out', i.qty_sent, i.unit_cost, 'stock_transfers', t.id);
    update public.stock_balances set qty_reserved = greatest(qty_reserved - i.qty_sent, 0), updated_at = now()
     where branch_id = t.from_branch_id and product_id = i.product_id;
  end loop;

  update public.stock_transfers set status = 'issued', issued_by = auth.uid() where id = t.id;
  if t.request_id is not null then
    update public.stock_requests set status = 'issued'
     where id = t.request_id and status in ('approved','partially_approved');
  end if;
  perform public.internal_notify('transfer_arriving', 'تحويل بضاعة في الطريق إليكم',
    'تحويل رقم ' || t.transfer_no, 'stock_transfers', t.id, t.to_branch_id, array['branch_manager']);
end $$;

-- ===== تحويل قيد النقل =====
create or replace function public.fn_set_transfer_in_transit(p_transfer uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.stock_transfers%rowtype;
begin
  if not public.has_permission('transfers','update') then raise exception 'FORBIDDEN'; end if;
  select * into t from public.stock_transfers where id = p_transfer for update;
  if not found or t.status <> 'issued' then raise exception 'INVALID_STATUS'; end if;
  if not public.can_access_branch(t.from_branch_id) then raise exception 'FORBIDDEN_BRANCH'; end if;
  update public.stock_transfers set status = 'in_transit' where id = t.id;
  if t.request_id is not null then
    update public.stock_requests set status = 'in_transit' where id = t.request_id and status = 'issued';
  end if;
end $$;

-- ===== استلام التحويل (الفرع يؤكد الكميات الفعلية) =====
-- p_items = [{item_id, qty_received, diff_note?}]  (null = استلام كامل)
create or replace function public.fn_receive_transfer(p_transfer uuid, p_items jsonb default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  t public.stock_transfers%rowtype; i public.stock_transfer_items%rowtype;
  v_rec numeric; v_note text; v_goods numeric := 0; v_has_diff boolean := false; v_status transfer_status;
begin
  if not public.has_permission('transfers','update') then raise exception 'FORBIDDEN'; end if;
  select * into t from public.stock_transfers where id = p_transfer for update;
  if not found then raise exception 'TRANSFER_NOT_FOUND'; end if;
  if t.status not in ('issued','in_transit') then raise exception 'INVALID_STATUS: %', t.status; end if;
  if not public.can_access_branch(t.to_branch_id) then raise exception 'FORBIDDEN_BRANCH'; end if;

  for i in select * from public.stock_transfer_items where transfer_id = t.id loop
    v_rec := i.qty_sent; v_note := null;
    if p_items is not null then
      select (e ->> 'qty_received')::numeric, e ->> 'diff_note' into v_rec, v_note
        from jsonb_array_elements(p_items) e where (e ->> 'item_id')::uuid = i.id limit 1;
      v_rec := coalesce(v_rec, i.qty_sent);
    end if;
    if v_rec < 0 or v_rec > i.qty_sent then raise exception 'INVALID_RECEIVED_QTY'; end if;
    if v_rec <> i.qty_sent then v_has_diff := true; end if;

    update public.stock_transfer_items set qty_received = v_rec, diff_note = v_note where id = i.id;
    if v_rec > 0 then
      insert into public.stock_movements (branch_id, product_id, movement_type, qty_in, unit_cost, ref_type, ref_id)
      values (t.to_branch_id, i.product_id, 'transfer_in', v_rec, i.unit_cost, 'stock_transfers', t.id);
    end if;
    v_goods := v_goods + v_rec * i.wholesale_price;
  end loop;

  if v_goods > 0 then
    insert into public.branch_ledger (branch_id, entry_type, debit, ref_type, ref_id)
    values (t.to_branch_id, 'goods_received', v_goods, 'stock_transfers', t.id);
  end if;

  v_status := case when v_has_diff then 'has_difference' else 'received' end;
  update public.stock_transfers set status = v_status, received_by = auth.uid(), received_at = now() where id = t.id;
  if t.request_id is not null then
    update public.stock_requests set status = 'received'
     where id = t.request_id and status in ('issued','in_transit');
  end if;
  if v_has_diff then
    perform public.internal_notify('receive_difference', 'اختلاف في استلام تحويل ' || t.transfer_no,
      'الكميات المستلمة تختلف عن المرسلة', 'stock_transfers', t.id, t.to_branch_id,
      array['warehouse_manager','head_office']);
  end if;
  return v_status::text;
end $$;

-- ===== مرتجع مبيعات =====
-- p = { invoice_id, refund_method_id, reason?, items: [{invoice_item_id, qty, condition?, reason?}] }
create or replace function public.fn_post_sales_return(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_inv public.sales_invoices%rowtype; v_shift public.shifts%rowtype;
  v_ret uuid; v_ret_no text; it jsonb; ii public.sales_invoice_items%rowtype;
  v_qty numeric; v_prev numeric; v_amt numeric; v_total numeric := 0; v_cond item_condition;
  v_method uuid := nullif(p ->> 'refund_method_id', '')::uuid; v_all boolean;
begin
  if not public.has_permission('returns','create') then raise exception 'FORBIDDEN'; end if;
  select * into v_inv from public.sales_invoices where id = (p ->> 'invoice_id')::uuid for update;
  if not found or v_inv.status = 'cancelled' then raise exception 'INVALID_INVOICE'; end if;
  if not public.can_access_branch(v_inv.branch_id) then raise exception 'FORBIDDEN_BRANCH'; end if;
  select * into v_shift from public.shifts where user_id = auth.uid() and status = 'open';
  if not found then raise exception 'NO_OPEN_SHIFT'; end if;
  if jsonb_array_length(coalesce(p -> 'items', '[]'::jsonb)) = 0 then raise exception 'EMPTY_RETURN'; end if;

  insert into public.sales_returns (invoice_id, branch_id, customer_id, shift_id, refund_method_id, reason, status, approved_by)
  values (v_inv.id, v_inv.branch_id, v_inv.customer_id, v_shift.id, v_method, p ->> 'reason', 'posted', auth.uid())
  returning id, return_no into v_ret, v_ret_no;

  for it in select * from jsonb_array_elements(p -> 'items') loop
    select * into ii from public.sales_invoice_items
     where id = (it ->> 'invoice_item_id')::uuid and invoice_id = v_inv.id;
    if not found then raise exception 'ITEM_NOT_IN_INVOICE'; end if;
    v_qty := (it ->> 'qty')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'INVALID_QTY'; end if;

    select coalesce(sum(sri.qty), 0) into v_prev
      from public.sales_return_items sri join public.sales_returns sr on sr.id = sri.return_id
     where sri.invoice_item_id = ii.id and sr.status = 'posted';
    if v_prev + v_qty > ii.qty then raise exception 'RETURN_EXCEEDS_SOLD'; end if;

    v_amt  := round(ii.line_total / ii.qty * v_qty, 2);
    v_cond := coalesce(nullif(it ->> 'condition', ''), 'resalable')::item_condition;

    insert into public.sales_return_items (return_id, invoice_item_id, product_id, qty, reason, condition, refund_amount)
    values (v_ret, ii.id, ii.product_id, v_qty, it ->> 'reason', v_cond, v_amt);

    if v_cond = 'resalable' then
      insert into public.stock_movements (branch_id, product_id, movement_type, qty_in, unit_cost, ref_type, ref_id)
      values (v_inv.branch_id, ii.product_id, 'sale_return', v_qty, ii.unit_cost, 'sales_returns', v_ret);
    else
      insert into public.damaged_items (branch_id, product_id, qty, unit_cost, reason, source_type, source_id)
      values (v_inv.branch_id, ii.product_id, v_qty, ii.unit_cost, coalesce(it ->> 'reason', p ->> 'reason'), 'sales_return', v_ret);
    end if;
    v_total := v_total + v_amt;
  end loop;

  update public.sales_returns set refund_amount = v_total where id = v_ret;

  if v_total > 0 then
    insert into public.cash_transactions (branch_id, shift_id, payment_method_id, tx_type, direction, amount, ref_type, ref_id)
    values (v_inv.branch_id, v_shift.id, v_method, 'refund', 'out', v_total, 'sales_returns', v_ret);
  end if;

  select not exists (
    select 1 from public.sales_invoice_items sii
     where sii.invoice_id = v_inv.id
       and sii.qty > coalesce((select sum(sri.qty)
                                 from public.sales_return_items sri
                                 join public.sales_returns sr on sr.id = sri.return_id
                                where sri.invoice_item_id = sii.id and sr.status = 'posted'), 0))
    into v_all;
  update public.sales_invoices
     set status = (case when v_all then 'returned' else 'partially_returned' end)::sale_status
   where id = v_inv.id;

  return jsonb_build_object('id', v_ret, 'return_no', v_ret_no, 'refund_amount', v_total);
end $$;

-- ===== بدء جرد (يعبّئ الكميات المسجلة بالنظام) =====
create or replace function public.fn_start_stock_count(p_branch uuid, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.has_permission('stock_counts','create') then raise exception 'FORBIDDEN'; end if;
  if not public.can_access_branch(p_branch) then raise exception 'FORBIDDEN_BRANCH'; end if;
  insert into public.stock_counts (branch_id, status, started_at, note)
  values (p_branch, 'in_progress', now(), p_note) returning id into v_id;
  insert into public.stock_count_items (count_id, product_id, system_qty)
  select v_id, product_id, qty_on_hand from public.stock_balances where branch_id = p_branch;
  return v_id;
end $$;

-- ===== اعتماد الجرد (توليد حركات التسوية) =====
create or replace function public.fn_approve_stock_count(p_count uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c public.stock_counts%rowtype; i public.stock_count_items%rowtype;
  v_cost numeric; v_net_value numeric := 0; v_n int := 0; v_sys numeric;
begin
  if not public.has_permission('stock_counts','approve') then raise exception 'FORBIDDEN'; end if;
  select * into c from public.stock_counts where id = p_count for update;
  if not found then raise exception 'COUNT_NOT_FOUND'; end if;
  if c.status <> 'in_progress' then raise exception 'INVALID_STATUS: %', c.status; end if;
  if not public.can_access_branch(c.branch_id) then raise exception 'FORBIDDEN_BRANCH'; end if;
  if exists (select 1 from public.stock_count_items where count_id = c.id and actual_qty is null) then
    raise exception 'COUNT_INCOMPLETE';
  end if;

  for i in select * from public.stock_count_items where count_id = c.id loop
    select qty_on_hand, avg_cost into v_sys, v_cost from public.stock_balances
     where branch_id = c.branch_id and product_id = i.product_id;
    v_cost := coalesce(v_cost, 0);
    -- الفرق الفعلي مقابل الرصيد الحالي (قد يكون تغيّر أثناء الجرد)
    if i.actual_qty <> coalesce(v_sys, 0) then
      if i.actual_qty > coalesce(v_sys, 0) then
        insert into public.stock_movements (branch_id, product_id, movement_type, qty_in, unit_cost, ref_type, ref_id, note)
        values (c.branch_id, i.product_id, 'count_adjustment', i.actual_qty - coalesce(v_sys, 0), v_cost, 'stock_counts', c.id, i.reason);
      else
        insert into public.stock_movements (branch_id, product_id, movement_type, qty_out, unit_cost, ref_type, ref_id, note)
        values (c.branch_id, i.product_id, 'count_adjustment', coalesce(v_sys, 0) - i.actual_qty, v_cost, 'stock_counts', c.id, i.reason);
      end if;
      v_n := v_n + 1;
    end if;
    update public.stock_count_items set diff_value = round((i.actual_qty - i.system_qty) * v_cost, 2) where id = i.id;
    v_net_value := v_net_value + (i.actual_qty - i.system_qty) * v_cost;
  end loop;

  update public.stock_counts set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = c.id;
  return jsonb_build_object('count_id', c.id, 'adjusted_items', v_n, 'net_diff_value', round(v_net_value, 2));
end $$;

-- ───────────────────────── 5) RLS (الأمان) ─────────────────────────
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end $$;

-- دالة مساعدة لإنشاء السياسات (تُحذف في نهاية هذا القسم)
create or replace function public._pol(p_table text, p_name text, p_cmd text,
                                       p_using text default null, p_check text default null)
returns void language plpgsql as $$
begin
  execute format('create policy %I on public.%I for %s to authenticated %s %s',
    p_name, p_table, p_cmd,
    case when p_using is not null then 'using (' || p_using || ')' else '' end,
    case when p_check is not null then 'with check (' || p_check || ')' else '' end);
end $$;

-- A) جداول مرجعية: قراءة لكل مستخدم مسجل، كتابة حسب صلاحية القسم
do $do$
declare r record;
begin
  for r in select * from (values
      ('categories','categories'), ('units','settings'), ('tax_rates','taxes'), ('products','products'),
      ('payment_methods','cashbox'), ('expense_categories','expenses'), ('income_types','income'),
      ('branches','branches'), ('roles','roles'), ('permissions','roles'), ('role_permissions','roles'),
      ('settings','settings'), ('company_profile','settings')
    ) as t(tbl, m)
  loop
    perform public._pol(r.tbl, 'sel', 'select', 'true');
    perform public._pol(r.tbl, 'ins', 'insert', null, format('public.has_permission(%L,%L)', r.m, 'create'));
    perform public._pol(r.tbl, 'upd', 'update', format('public.has_permission(%L,%L)', r.m, 'update'),
                                                  format('public.has_permission(%L,%L)', r.m, 'update'));
    perform public._pol(r.tbl, 'del', 'delete', format('public.has_permission(%L,%L)', r.m, 'delete'));
  end loop;
end $do$;

-- B) جداول محدودة بالفرع: القراءة حسب (الفرع + الصلاحية)
do $do$
declare r record;
begin
  for r in select * from (values
    ('stock_balances',     'branch_id', $e$public.has_permission('inventory','view') or public.has_permission('pos','view')$e$),
    ('stock_movements',    'branch_id', $e$public.has_permission('inventory','view')$e$),
    ('stock_counts',       'branch_id', $e$public.has_permission('stock_counts','view')$e$),
    ('damaged_items',      'branch_id', $e$public.has_permission('damaged','view')$e$),
    ('purchase_invoices',  'branch_id', $e$public.has_permission('purchases','view')$e$),
    ('purchase_returns',   'branch_id', $e$public.has_permission('purchases','view')$e$),
    ('stock_requests',     'branch_id', $e$public.has_permission('requests','view')$e$),
    ('shifts',             'branch_id', $e$public.has_permission('shifts','view') or user_id = auth.uid()$e$),
    ('sales_invoices',     'branch_id', $e$public.has_permission('sales','view') or public.has_permission('pos','view')$e$),
    ('customer_payments',  'branch_id', $e$public.has_permission('customers','view')$e$),
    ('sales_returns',      'branch_id', $e$public.has_permission('returns','view')$e$),
    ('exchanges',          'branch_id', $e$public.has_permission('exchanges','view')$e$),
    ('expenses',           'branch_id', $e$public.has_permission('expenses','view')$e$),
    ('other_incomes',      'branch_id', $e$public.has_permission('income','view')$e$),
    ('cash_transactions',  'branch_id', $e$public.has_permission('cashbox','view')$e$),
    ('branch_settlements', 'branch_id', $e$public.has_permission('branch_accounts','view')$e$),
    ('branch_ledger',      'branch_id', $e$public.has_permission('branch_accounts','view')$e$),
    ('payrolls',           'branch_id', $e$public.has_permission('payroll','view')$e$),
    ('commissions',        'branch_id', $e$public.has_permission('commissions','view')$e$),
    ('employees',          'branch_id', $e$public.has_permission('employees','view')
                                         or id = (select employee_id from public.profiles where id = auth.uid())$e$)
  ) as t(tbl, col, expr)
  loop
    perform public._pol(r.tbl, 'sel', 'select', format('public.can_access_branch(%I) and (%s)', r.col, r.expr));
  end loop;
end $do$;

-- التحويلات: يراها الفرع المرسل والمستلم
select public._pol('stock_transfers', 'sel', 'select',
  $e$(public.can_access_branch(from_branch_id) or public.can_access_branch(to_branch_id))
     and public.has_permission('transfers','view')$e$);

-- C) الجداول التابعة: تُقرأ إذا كان السجل الأب مرئياً (RLS الأب يُطبَّق تلقائياً)
do $do$
declare r record;
begin
  for r in select * from (values
    ('purchase_invoice_items','invoice_id','purchase_invoices'), ('purchase_return_items','return_id','purchase_returns'),
    ('stock_request_items','request_id','stock_requests'), ('stock_request_status_log','request_id','stock_requests'),
    ('stock_transfer_items','transfer_id','stock_transfers'), ('stock_count_items','count_id','stock_counts'),
    ('sales_invoice_items','invoice_id','sales_invoices'), ('sales_payments','invoice_id','sales_invoices'),
    ('sales_return_items','return_id','sales_returns'), ('exchange_items','exchange_id','exchanges')
  ) as t(child, fk, parent)
  loop
    perform public._pol(r.child, 'sel', 'select',
      format('exists (select 1 from public.%I p where p.id = %I)', r.parent, r.fk));
  end loop;
end $do$;

-- D) كتابة مباشرة مسموحة (باقي العمليات الحرجة تمر عبر دوال fn_* فقط)
-- المصروفات والإيرادات
select public._pol('expenses', 'ins', 'insert', null,
  $e$public.has_permission('expenses','create') and public.can_access_branch(branch_id)$e$);
select public._pol('expenses', 'upd', 'update',
  $e$public.has_permission('expenses','update') and public.can_access_branch(branch_id)$e$,
  $e$public.has_permission('expenses','update') and public.can_access_branch(branch_id)$e$);
select public._pol('other_incomes', 'ins', 'insert', null,
  $e$public.has_permission('income','create') and public.can_access_branch(branch_id)$e$);
select public._pol('other_incomes', 'upd', 'update',
  $e$public.has_permission('income','update') and public.can_access_branch(branch_id)$e$,
  $e$public.has_permission('income','update') and public.can_access_branch(branch_id)$e$);

-- تسويات الفروع (الاعتماد يتحقق منه الـ trigger بصلاحية approve)
select public._pol('branch_settlements', 'ins', 'insert', null,
  $e$public.has_permission('branch_accounts','create') and public.can_access_branch(branch_id)$e$);
select public._pol('branch_settlements', 'upd', 'update',
  $e$public.has_permission('branch_accounts','update') and public.can_access_branch(branch_id) and status = 'pending'$e$,
  $e$public.has_permission('branch_accounts','update') and public.can_access_branch(branch_id)$e$);

-- التالف اليدوي وتحصيل العملاء
select public._pol('damaged_items', 'ins', 'insert', null,
  $e$public.has_permission('damaged','create') and public.can_access_branch(branch_id) and source_type = 'manual'$e$);
select public._pol('customer_payments', 'ins', 'insert', null,
  $e$public.has_permission('customers','update') and public.can_access_branch(branch_id)$e$);

-- طلبات البضاعة: الفرع ينشئ ويعدّل طالما الحالة "جديد"
select public._pol('stock_requests', 'ins', 'insert', null,
  $e$public.has_permission('requests','create') and public.can_access_branch(branch_id) and status = 'new'$e$);
select public._pol('stock_requests', 'upd', 'update',
  $e$public.has_permission('requests','update') and public.can_access_branch(branch_id) and status = 'new'$e$,
  $e$public.has_permission('requests','update') and public.can_access_branch(branch_id) and status = 'new'$e$);
select public._pol('stock_request_items', 'ins', 'insert', null,
  $e$public.has_permission('requests','create')
     and exists (select 1 from public.stock_requests r where r.id = request_id and r.status = 'new')$e$);
select public._pol('stock_request_items', 'upd', 'update',
  $e$public.has_permission('requests','update')
     and exists (select 1 from public.stock_requests r where r.id = request_id and r.status = 'new')$e$,
  $e$exists (select 1 from public.stock_requests r where r.id = request_id and r.status = 'new')$e$);
select public._pol('stock_request_items', 'del', 'delete',
  $e$public.has_permission('requests','update')
     and exists (select 1 from public.stock_requests r where r.id = request_id and r.status = 'new')$e$);

-- الجرد: تعديل الكميات الفعلية أثناء الجرد فقط
select public._pol('stock_count_items', 'upd', 'update',
  $e$public.has_permission('stock_counts','update')
     and exists (select 1 from public.stock_counts c where c.id = count_id and c.status = 'in_progress')$e$,
  $e$exists (select 1 from public.stock_counts c where c.id = count_id and c.status = 'in_progress')$e$);

-- الموردون والعملاء
select public._pol('suppliers', 'sel', 'select', $e$public.has_permission('suppliers','view') or public.has_permission('purchases','view')$e$);
select public._pol('suppliers', 'ins', 'insert', null, $e$public.has_permission('suppliers','create')$e$);
select public._pol('suppliers', 'upd', 'update', $e$public.has_permission('suppliers','update')$e$, $e$public.has_permission('suppliers','update')$e$);
select public._pol('customers', 'sel', 'select', $e$public.has_permission('customers','view') or public.has_permission('pos','create')$e$);
select public._pol('customers', 'ins', 'insert', null, $e$public.has_permission('customers','create') or public.has_permission('pos','create')$e$);
select public._pol('customers', 'upd', 'update', $e$public.has_permission('customers','update')$e$, $e$public.has_permission('customers','update')$e$);
select public._pol('supplier_payments', 'sel', 'select', $e$public.has_permission('suppliers','view') or public.has_permission('purchases','view')$e$);
select public._pol('supplier_payments', 'ins', 'insert', null, $e$public.has_permission('purchases','update')$e$);

-- مرتجعات المشتريات (مسودات فقط؛ ترحيلها بدالة لاحقة)
select public._pol('purchase_returns', 'ins', 'insert', null,
  $e$public.has_permission('purchases','create') and public.can_access_branch(branch_id) and status = 'draft'$e$);
select public._pol('purchase_returns', 'upd', 'update',
  $e$public.has_permission('purchases','update') and public.can_access_branch(branch_id) and status = 'draft'$e$,
  $e$public.can_access_branch(branch_id) and status = 'draft'$e$);
select public._pol('purchase_return_items', 'ins', 'insert', null,
  $e$public.has_permission('purchases','create')
     and exists (select 1 from public.purchase_returns r where r.id = return_id and r.status = 'draft')$e$);

-- الموظفون والرواتب
select public._pol('employees', 'ins', 'insert', null,
  $e$public.has_permission('employees','create') and public.can_access_branch(branch_id)$e$);
select public._pol('employees', 'upd', 'update',
  $e$public.has_permission('employees','update') and public.can_access_branch(branch_id)$e$,
  $e$public.has_permission('employees','update') and public.can_access_branch(branch_id)$e$);
select public._pol('payroll_periods', 'sel', 'select', $e$public.has_permission('payroll','view')$e$);
select public._pol('payroll_periods', 'ins', 'insert', null, $e$public.has_permission('payroll','create')$e$);
select public._pol('payroll_periods', 'upd', 'update', $e$public.has_permission('payroll','update')$e$, $e$public.has_permission('payroll','update')$e$);
select public._pol('payrolls', 'ins', 'insert', null, $e$public.has_permission('payroll','create') and public.can_access_branch(branch_id)$e$);
select public._pol('payrolls', 'upd', 'update',
  $e$public.has_permission('payroll','update') and public.can_access_branch(branch_id)$e$,
  $e$public.has_permission('payroll','update') and public.can_access_branch(branch_id)$e$);
select public._pol('employee_adjustments', 'sel', 'select', $e$public.has_permission('payroll','view') or public.has_permission('employees','view')$e$);
select public._pol('employee_adjustments', 'ins', 'insert', null, $e$public.has_permission('payroll','create')$e$);
select public._pol('employee_adjustments', 'upd', 'update', $e$public.has_permission('payroll','update')$e$, $e$public.has_permission('payroll','update')$e$);
select public._pol('commissions', 'ins', 'insert', null, $e$public.has_permission('commissions','create') and public.can_access_branch(branch_id)$e$);
select public._pol('commissions', 'upd', 'update',
  $e$public.has_permission('commissions','update') and public.can_access_branch(branch_id)$e$,
  $e$public.has_permission('commissions','update') and public.can_access_branch(branch_id)$e$);

-- المستخدمون
select public._pol('profiles', 'sel', 'select', $e$id = auth.uid() or public.has_permission('users','view')$e$);
select public._pol('profiles', 'ins', 'insert', null, $e$public.has_permission('users','create')$e$);
select public._pol('profiles', 'upd', 'update', $e$public.has_permission('users','update')$e$, $e$public.has_permission('users','update')$e$);

-- سجل العمليات والإشعارات وطلبات الاعتماد
select public._pol('audit_logs', 'sel', 'select', $e$public.has_permission('audit','view')$e$);
select public._pol('notifications', 'sel', 'select',
  $e$user_id = auth.uid()
     or (role_id = (select role_id from public.profiles where id = auth.uid())
         and (branch_id is null or public.can_access_branch(branch_id)))
     or (user_id is null and role_id is null and branch_id = public.auth_branch_id())$e$);
select public._pol('notifications', 'upd', 'update',
  $e$user_id = auth.uid()
     or (role_id = (select role_id from public.profiles where id = auth.uid())
         and (branch_id is null or public.can_access_branch(branch_id)))$e$,
  $e$true$e$);
select public._pol('approval_requests', 'sel', 'select', $e$requested_by = auth.uid() or public.has_permission('settings','approve')$e$);
select public._pol('approval_requests', 'ins', 'insert', null, $e$requested_by = auth.uid()$e$);
select public._pol('approval_requests', 'upd', 'update', $e$public.has_permission('settings','approve')$e$, $e$public.has_permission('settings','approve')$e$);

drop function public._pol(text, text, text, text, text);
-- ملاحظة: document_sequences بلا سياسات عمداً (لا وصول إلا من الدوال).
-- ملاحظة: sales_*، stock_movements، cash_transactions، branch_ledger لا تقبل كتابة مباشرة، فقط عبر fn_*.

-- ───────────────────────── 6) Views للتقارير ولوحة التحكم ─────────────────────────
-- security_invoker: تُطبَّق سياسات RLS الخاصة بالمستخدم الذي يستعلم من الـ View.

create view public.v_stock_status with (security_invoker = true) as
select sb.branch_id, b.name as branch_name, sb.product_id, p.name as product_name, p.barcode, p.sku,
       p.category_id, sb.qty_on_hand, sb.qty_reserved, sb.qty_on_hand - sb.qty_reserved as qty_available,
       sb.avg_cost, round(sb.qty_on_hand * sb.avg_cost, 2) as stock_value,
       p.min_stock, (p.min_stock > 0 and sb.qty_on_hand <= p.min_stock) as is_low, (sb.qty_on_hand = 0) as is_out
from public.stock_balances sb
join public.products p on p.id = sb.product_id
join public.branches b on b.id = sb.branch_id;

create view public.v_low_stock with (security_invoker = true) as
select * from public.v_stock_status where is_low or is_out;

create view public.v_sales_daily with (security_invoker = true) as
select branch_id, invoice_date::date as day, count(*) as invoices_count,
       sum(subtotal) as subtotal, sum(discount) as discount, sum(tax_amount) as tax, sum(total) as total
from public.sales_invoices where status <> 'cancelled'
group by branch_id, invoice_date::date;

create view public.v_top_products with (security_invoker = true) as
select si.branch_id, sii.product_id, p.name as product_name,
       sum(sii.qty) as qty_sold, sum(sii.line_total) as revenue,
       sum(sii.line_total - sii.qty * sii.unit_cost) as gross_margin
from public.sales_invoice_items sii
join public.sales_invoices si on si.id = sii.invoice_id and si.status <> 'cancelled'
join public.products p on p.id = sii.product_id
group by si.branch_id, sii.product_id, p.name;

create view public.v_sales_by_employee with (security_invoker = true) as
select si.branch_id, si.sold_by as employee_id, e.full_name,
       date_trunc('month', si.invoice_date)::date as month,
       count(*) as invoices_count, sum(si.total) as total_sales
from public.sales_invoices si
left join public.employees e on e.id = si.sold_by
where si.status <> 'cancelled'
group by si.branch_id, si.sold_by, e.full_name, date_trunc('month', si.invoice_date);

create view public.v_supplier_balance with (security_invoker = true) as
select t.*, t.opening_balance + t.total_purchases - t.total_paid - t.total_returns as balance
from (
  select s.id as supplier_id, s.name, s.phone, s.opening_balance,
    coalesce((select sum(total) from public.purchase_invoices pi where pi.supplier_id = s.id and pi.status = 'posted'), 0) as total_purchases,
    coalesce((select sum(amount) from public.supplier_payments sp where sp.supplier_id = s.id), 0) as total_paid,
    coalesce((select sum(total) from public.purchase_returns pr where pr.supplier_id = s.id and pr.status = 'posted'), 0) as total_returns
  from public.suppliers s) t;

create view public.v_customer_balance with (security_invoker = true) as
select c.id as customer_id, c.name, c.phone, c.opening_balance,
  coalesce(x.total_sales, 0) as total_sales, coalesce(x.total_paid, 0) as total_paid,
  c.opening_balance + coalesce(x.due, 0) as balance_due
from public.customers c
left join (
  select customer_id, sum(total) as total_sales, sum(paid_amount) as total_paid, sum(remaining) as due
  from public.sales_invoices where status <> 'cancelled' and customer_id is not null group by customer_id) x
  on x.customer_id = c.id;

-- رصيد الفرع مع الإدارة: موجب = على الفرع للإدارة
create view public.v_branch_balance with (security_invoker = true) as
select b.id as branch_id, b.name as branch_name,
       coalesce(sum(l.debit), 0) as goods_received, coalesce(sum(l.credit), 0) as settled,
       coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0) as balance
from public.branches b
left join public.branch_ledger l on l.branch_id = b.id
where b.type = 'branch'
group by b.id, b.name;

-- الأرباح والخسائر لكل فرع وشهر
-- ملاحظات: المرتجعات بقيمة المبلغ المسترد (شاملة الضريبة)، والتكلفة = متوسط التكلفة وقت البيع.
create view public.v_branch_pnl with (security_invoker = true) as
select t.*,
       t.gross_sales - t.discounts - t.returns_value as net_sales,
       (t.gross_sales - t.discounts - t.returns_value) - t.cogs as gross_profit,
       (t.gross_sales - t.discounts - t.returns_value) - t.cogs - t.total_expenses + t.other_income as net_profit
from (
  with sales as (
    select branch_id, date_trunc('month', invoice_date)::date as month,
           sum(subtotal) as gross_sales, sum(discount) as discounts, sum(tax_amount) as sales_tax
    from public.sales_invoices where status <> 'cancelled' group by 1, 2),
  cogs as (
    select si.branch_id, date_trunc('month', si.invoice_date)::date as month, sum(sii.qty * sii.unit_cost) as cogs
    from public.sales_invoice_items sii join public.sales_invoices si on si.id = sii.invoice_id
    where si.status <> 'cancelled' group by 1, 2),
  rets as (
    select branch_id, date_trunc('month', return_date)::date as month, sum(refund_amount) as returns_value
    from public.sales_returns where status = 'posted' group by 1, 2),
  retcost as (
    select sr.branch_id, date_trunc('month', sr.return_date)::date as month, sum(sri.qty * sii.unit_cost) as returned_cost
    from public.sales_return_items sri
    join public.sales_returns sr on sr.id = sri.return_id
    join public.sales_invoice_items sii on sii.id = sri.invoice_item_id
    where sr.status = 'posted' and sri.condition = 'resalable' group by 1, 2),
  exp as (
    select e.branch_id, date_trunc('month', e.expense_date)::date as month,
           sum(e.amount) filter (where c.kind = 'salary')      as salaries,
           sum(e.amount) filter (where c.kind = 'commission')  as commissions,
           sum(e.amount) filter (where c.kind = 'rent')        as rent,
           sum(e.amount) filter (where c.kind = 'electricity') as electricity,
           sum(e.amount) filter (where c.kind = 'water')       as water,
           sum(e.amount) filter (where c.kind = 'internet')    as internet,
           sum(e.amount) filter (where c.kind = 'other')       as other_expenses,
           sum(e.amount) as total_expenses
    from public.expenses e join public.expense_categories c on c.id = e.category_id
    where e.status = 'posted' group by 1, 2),
  inc as (
    select branch_id, date_trunc('month', income_date)::date as month, sum(amount) as other_income
    from public.other_incomes group by 1, 2),
  keys as (
    select branch_id, month from sales union select branch_id, month from rets
    union select branch_id, month from exp union select branch_id, month from inc)
  select k.branch_id, k.month,
         coalesce(s.gross_sales, 0) as gross_sales, coalesce(s.discounts, 0) as discounts,
         coalesce(s.sales_tax, 0) as sales_tax, coalesce(r.returns_value, 0) as returns_value,
         coalesce(c.cogs, 0) - coalesce(rc.returned_cost, 0) as cogs,
         coalesce(x.salaries, 0) as salaries, coalesce(x.commissions, 0) as commissions,
         coalesce(x.rent, 0) as rent, coalesce(x.electricity, 0) as electricity, coalesce(x.water, 0) as water,
         coalesce(x.internet, 0) as internet, coalesce(x.other_expenses, 0) as other_expenses,
         coalesce(x.total_expenses, 0) as total_expenses, coalesce(i.other_income, 0) as other_income
  from keys k
  left join sales s   on s.branch_id = k.branch_id and s.month = k.month
  left join cogs c    on c.branch_id = k.branch_id and c.month = k.month
  left join rets r    on r.branch_id = k.branch_id and r.month = k.month
  left join retcost rc on rc.branch_id = k.branch_id and rc.month = k.month
  left join exp x     on x.branch_id = k.branch_id and x.month = k.month
  left join inc i     on i.branch_id = k.branch_id and i.month = k.month
) t;

-- مؤشرات لوحة التحكم لكل فرع
-- ملاحظة: "اليوم/الشهر" حسب منطقة توقيت قاعدة البيانات (UTC افتراضياً في Supabase).
-- لضبطها: alter database postgres set timezone to 'Asia/Riyadh';  (غيّرها لمنطقتكم)
create view public.v_dashboard_kpis with (security_invoker = true) as
select b.id as branch_id, b.name as branch_name, b.type,
  coalesce((select sum(total) from public.sales_invoices s where s.branch_id = b.id and s.status <> 'cancelled'
            and s.invoice_date >= date_trunc('day', now())), 0) as sales_today,
  coalesce((select sum(total) from public.sales_invoices s where s.branch_id = b.id and s.status <> 'cancelled'
            and s.invoice_date >= date_trunc('month', now())), 0) as sales_month,
  coalesce((select sum(total) from public.purchase_invoices pi where pi.branch_id = b.id and pi.status = 'posted'
            and pi.invoice_date >= date_trunc('month', now())::date), 0) as purchases_month,
  coalesce((select sum(amount) from public.expenses e where e.branch_id = b.id and e.status = 'posted'
            and e.expense_date >= date_trunc('month', now())::date), 0) as expenses_month,
  coalesce((select sum(qty_on_hand * avg_cost) from public.stock_balances sb where sb.branch_id = b.id), 0) as stock_value,
  coalesce((select sum(remaining) from public.sales_invoices s where s.branch_id = b.id and s.status <> 'cancelled'), 0) as customers_due,
  coalesce((select sum(debit - credit) from public.branch_ledger l where l.branch_id = b.id), 0) as branch_balance
from public.branches b
where b.is_active;

-- ───────────────────────── 7) Storage + Realtime + الصلاحيات التنفيذية ─────────────────────────
insert into storage.buckets (id, name, public) values
  ('product-images', 'product-images', true),
  ('attachments',    'attachments',    false)
on conflict (id) do nothing;

create policy "product_images_read"   on storage.objects for select to authenticated
  using (bucket_id = 'product-images');
create policy "product_images_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and public.has_permission('products','update'));
create policy "product_images_update" on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and public.has_permission('products','update'));
create policy "product_images_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and public.has_permission('products','update'));
create policy "attachments_all" on storage.objects for all to authenticated
  using (bucket_id = 'attachments') with check (bucket_id = 'attachments');

do $$
begin
  alter publication supabase_realtime add table
    public.stock_balances, public.stock_requests, public.stock_transfers, public.notifications;
exception when others then
  raise notice 'تعذّر تفعيل Realtime تلقائياً (%). فعّله من Database > Replication.', sqlerrm;
end $$;

-- صلاحيات تنفيذ الدوال: الدوال الداخلية مغلقة، ودوال fn_* للمستخدمين المسجلين فقط
revoke all on function public.internal_next_doc_no(text, uuid) from public, anon, authenticated;
revoke all on function public.internal_notify(text, text, text, text, uuid, uuid, text[]) from public, anon, authenticated;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like 'fn\_%' or p.proname in ('auth_branch_id','is_super_admin','sees_all_branches','can_access_branch','has_permission'))
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;

-- ───────────────────────── البيانات الأولية (Seed) ─────────────────────────
-- الأدوار
insert into public.roles (code, name, description, is_system, all_branches) values
  ('super_admin',       'مدير النظام',     'صلاحيات كاملة',                         true,  true),
  ('head_office',       'الإدارة الرئيسية', 'إدارة كل الفروع والمخزن',                true,  true),
  ('accountant',        'المحاسب',         'الحسابات والمالية والتقارير',            true,  true),
  ('warehouse_manager', 'مدير المخزن',     'المخزن الرئيسي والطلبات والتحويلات',     true,  true),
  ('branch_manager',    'مدير الفرع',      'إدارة فرع واحد',                         true,  false),
  ('sales_staff',       'موظف المبيعات',   'نقطة البيع والوردية',                    true,  false)
on conflict (code) do nothing;

-- كتالوج الصلاحيات: الأقسام × الإجراءات
insert into public.permissions (module, action)
select m, a
from unnest(array['dashboard','products','categories','inventory','requests','transfers','stock_counts','damaged',
                  'suppliers','purchases','pos','sales','customers','returns','exchanges','shifts',
                  'expenses','income','cashbox','branch_accounts','taxes','profit_loss',
                  'employees','payroll','commissions','reports','branches','users','roles','audit','settings']) as m
cross join unnest(array['view','create','update','delete','print','export','approve','cancel']) as a
on conflict do nothing;

-- مدير النظام والإدارة الرئيسية: كل الصلاحيات
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.code in ('super_admin','head_office')
on conflict do nothing;

-- المحاسب
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on (
     (p.module in ('dashboard','products','inventory','requests','transfers','stock_counts','damaged','sales',
                   'customers','returns','exchanges','shifts','branches','employees','reports')
        and p.action in ('view','print','export'))
  or (p.module in ('expenses','income','cashbox','branch_accounts','taxes','profit_loss','payroll',
                   'commissions','purchases','suppliers')
        and p.action in ('view','create','update','print','export','approve','cancel')))
where r.code = 'accountant'
on conflict do nothing;

-- مدير المخزن
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on (
     (p.module in ('products','categories','inventory','requests','transfers','stock_counts','damaged','suppliers','purchases')
        and p.action in ('view','create','update','print','export','approve'))
  or (p.module in ('dashboard','reports','branches','branch_accounts') and p.action in ('view','print','export')))
where r.code = 'warehouse_manager'
on conflict do nothing;

-- مدير الفرع
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on (
     (p.module in ('dashboard','products','inventory','sales','reports','cashbox','branch_accounts','profit_loss',
                   'employees','commissions') and p.action in ('view','print','export'))
  or (p.module in ('pos','customers','returns','exchanges','shifts','requests','damaged','stock_counts','expenses','income')
        and p.action in ('view','create','update','print'))
  or (p.module = 'returns' and p.action = 'approve')
  or (p.module = 'shifts'  and p.action = 'approve')
  or (p.module = 'transfers' and p.action in ('view','update')))
where r.code = 'branch_manager'
on conflict do nothing;

-- موظف المبيعات
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r
join (values ('products','view'), ('pos','view'), ('pos','create'), ('sales','view'), ('sales','print'),
             ('customers','view'), ('customers','create'), ('returns','view'), ('returns','create'),
             ('shifts','view'), ('shifts','create')) v(m, a) on true
join public.permissions p on p.module = v.m and p.action = v.a
where r.code = 'sales_staff'
on conflict do nothing;

-- المخزن الرئيسي (موقع المخزون المركزي)
insert into public.branches (code, name, type) values ('MAIN', 'المخزن الرئيسي', 'main_warehouse')
on conflict (code) do nothing;

insert into public.company_profile (name, invoice_footer)
select 'هاشم للطيب والعطور', 'شكراً لتسوقكم معنا'
where not exists (select 1 from public.company_profile);

insert into public.units (name, abbreviation) values ('قطعة','قطعة'), ('علبة','علبة'), ('مل','مل'), ('جرام','جم')
on conflict (name) do nothing;

insert into public.categories (name, sort_order) values ('العطور',1), ('البخور',2), ('المرشات',3), ('البكسات',4)
on conflict (name) do nothing;

insert into public.payment_methods (name, type, is_cash)
select * from (values ('نقدي','cash'::payment_method_type,true),
                      ('تحويل','transfer'::payment_method_type,false),
                      ('حساب بنكي','bank'::payment_method_type,false)) v(name,type,is_cash)
where not exists (select 1 from public.payment_methods);

insert into public.tax_rates (name, rate, applies_to)
select 'بدون ضريبة', 0, 'both' where not exists (select 1 from public.tax_rates);
-- أضف نسبة الضريبة الفعلية من شاشة الضرائب ثم اربطها بالمنتجات.

insert into public.expense_categories (name, kind) values
  ('رواتب','salary'), ('إيجارات','rent'), ('كهرباء','electricity'), ('ماء','water'),
  ('إنترنت','internet'), ('عمولات الموظفين','commission'), ('مصروفات تشغيلية أخرى','other')
on conflict (name) do nothing;

insert into public.income_types (name) values ('إيرادات أخرى') on conflict (name) do nothing;

insert into public.settings (key, value) values
  ('commission.mode',     '{"basis":"net_sales","type":"flat"}'),
  ('invoice.print',       '{"paper":"80mm"}'),
  ('sales.allow_credit',  '{"value":true}'),
  ('inventory.allow_negative', '{"value":false}')
on conflict do nothing;

-- ===================================================================
--  إنشاء أول مدير للنظام (نفّذ يدوياً بعد إنشاء مستخدم من Authentication > Users):
--
--  insert into public.profiles (id, branch_id, role_id, username, full_name)
--  select '<ضع هنا UUID المستخدم>', b.id, r.id, 'admin', 'مدير النظام'
--  from public.branches b, public.roles r
--  where b.type = 'main_warehouse' and r.code = 'super_admin';
--
--  تسجيل الدخول باسم المستخدم أو الهاتف: Supabase Auth يعتمد البريد، لذا أنشئ لكل
--  مستخدم بريداً داخلياً مثل  username@hashim.local  وحوّل اسم المستخدم إليه في الواجهة.
-- ===================================================================
