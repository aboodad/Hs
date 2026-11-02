-- =====================================================================
--  هاشم للطيب والعطور — الإعداد الكامل لقاعدة البيانات في ملف واحد
--  ملف مولَّد تلقائياً من supabase/migrations — لا تعدّله يدوياً
--  أعد توليده بالأمر:  node scripts/build-full-setup.mjs
--  الصقه في Supabase > SQL Editor ونفّذه مرة واحدة على مشروع جديد فارغ
-- =====================================================================


-- ###################### 1) 20260101000000_schema.sql ######################
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


-- ###################### 2) 20260101000100_patch_01.sql ######################
-- تصحيح مطلوب للواجهات: علاقة created_by في طلبات البضاعة (تُستخدم لعرض "من أنشأ الطلب")
-- شغّله مرة واحدة بعد ملف hashim_erp_schema.sql
alter table public.stock_requests
  add constraint fk_requests_created_by
  foreign key (created_by) references public.profiles(id) on delete set null;


-- ###################### 3) 20260101000200_patch_02.sql ######################
-- =====================================================================
--  تصحيح 02: الدوال الناقصة لإكمال الصفحات
--  شغّله بعد hashim_erp_schema.sql و supabase_patch_01.sql
--  يضيف: الاستبدال، مرتجع الشراء، العمولات، الرواتب (حساب/اعتماد/صرف)
-- =====================================================================

-- ───────── 1) تتبّع بند الفاتورة في الاستبدال + منع تجاوز الكمية المباعة ─────────
alter table public.exchange_items
  add column if not exists invoice_item_id uuid references public.sales_invoice_items(id);

-- مجموع ما أُرجع من بند فاتورة عبر المرتجعات والاستبدالات لا يتجاوز المباع
create or replace function public.trg_check_returned_qty() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_sold numeric; v_prev numeric;
begin
  if new.invoice_item_id is null then return new; end if;
  if tg_table_name = 'exchange_items' and new.direction <> 'returned' then return new; end if;

  select qty into v_sold from public.sales_invoice_items where id = new.invoice_item_id;
  select
    coalesce((select sum(sri.qty) from public.sales_return_items sri
                join public.sales_returns sr on sr.id = sri.return_id
               where sri.invoice_item_id = new.invoice_item_id and sr.status = 'posted'), 0)
  + coalesce((select sum(ei.qty) from public.exchange_items ei
                join public.exchanges ex on ex.id = ei.exchange_id
               where ei.invoice_item_id = new.invoice_item_id and ei.direction = 'returned' and ex.status = 'posted'), 0)
  into v_prev;

  -- في جدول sales_return_items الصف الجديد غير محسوب بعد (BEFORE INSERT)
  if v_prev + new.qty > v_sold then raise exception 'RETURN_EXCEEDS_SOLD'; end if;
  return new;
end $$;

drop trigger if exists check_returned_qty on public.exchange_items;
create trigger check_returned_qty before insert on public.exchange_items
  for each row execute function public.trg_check_returned_qty();
drop trigger if exists check_returned_qty on public.sales_return_items;
create trigger check_returned_qty before insert on public.sales_return_items
  for each row execute function public.trg_check_returned_qty();

-- ───────── 2) الاستبدال ─────────
-- p = { invoice_id, settlement_method_id?, note?,
--       returned: [{invoice_item_id, qty, condition?}],
--       given:    [{product_id, qty, unit_price?}] }
-- difference > 0 : على العميل يدفعه | < 0 : يُرد للعميل
create or replace function public.fn_post_exchange(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_inv public.sales_invoices%rowtype; v_shift public.shifts%rowtype;
  v_ex uuid; v_ex_no text; it jsonb; ii public.sales_invoice_items%rowtype;
  v_prod public.products%rowtype; v_bal public.stock_balances%rowtype;
  v_qty numeric; v_price numeric; v_rate numeric; v_line numeric; v_cond item_condition;
  v_ret_total numeric := 0; v_new_total numeric := 0; v_diff numeric;
  v_method uuid := nullif(p ->> 'settlement_method_id', '')::uuid;
begin
  if not public.has_permission('exchanges','create') then raise exception 'FORBIDDEN'; end if;
  select * into v_inv from public.sales_invoices where id = (p ->> 'invoice_id')::uuid for update;
  if not found or v_inv.status = 'cancelled' then raise exception 'INVALID_INVOICE'; end if;
  if not public.can_access_branch(v_inv.branch_id) then raise exception 'FORBIDDEN_BRANCH'; end if;
  select * into v_shift from public.shifts where user_id = auth.uid() and status = 'open';
  if not found then raise exception 'NO_OPEN_SHIFT'; end if;
  if jsonb_array_length(coalesce(p -> 'returned', '[]'::jsonb)) = 0
     or jsonb_array_length(coalesce(p -> 'given', '[]'::jsonb)) = 0 then
    raise exception 'EXCHANGE_NEEDS_BOTH_SIDES';
  end if;

  insert into public.exchanges (original_invoice_id, branch_id, customer_id, shift_id, settlement_method_id, status)
  values (v_inv.id, v_inv.branch_id, v_inv.customer_id, v_shift.id, v_method, 'posted')
  returning id, exchange_no into v_ex, v_ex_no;

  -- المنتجات المُرجَعة
  for it in select * from jsonb_array_elements(p -> 'returned') loop
    select * into ii from public.sales_invoice_items
     where id = (it ->> 'invoice_item_id')::uuid and invoice_id = v_inv.id;
    if not found then raise exception 'ITEM_NOT_IN_INVOICE'; end if;
    v_qty := (it ->> 'qty')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'INVALID_QTY'; end if;
    v_cond := coalesce(nullif(it ->> 'condition', ''), 'resalable')::item_condition;
    v_line := round(ii.line_total / ii.qty * v_qty, 2);

    insert into public.exchange_items (exchange_id, direction, product_id, qty, unit_price, condition, invoice_item_id)
    values (v_ex, 'returned', ii.product_id, v_qty, round(ii.line_total / ii.qty, 2), v_cond, ii.id);

    if v_cond = 'resalable' then
      insert into public.stock_movements (branch_id, product_id, movement_type, qty_in, unit_cost, ref_type, ref_id)
      values (v_inv.branch_id, ii.product_id, 'exchange_in', v_qty, ii.unit_cost, 'exchanges', v_ex);
    else
      insert into public.damaged_items (branch_id, product_id, qty, unit_cost, reason, source_type, source_id)
      values (v_inv.branch_id, ii.product_id, v_qty, ii.unit_cost, 'استبدال - تالف', 'sales_return', v_ex);
    end if;
    v_ret_total := v_ret_total + v_line;
  end loop;

  -- المنتجات البديلة
  for it in select * from jsonb_array_elements(p -> 'given') loop
    select * into v_prod from public.products where id = (it ->> 'product_id')::uuid and is_active;
    if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
    v_qty := (it ->> 'qty')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'INVALID_QTY'; end if;
    v_price := coalesce((it ->> 'unit_price')::numeric, v_prod.retail_price);
    v_rate := coalesce((select rate from public.tax_rates where id = v_prod.tax_rate_id and is_active), 0);

    select * into v_bal from public.stock_balances
     where branch_id = v_inv.branch_id and product_id = v_prod.id for update;
    if not found or (v_bal.qty_on_hand - v_bal.qty_reserved) < v_qty then
      raise exception 'INSUFFICIENT_STOCK: %', v_prod.name;
    end if;

    insert into public.exchange_items (exchange_id, direction, product_id, qty, unit_price, condition)
    values (v_ex, 'given', v_prod.id, v_qty, v_price, 'resalable');
    insert into public.stock_movements (branch_id, product_id, movement_type, qty_out, unit_cost, ref_type, ref_id)
    values (v_inv.branch_id, v_prod.id, 'exchange_out', v_qty, v_bal.avg_cost, 'exchanges', v_ex);

    v_new_total := v_new_total + v_qty * v_price + round(v_qty * v_price * v_rate / 100, 2);
  end loop;

  v_ret_total := round(v_ret_total, 2); v_new_total := round(v_new_total, 2);
  v_diff := v_new_total - v_ret_total;

  update public.exchanges set returned_total = v_ret_total, new_total = v_new_total, difference = v_diff where id = v_ex;

  if v_diff > 0 then
    insert into public.cash_transactions (branch_id, shift_id, payment_method_id, tx_type, direction, amount, ref_type, ref_id)
    values (v_inv.branch_id, v_shift.id, v_method, 'sale', 'in', v_diff, 'exchanges', v_ex);
  elsif v_diff < 0 then
    insert into public.cash_transactions (branch_id, shift_id, payment_method_id, tx_type, direction, amount, ref_type, ref_id)
    values (v_inv.branch_id, v_shift.id, v_method, 'refund', 'out', abs(v_diff), 'exchanges', v_ex);
  end if;

  update public.sales_invoices set status = 'partially_returned' where id = v_inv.id and status = 'completed';

  return jsonb_build_object('id', v_ex, 'exchange_no', v_ex_no, 'returned_total', v_ret_total,
                            'new_total', v_new_total, 'difference', v_diff);
end $$;

-- ───────── 3) مرتجع مشتريات (ترحيل مباشر) ─────────
-- p = { invoice_id, reason?, items: [{product_id, qty}] }
create or replace function public.fn_post_purchase_return(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_inv public.purchase_invoices%rowtype; v_ret uuid; v_no text; it jsonb;
  v_pi public.purchase_invoice_items%rowtype; v_qty numeric; v_prev numeric; v_cost numeric;
  v_total numeric := 0;
begin
  if not public.has_permission('purchases','update') then raise exception 'FORBIDDEN'; end if;
  select * into v_inv from public.purchase_invoices where id = (p ->> 'invoice_id')::uuid for update;
  if not found or v_inv.status <> 'posted' then raise exception 'INVALID_INVOICE'; end if;
  if not public.can_access_branch(v_inv.branch_id) then raise exception 'FORBIDDEN_BRANCH'; end if;
  if jsonb_array_length(coalesce(p -> 'items', '[]'::jsonb)) = 0 then raise exception 'EMPTY_RETURN'; end if;

  insert into public.purchase_returns (invoice_id, supplier_id, branch_id, reason, status)
  values (v_inv.id, v_inv.supplier_id, v_inv.branch_id, p ->> 'reason', 'posted')
  returning id, return_no into v_ret, v_no;

  for it in select * from jsonb_array_elements(p -> 'items') loop
    select * into v_pi from public.purchase_invoice_items
     where invoice_id = v_inv.id and product_id = (it ->> 'product_id')::uuid;
    if not found then raise exception 'ITEM_NOT_IN_INVOICE'; end if;
    v_qty := (it ->> 'qty')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'INVALID_QTY'; end if;

    select coalesce(sum(pri.qty), 0) into v_prev
      from public.purchase_return_items pri join public.purchase_returns pr on pr.id = pri.return_id
     where pr.invoice_id = v_inv.id and pri.product_id = v_pi.product_id and pr.status = 'posted';
    if v_prev + v_qty > v_pi.qty then raise exception 'RETURN_EXCEEDS_SOLD'; end if;

    v_cost := round(v_pi.line_total / v_pi.qty, 4);   -- شاملاً الضريبة والخصم
    insert into public.purchase_return_items (return_id, product_id, qty, unit_cost, line_total)
    values (v_ret, v_pi.product_id, v_qty, v_cost, round(v_cost * v_qty, 2));

    insert into public.stock_movements (branch_id, product_id, movement_type, qty_out, unit_cost, ref_type, ref_id)
    values (v_inv.branch_id, v_pi.product_id, 'purchase_return', v_qty, v_cost, 'purchase_returns', v_ret);
    v_total := v_total + round(v_cost * v_qty, 2);
  end loop;

  update public.purchase_returns set total = v_total where id = v_ret;
  return jsonb_build_object('id', v_ret, 'return_no', v_no, 'total', v_total);
end $$;

-- ───────── 4) العمولات ─────────
-- العمولة = (مبيعات الموظف الصافية بعد المرتجعات) × نسبة عمولته
-- الأساس يُضبط من settings: commission.mode => {"basis":"net_sales"} أو {"basis":"total"}
create or replace function public.fn_calculate_commissions(p_period uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  per public.payroll_periods%rowtype; v_from date; v_to date; v_basis text; e record; v_n int := 0;
  v_total numeric; v_net numeric; v_ret numeric; v_elig numeric;
begin
  if not public.has_permission('commissions','create') then raise exception 'FORBIDDEN'; end if;
  select * into per from public.payroll_periods where id = p_period;
  if not found then raise exception 'PERIOD_NOT_FOUND'; end if;
  v_from := make_date(per.year, per.month, 1);
  v_to := (v_from + interval '1 month')::date;
  select coalesce(value ->> 'basis', 'net_sales') into v_basis from public.settings where key = 'commission.mode' limit 1;
  v_basis := coalesce(v_basis, 'net_sales');

  for e in select * from public.employees where status = 'active' and commission_rate > 0 loop
    select coalesce(sum(total), 0), coalesce(sum(subtotal - discount), 0) into v_total, v_net
      from public.sales_invoices
     where sold_by = e.id and status <> 'cancelled' and invoice_date >= v_from and invoice_date < v_to;
    select coalesce(sum(sr.refund_amount), 0) into v_ret
      from public.sales_returns sr join public.sales_invoices si on si.id = sr.invoice_id
     where si.sold_by = e.id and sr.status = 'posted' and sr.return_date >= v_from and sr.return_date < v_to;

    v_elig := greatest((case when v_basis = 'total' then v_total else v_net end) - v_ret, 0);

    insert into public.commissions (employee_id, branch_id, period_id, total_sales, eligible_sales, rate, amount)
    values (e.id, e.branch_id, p_period, v_total, v_elig, e.commission_rate, round(v_elig * e.commission_rate / 100, 2))
    on conflict (period_id, employee_id) do update
      set total_sales = excluded.total_sales, eligible_sales = excluded.eligible_sales,
          rate = excluded.rate, amount = excluded.amount, branch_id = excluded.branch_id
      where public.commissions.status = 'pending';
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ───────── 5) حساب الرواتب ─────────
create or replace function public.fn_calculate_payroll(p_period uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  per public.payroll_periods%rowtype; v_from date; v_to date; e record; v_pid uuid;
  v_comm numeric; v_bonus numeric; v_ded numeric; v_adv numeric; v_n int := 0;
begin
  if not public.has_permission('payroll','create') then raise exception 'FORBIDDEN'; end if;
  select * into per from public.payroll_periods where id = p_period for update;
  if not found then raise exception 'PERIOD_NOT_FOUND'; end if;
  if per.status not in ('open','calculated') then raise exception 'INVALID_STATUS: %', per.status; end if;
  v_from := make_date(per.year, per.month, 1);
  v_to := (v_from + interval '1 month')::date;

  perform public.fn_calculate_commissions(p_period);

  for e in select * from public.employees where status = 'active' loop
    select coalesce(sum(amount), 0) into v_comm from public.commissions where period_id = p_period and employee_id = e.id;

    -- الحركات غير المرتبطة بكشف (أو المرتبطة بكشف هذا الموظف في هذه الفترة) حتى نهاية الشهر
    select
      coalesce(sum(amount) filter (where adj_type = 'bonus'), 0),
      coalesce(sum(amount) filter (where adj_type = 'deduction'), 0),
      coalesce(sum(amount) filter (where adj_type = 'advance'), 0)
    into v_bonus, v_ded, v_adv
    from public.employee_adjustments a
    where a.employee_id = e.id and a.adj_date < v_to
      and (a.payroll_id is null or a.payroll_id in (select id from public.payrolls where period_id = p_period and employee_id = e.id));

    insert into public.payrolls (period_id, employee_id, branch_id, base_salary, commission_amount, bonuses, deductions, advances)
    values (p_period, e.id, e.branch_id, e.base_salary, v_comm, v_bonus, v_ded, v_adv)
    on conflict (period_id, employee_id) do update
      set base_salary = excluded.base_salary, commission_amount = excluded.commission_amount,
          bonuses = excluded.bonuses, deductions = excluded.deductions, advances = excluded.advances
      where public.payrolls.status = 'draft'
    returning id into v_pid;

    if v_pid is not null then
      update public.employee_adjustments a set payroll_id = v_pid
       where a.employee_id = e.id and a.adj_date < v_to
         and (a.payroll_id is null or a.payroll_id = v_pid);
      update public.commissions set payroll_id = v_pid where period_id = p_period and employee_id = e.id and status = 'pending';
      v_n := v_n + 1;
    end if;
    v_pid := null;
  end loop;

  update public.payroll_periods set status = 'calculated' where id = p_period;
  return jsonb_build_object('period_id', p_period, 'employees', v_n);
end $$;

-- ───────── 6) اعتماد الرواتب ─────────
create or replace function public.fn_approve_payroll(p_period uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.has_permission('payroll','approve') then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.payroll_periods where id = p_period and status = 'calculated') then
    raise exception 'INVALID_STATUS';
  end if;
  update public.payrolls set status = 'approved', approved_by = auth.uid() where period_id = p_period and status = 'draft';
  get diagnostics v_n = row_count;
  update public.commissions set status = 'approved' where period_id = p_period and status = 'pending';
  update public.payroll_periods set status = 'approved' where id = p_period;
  return v_n;
end $$;

-- ───────── 7) صرف راتب موظف (يُسجَّل كمصروف) ─────────
-- التكلفة المسجلة = الأساسي + المكافآت − الخصومات (الراتب) + العمولة (مصروف عمولات منفصل).
-- السلف تُخصم من المدفوع للموظف فقط ولا تُسجَّل كمصروف مرة ثانية.
create or replace function public.fn_pay_payroll(p_payroll uuid, p_method uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  pr public.payrolls%rowtype; v_sal_cat uuid; v_com_cat uuid; v_emp text; v_salary numeric;
  v_done int;
begin
  if not public.has_permission('payroll','approve') then raise exception 'FORBIDDEN'; end if;
  select * into pr from public.payrolls where id = p_payroll for update;
  if not found then raise exception 'PAYROLL_NOT_FOUND'; end if;
  if pr.status <> 'approved' then raise exception 'INVALID_STATUS: %', pr.status; end if;
  if not public.can_access_branch(pr.branch_id) then raise exception 'FORBIDDEN_BRANCH'; end if;

  select full_name into v_emp from public.employees where id = pr.employee_id;
  select id into v_sal_cat from public.expense_categories where kind = 'salary' and is_active order by created_at limit 1;
  select id into v_com_cat from public.expense_categories where kind = 'commission' and is_active order by created_at limit 1;
  v_salary := pr.base_salary + pr.bonuses - pr.deductions;

  if v_salary > 0 and v_sal_cat is not null then
    insert into public.expenses (branch_id, category_id, amount, payment_method_id, responsible_employee_id, description)
    values (pr.branch_id, v_sal_cat, v_salary, p_method, pr.employee_id, 'راتب ' || v_emp);
  end if;
  if pr.commission_amount > 0 and v_com_cat is not null then
    insert into public.expenses (branch_id, category_id, amount, payment_method_id, responsible_employee_id, description)
    values (pr.branch_id, v_com_cat, pr.commission_amount, p_method, pr.employee_id, 'عمولة ' || v_emp);
  end if;

  update public.payrolls set status = 'paid', paid_at = now(), payment_method_id = p_method where id = pr.id;
  update public.commissions set status = 'paid' where payroll_id = pr.id;

  select count(*) into v_done from public.payrolls where period_id = pr.period_id and status <> 'paid';
  if v_done = 0 then update public.payroll_periods set status = 'paid' where id = pr.period_id; end if;
end $$;

-- ───────── صلاحيات التنفيذ ─────────
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'fn\_%'
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;


-- ###################### 4) 20260101000300_patch_03.sql ######################
-- =====================================================================
--  تصحيح 03: دعم الإعداد الأول (First-run setup)
--  شغّله بعد supabase_patch_02.sql
-- =====================================================================

-- هل النظام بحاجة لإنشاء أول مدير؟ (true فقط عندما لا يوجد أي مستخدم)
-- تُستدعى من شاشة الدخول قبل تسجيل الدخول، لذلك تُمنح لـ anon
-- ولا تكشف إلا قيمة منطقية واحدة.
create or replace function public.fn_needs_setup() returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.profiles)
$$;

revoke all on function public.fn_needs_setup() from public;
grant execute on function public.fn_needs_setup() to anon, authenticated, service_role;


-- ###################### 5) 20260101000400_patch_04.sql ######################
-- =====================================================================
--  تصحيح 04: التسعيرة — تقسيم المخزون إلى دفعات حسب سعر الشراء
--  شغّله بعد supabase_patch_03.sql
--
--  الفكرة: كل توريد لنفس المنتج بسعر شراء مختلف يُنشئ "دفعة سعر" مستقلة
--  (stock_layers) في نفس الفرع/المخزن، وتتبع كل دفعة كميتها وتكلفتها وسعر بيعها.
--  البيع والتحويل والتالف تُخصم من الدفعات بترتيب FIFO (الأقدم أولاً) أو LIFO
--  حسب الإعداد inventory.lot_order. أرصدة stock_balances تبقى المرجع الكلي.
-- =====================================================================

-- ───────── 1) الجداول والأعمدة ─────────
create table if not exists public.stock_layers (
  id               uuid primary key default gen_random_uuid(),
  branch_id        uuid not null references public.branches(id),
  product_id       uuid not null references public.products(id),
  purchase_price   numeric(14,2) not null check (purchase_price >= 0),   -- سعر الشراء للوحدة (بعد خصم البند)
  unit_cost        numeric(14,4) not null default 0,                     -- التكلفة الفعلية (شاملة توزيع التكاليف الإضافية)
  qty_on_hand      numeric(14,3) not null default 0 check (qty_on_hand >= 0),
  qty_reserved     numeric(14,3) not null default 0 check (qty_reserved >= 0),
  qty_received     numeric(14,3) not null default 0,                     -- إجمالي ما دخل على الدفعة
  retail_price     numeric(14,2) check (retail_price >= 0),              -- سعر بيع خاص بالدفعة (فارغ = سعر المنتج)
  wholesale_price  numeric(14,2) check (wholesale_price >= 0),           -- سعر جملة خاص بالدفعة
  first_received_at timestamptz not null default now(),
  last_received_at  timestamptz not null default now(),
  is_legacy        boolean not null default false,                       -- رصيد سابق قبل تفعيل التسعيرة
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid default auth.uid()
);
create unique index if not exists uq_layers_price on public.stock_layers (branch_id, product_id, purchase_price);
create index if not exists idx_layers_lookup on public.stock_layers (branch_id, product_id, first_received_at);
drop trigger if exists set_updated_at on public.stock_layers;
create trigger set_updated_at before update on public.stock_layers for each row execute function public.trg_set_updated_at();

create table if not exists public.stock_layer_moves (
  id          bigint generated always as identity primary key,
  layer_id    uuid not null references public.stock_layers(id) on delete cascade,
  movement_id bigint references public.stock_movements(id),
  qty_delta   numeric(14,3) not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_layer_moves_layer on public.stock_layer_moves (layer_id, created_at desc);

alter table public.stock_movements       add column if not exists layer_id uuid;
alter table public.stock_movements       add column if not exists lot_price numeric(14,2);
alter table public.stock_transfer_items  add column if not exists layer_id uuid;
alter table public.stock_transfer_items  add column if not exists lot_price numeric(14,2);

-- ───────── 2) دوال داخلية ─────────
create or replace function public.internal_lot_order() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select value ->> 'value' from public.settings
                    where key = 'inventory.lot_order' and branch_id is null limit 1), 'fifo')
$$;

-- متوسط تكلفة الكمية التي ستُصرف فعلياً من الدفعات (بدون خصمها)
create or replace function public.internal_lot_cost(p_branch uuid, p_product uuid, p_qty numeric, p_fallback numeric)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare rec record; v_rem numeric := p_qty; v_cost numeric := 0; v_take numeric; v_order text := public.internal_lot_order();
begin
  if p_qty is null or p_qty <= 0 then return coalesce(p_fallback, 0); end if;
  for rec in
    select unit_cost, (qty_on_hand - qty_reserved) as avail from public.stock_layers
     where branch_id = p_branch and product_id = p_product and (qty_on_hand - qty_reserved) > 0
     order by case when v_order = 'lifo' then -extract(epoch from first_received_at) else extract(epoch from first_received_at) end, created_at
  loop
    exit when v_rem <= 0;
    v_take := least(v_rem, rec.avail);
    v_cost := v_cost + v_take * rec.unit_cost;
    v_rem := v_rem - v_take;
  end loop;
  if v_rem > 0 then v_cost := v_cost + v_rem * coalesce(p_fallback, 0); end if;
  return round(v_cost / p_qty, 4);
end $$;

-- تطبيق حركة مخزون على الدفعات: الوارد يدخل دفعة بسعره، والصادر يُخصم FIFO/LIFO أو من دفعة محددة
create or replace function public.internal_apply_layers(p_mv public.stock_movements) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_layer_id uuid; v_key numeric; v_remaining numeric; v_take numeric; v_order text; rec record;
begin
  -- ===== وارد =====
  if p_mv.qty_in > 0 then
    if p_mv.layer_id is not null then
      select id into v_layer_id from public.stock_layers
       where id = p_mv.layer_id and branch_id = p_mv.branch_id and product_id = p_mv.product_id;
    end if;

    if v_layer_id is null then
      v_key := round(coalesce(p_mv.lot_price, p_mv.unit_cost, 0), 2);
      if p_mv.lot_price is null then
        -- حركات غير الشراء: اربطها بدفعة لها نفس السعر أو نفس التكلفة الفعلية
        select id into v_layer_id from public.stock_layers
         where branch_id = p_mv.branch_id and product_id = p_mv.product_id
           and (purchase_price = v_key or round(unit_cost, 2) = v_key)
         order by (purchase_price = v_key) desc, first_received_at
         limit 1;
      end if;
    end if;

    if v_layer_id is null then
      insert into public.stock_layers (branch_id, product_id, purchase_price, unit_cost)
      values (p_mv.branch_id, p_mv.product_id, v_key, coalesce(p_mv.unit_cost, 0))
      on conflict (branch_id, product_id, purchase_price) do update set updated_at = now()
      returning id into v_layer_id;
    end if;

    update public.stock_layers
       set unit_cost = case when p_mv.unit_cost > 0 and (qty_received + p_mv.qty_in) > 0
                            then (unit_cost * qty_received + p_mv.unit_cost * p_mv.qty_in) / (qty_received + p_mv.qty_in)
                            else unit_cost end,
           qty_on_hand = qty_on_hand + p_mv.qty_in,
           qty_received = qty_received + p_mv.qty_in,
           last_received_at = now()
     where id = v_layer_id;
    insert into public.stock_layer_moves (layer_id, movement_id, qty_delta) values (v_layer_id, p_mv.id, p_mv.qty_in);
  end if;

  -- ===== صادر =====
  if p_mv.qty_out > 0 then
    v_remaining := p_mv.qty_out;

    -- دفعة محددة (تحويل صادر، مرتجع شراء...)
    if p_mv.layer_id is not null then
      for rec in
        select id, qty_on_hand from public.stock_layers
         where id = p_mv.layer_id and branch_id = p_mv.branch_id and product_id = p_mv.product_id for update
      loop
        v_take := least(v_remaining, rec.qty_on_hand);
        if v_take > 0 then
          update public.stock_layers set qty_on_hand = qty_on_hand - v_take where id = rec.id;
          insert into public.stock_layer_moves (layer_id, movement_id, qty_delta) values (rec.id, p_mv.id, -v_take);
          v_remaining := v_remaining - v_take;
        end if;
      end loop;
    end if;

    -- الباقي حسب ترتيب البيع (المتاح غير المحجوز أولاً)
    if v_remaining > 0 then
      v_order := public.internal_lot_order();
      for rec in
        select id, (qty_on_hand - qty_reserved) as avail from public.stock_layers
         where branch_id = p_mv.branch_id and product_id = p_mv.product_id and (qty_on_hand - qty_reserved) > 0
         order by case when v_order = 'lifo' then -extract(epoch from first_received_at) else extract(epoch from first_received_at) end, created_at
         for update
      loop
        exit when v_remaining <= 0;
        v_take := least(v_remaining, rec.avail);
        update public.stock_layers set qty_on_hand = qty_on_hand - v_take where id = rec.id;
        insert into public.stock_layer_moves (layer_id, movement_id, qty_delta) values (rec.id, p_mv.id, -v_take);
        v_remaining := v_remaining - v_take;
      end loop;
    end if;

    -- حالة نادرة: لا يكفي المتاح فنأخذ من المحجوز (مثل تحويلات قديمة بلا دفعة)
    if v_remaining > 0 then
      v_order := public.internal_lot_order();
      for rec in
        select id, qty_on_hand from public.stock_layers
         where branch_id = p_mv.branch_id and product_id = p_mv.product_id and qty_on_hand > 0
         order by case when v_order = 'lifo' then -extract(epoch from first_received_at) else extract(epoch from first_received_at) end, created_at
         for update
      loop
        exit when v_remaining <= 0;
        v_take := least(v_remaining, rec.qty_on_hand);
        update public.stock_layers
           set qty_on_hand = qty_on_hand - v_take, qty_reserved = least(qty_reserved, qty_on_hand - v_take)
         where id = rec.id;
        insert into public.stock_layer_moves (layer_id, movement_id, qty_delta) values (rec.id, p_mv.id, -v_take);
        v_remaining := v_remaining - v_take;
      end loop;
    end if;
  end if;
end $$;

-- ───────── 3) تعديل دوال الحركة لتعمل مع الدفعات ─────────
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
  -- تقسيم الحركة على دفعات الأسعار (التسعيرة)
  perform public.internal_apply_layers(new);
  return new;
end $$;

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
  v_change numeric; v_remaining numeric; v_lotcost numeric;
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

    v_lotcost := public.internal_lot_cost(v_shift.branch_id, v_prod.id, v_qty, v_bal.avg_cost);
    insert into public.sales_invoice_items (invoice_id, product_id, qty, unit_price, unit_cost, discount, tax_rate, line_total)
    values (v_inv, v_prod.id, v_qty, v_price, v_lotcost, v_disc, v_rate, v_net + v_tax);

    insert into public.stock_movements (branch_id, product_id, movement_type, qty_out, unit_cost, ref_type, ref_id)
    values (v_shift.branch_id, v_prod.id, 'sale', v_qty, v_lotcost, 'sales_invoices', v_inv);

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

    insert into public.stock_movements (branch_id, product_id, movement_type, qty_in, unit_cost, lot_price, ref_type, ref_id)
    values (v_branch, (it ->> 'product_id')::uuid, 'purchase', v_qty, v_landed, round(v_net / v_qty, 2), 'purchase_invoices', v_inv);

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


create or replace function public.fn_create_transfer(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_from uuid := (p ->> 'from_branch_id')::uuid; v_to uuid := (p ->> 'to_branch_id')::uuid;
  v_id uuid; v_no text; it jsonb; v_prod public.products%rowtype; v_bal public.stock_balances%rowtype;
  v_qty numeric; v_total numeric := 0; v_rem numeric; v_take numeric; v_wh numeric;
  v_order text := public.internal_lot_order(); rec record;
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

    -- توزيع الكمية على الدفعات بترتيب البيع، سطر تحويل لكل دفعة (يحمل سعرها إلى الوجهة)
    v_rem := v_qty;
    for rec in
      select id, purchase_price, unit_cost, wholesale_price, (qty_on_hand - qty_reserved) as avail
        from public.stock_layers
       where branch_id = v_from and product_id = v_prod.id and (qty_on_hand - qty_reserved) > 0
       order by case when v_order = 'lifo' then -extract(epoch from first_received_at) else extract(epoch from first_received_at) end, created_at
       for update
    loop
      exit when v_rem <= 0;
      v_take := least(v_rem, rec.avail);
      v_wh := coalesce(rec.wholesale_price, v_prod.wholesale_price);
      update public.stock_layers set qty_reserved = qty_reserved + v_take where id = rec.id;
      insert into public.stock_transfer_items (transfer_id, product_id, qty_sent, wholesale_price, unit_cost, layer_id, lot_price)
      values (v_id, v_prod.id, v_take, v_wh, rec.unit_cost, rec.id, rec.purchase_price);
      v_total := v_total + v_take * v_wh;
      v_rem := v_rem - v_take;
    end loop;

    if v_rem > 0 then   -- مخزون بلا دفعات (نادر)
      insert into public.stock_transfer_items (transfer_id, product_id, qty_sent, wholesale_price, unit_cost)
      values (v_id, v_prod.id, v_rem, v_prod.wholesale_price, v_bal.avg_cost);
      v_total := v_total + v_rem * v_prod.wholesale_price;
    end if;

    update public.stock_balances set qty_reserved = qty_reserved + v_qty, updated_at = now()
     where branch_id = v_from and product_id = v_prod.id;
  end loop;

  update public.stock_transfers set total_wholesale_value = v_total where id = v_id;
  return jsonb_build_object('id', v_id, 'transfer_no', v_no, 'total_wholesale_value', v_total);
end $$;

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
    insert into public.stock_movements (branch_id, product_id, movement_type, qty_out, unit_cost, layer_id, ref_type, ref_id)
    values (t.from_branch_id, i.product_id, 'transfer_out', i.qty_sent, i.unit_cost, i.layer_id, 'stock_transfers', t.id);
    if i.layer_id is not null then
      update public.stock_layers set qty_reserved = greatest(qty_reserved - i.qty_sent, 0) where id = i.layer_id;
    end if;
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
      insert into public.stock_movements (branch_id, product_id, movement_type, qty_in, unit_cost, lot_price, ref_type, ref_id)
      values (t.to_branch_id, i.product_id, 'transfer_in', v_rec, i.unit_cost, i.lot_price, 'stock_transfers', t.id);
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

create or replace function public.fn_post_purchase_return(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_inv public.purchase_invoices%rowtype; v_ret uuid; v_no text; it jsonb;
  v_pi public.purchase_invoice_items%rowtype; v_qty numeric; v_prev numeric; v_cost numeric;
  v_total numeric := 0; v_layer uuid;
begin
  if not public.has_permission('purchases','update') then raise exception 'FORBIDDEN'; end if;
  select * into v_inv from public.purchase_invoices where id = (p ->> 'invoice_id')::uuid for update;
  if not found or v_inv.status <> 'posted' then raise exception 'INVALID_INVOICE'; end if;
  if not public.can_access_branch(v_inv.branch_id) then raise exception 'FORBIDDEN_BRANCH'; end if;
  if jsonb_array_length(coalesce(p -> 'items', '[]'::jsonb)) = 0 then raise exception 'EMPTY_RETURN'; end if;

  insert into public.purchase_returns (invoice_id, supplier_id, branch_id, reason, status)
  values (v_inv.id, v_inv.supplier_id, v_inv.branch_id, p ->> 'reason', 'posted')
  returning id, return_no into v_ret, v_no;

  for it in select * from jsonb_array_elements(p -> 'items') loop
    select * into v_pi from public.purchase_invoice_items
     where invoice_id = v_inv.id and product_id = (it ->> 'product_id')::uuid;
    if not found then raise exception 'ITEM_NOT_IN_INVOICE'; end if;
    v_qty := (it ->> 'qty')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'INVALID_QTY'; end if;

    select coalesce(sum(pri.qty), 0) into v_prev
      from public.purchase_return_items pri join public.purchase_returns pr on pr.id = pri.return_id
     where pr.invoice_id = v_inv.id and pri.product_id = v_pi.product_id and pr.status = 'posted';
    if v_prev + v_qty > v_pi.qty then raise exception 'RETURN_EXCEEDS_SOLD'; end if;

    v_cost := round(v_pi.line_total / v_pi.qty, 4);   -- شاملاً الضريبة والخصم
    insert into public.purchase_return_items (return_id, product_id, qty, unit_cost, line_total)
    values (v_ret, v_pi.product_id, v_qty, v_cost, round(v_cost * v_qty, 2));

    v_layer := null;
    select id into v_layer from public.stock_layers
     where branch_id = v_inv.branch_id and product_id = v_pi.product_id
       and purchase_price = round((v_pi.qty * v_pi.unit_cost - v_pi.discount) / v_pi.qty, 2)
       and (qty_on_hand - qty_reserved) >= v_qty
     limit 1;
    insert into public.stock_movements (branch_id, product_id, movement_type, qty_out, unit_cost, layer_id, ref_type, ref_id)
    values (v_inv.branch_id, v_pi.product_id, 'purchase_return', v_qty, v_cost, v_layer, 'purchase_returns', v_ret);
    v_total := v_total + round(v_cost * v_qty, 2);
  end loop;

  update public.purchase_returns set total = v_total where id = v_ret;
  return jsonb_build_object('id', v_ret, 'return_no', v_no, 'total', v_total);
end $$;

-- ───────── 4) دوال التسعيرة (تعديل أسعار الدفعات) ─────────
-- p_retail / p_wholesale = null  ⇒  يعود للسعر الافتراضي للمنتج
create or replace function public.fn_set_lot_price(p_layer uuid, p_retail numeric, p_wholesale numeric, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare l public.stock_layers%rowtype;
begin
  if not public.has_permission('pricing','update') then raise exception 'FORBIDDEN'; end if;
  select * into l from public.stock_layers where id = p_layer for update;
  if not found then raise exception 'LAYER_NOT_FOUND'; end if;
  if not public.can_access_branch(l.branch_id) then raise exception 'FORBIDDEN_BRANCH'; end if;
  if (p_retail is not null and p_retail < 0) or (p_wholesale is not null and p_wholesale < 0) then raise exception 'INVALID_PRICE'; end if;
  update public.stock_layers set retail_price = p_retail, wholesale_price = p_wholesale, note = p_note where id = p_layer;
end $$;

-- تطبيق نفس سعر البيع/الجملة على كل دفعات منتج في فرع
create or replace function public.fn_set_product_lots_price(p_branch uuid, p_product uuid, p_retail numeric, p_wholesale numeric)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.has_permission('pricing','update') then raise exception 'FORBIDDEN'; end if;
  if not public.can_access_branch(p_branch) then raise exception 'FORBIDDEN_BRANCH'; end if;
  if (p_retail is not null and p_retail < 0) or (p_wholesale is not null and p_wholesale < 0) then raise exception 'INVALID_PRICE'; end if;
  update public.stock_layers set retail_price = p_retail, wholesale_price = p_wholesale
   where branch_id = p_branch and product_id = p_product;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ───────── 5) سعر البيع الحالي (للـ POS): سعر الدفعة التي ستُباع أولاً ─────────
-- يعمل بصلاحيات مالك الـ View (ليقرأه كاشير بدون صلاحية التسعيرة) ويقتصر على فروع المستخدم، ولا يكشف التكلفة.
create or replace view public.v_current_sell_price as
select distinct on (l.branch_id, l.product_id)
       l.branch_id, l.product_id, l.id as layer_id, l.retail_price as sell_price
  from public.stock_layers l
 where (l.qty_on_hand - l.qty_reserved) > 0 and public.can_access_branch(l.branch_id)
 order by l.branch_id, l.product_id,
          case when public.internal_lot_order() = 'lifo' then -extract(epoch from l.first_received_at) else extract(epoch from l.first_received_at) end,
          l.created_at;
revoke all on public.v_current_sell_price from anon;
grant select on public.v_current_sell_price to authenticated;

-- ───────── 6) الأمان (RLS) والصلاحيات ─────────
alter table public.stock_layers enable row level security;
alter table public.stock_layer_moves enable row level security;

drop policy if exists layers_sel on public.stock_layers;
create policy layers_sel on public.stock_layers for select to authenticated
  using (public.can_access_branch(branch_id) and public.has_permission('pricing','view'));
drop policy if exists layer_moves_sel on public.stock_layer_moves;
create policy layer_moves_sel on public.stock_layer_moves for select to authenticated
  using (exists (select 1 from public.stock_layers l where l.id = layer_id));
-- لا كتابة مباشرة: التعديل فقط عبر fn_set_lot_price / الحركات

-- تدقيق تغيير أسعار الدفعات فقط (وليس كل حركة كمية)
drop trigger if exists audit_prices on public.stock_layers;
create trigger audit_prices after update of retail_price, wholesale_price on public.stock_layers
  for each row execute function public.trg_audit('pricing');

-- قسم جديد في الصلاحيات
insert into public.permissions (module, action)
select 'pricing', a from unnest(array['view','create','update','delete','print','export','approve','cancel']) as a
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.module = 'pricing'
where r.code in ('super_admin','head_office')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.module = 'pricing'
where r.code in ('accountant','warehouse_manager') and p.action in ('view','update','print','export')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.module = 'pricing'
where r.code = 'branch_manager' and p.action in ('view','print')
on conflict do nothing;

-- إعداد ترتيب صرف الدفعات: fifo (الأقدم أولاً) | lifo (الأحدث أولاً)
insert into public.settings (key, value) values ('inventory.lot_order', '{"value":"fifo"}') on conflict do nothing;

-- ───────── 7) ترحيل الرصيد الحالي إلى دفعات (مرة واحدة) ─────────
insert into public.stock_layers (branch_id, product_id, purchase_price, unit_cost, qty_on_hand, qty_reserved, qty_received, is_legacy, note)
select sb.branch_id, sb.product_id, round(sb.avg_cost, 2), sb.avg_cost, sb.qty_on_hand,
       least(sb.qty_reserved, sb.qty_on_hand), sb.qty_on_hand, true, 'رصيد سابق قبل تفعيل التسعيرة'
  from public.stock_balances sb
 where sb.qty_on_hand > 0
   and not exists (select 1 from public.stock_layers l where l.branch_id = sb.branch_id and l.product_id = sb.product_id)
on conflict do nothing;

-- ───────── 8) صلاحيات التنفيذ ─────────
revoke all on function public.internal_lot_order() from public, anon, authenticated;
revoke all on function public.internal_lot_cost(uuid, uuid, numeric, numeric) from public, anon, authenticated;
revoke all on function public.internal_apply_layers(public.stock_movements) from public, anon, authenticated;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'fn\_%' and p.proname <> 'fn_needs_setup'
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;


-- ###################### 6) 20260101000500_patch_05.sql ######################
-- =====================================================================
--  تصحيح 05: دور «كشك / نقطة بيع» + هوية الشركة في شاشة الدخول
--  شغّله بعد patch_04 (آمن للتكرار)
--
--  الكشك = سجل في جدول branches بعلامة is_kiosk ويرتبط بفرع أب (parent_branch_id).
--  لذلك يعمل له كل ما يعمله الفرع: مخزون، ورديات، فواتير، صندوق، طلبات بضاعة.
--  مستخدم الكشك يرى بيانات كشكه فقط، ومدير الفرع الأب يرى فرعه وأكشاكه.
-- =====================================================================

-- 1) الأعمدة
alter table public.branches add column if not exists is_kiosk boolean not null default false;
alter table public.branches add column if not exists parent_branch_id uuid references public.branches(id) on delete restrict;
alter table public.branches add column if not exists location_note text;   -- مكان الكشك: مهرجان / مول ...

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_kiosk_parent') then
    alter table public.branches add constraint chk_kiosk_parent
      check ((not is_kiosk or parent_branch_id is not null) and (parent_branch_id is null or parent_branch_id <> id));
  end if;
end $$;
create index if not exists idx_branches_parent on public.branches(parent_branch_id);

-- 2) الوصول: مدير الفرع الأب يصل إلى أكشاك فرعه
create or replace function public.can_access_branch(p_branch uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_branch is not null and (
    public.sees_all_branches()
    or p_branch = public.auth_branch_id()
    or exists (select 1 from public.branches k
               where k.id = p_branch and k.is_kiosk and k.parent_branch_id = public.auth_branch_id()))
$$;

-- 3) الدور
insert into public.roles (code, name, description, is_system, all_branches) values
  ('kiosk', 'كشك / نقطة بيع', 'بيع العطور في المهرجانات والمولات لكشك تابع لفرع', true, false)
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r
join (values ('products','view'), ('pos','view'), ('pos','create'), ('sales','view'), ('sales','print'),
             ('customers','view'), ('customers','create'), ('returns','view'), ('returns','create'),
             ('exchanges','view'), ('exchanges','create'), ('shifts','view'), ('shifts','create'),
             ('inventory','view'), ('requests','view'), ('requests','create')) v(m, a) on true
join public.permissions p on p.module = v.m and p.action = v.a
where r.code = 'kiosk'
on conflict do nothing;

-- 4) هوية الشركة لشاشة الدخول (تُقرأ قبل تسجيل الدخول → تُمنح لـ anon، وتعيد الاسم والشعار فقط)
create or replace function public.fn_public_branding() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('name', name, 'logo_url', logo_url)
                   from public.company_profile order by created_at limit 1), '{}'::jsonb)
$$;
revoke all on function public.fn_public_branding() from public;
grant execute on function public.fn_public_branding() to anon, authenticated, service_role;

-- الشعار يُرفع إلى bucket عام (product-images) لذا رابطه يعمل بدون تسجيل دخول
update storage.buckets set public = true where id = 'product-images';


-- ###################### 7) 20260101000600_patch_06.sql ######################
-- =====================================================================
--  تصحيح 06: نقل العمليات الحرجة إلى دوال fn_* (ذرّية + بصلاحيات) + سلامة الأكشاك
--  شغّله بعد patch_05 (آمن للتكرار)
-- =====================================================================

-- 1) إنشاء طلب بضاعة + بنوده في عملية واحدة (بدل إدخالين منفصلين قد يتركان طلباً فارغاً)
create or replace function public.fn_create_stock_request(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_branch uuid; v_id uuid; v_no text; it jsonb; v_qty numeric;
begin
  if not public.has_permission('requests','create') then raise exception 'FORBIDDEN'; end if;
  v_branch := coalesce(nullif(p->>'branch_id','')::uuid, public.auth_branch_id());
  if not public.can_access_branch(v_branch) then raise exception 'FORBIDDEN_BRANCH'; end if;
  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') = 0 then
    raise exception 'EMPTY_REQUEST';
  end if;

  insert into public.stock_requests (branch_id, note)
  values (v_branch, nullif(p->>'note',''))
  returning id, request_no into v_id, v_no;

  for it in select * from jsonb_array_elements(p->'items') loop
    v_qty := coalesce((it->>'qty')::numeric, 0);
    if v_qty <= 0 then raise exception 'INVALID_QTY'; end if;
    insert into public.stock_request_items (request_id, product_id, qty_requested, note)
    values (v_id, (it->>'product_id')::uuid, v_qty, nullif(it->>'note',''));
  end loop;

  return jsonb_build_object('id', v_id, 'request_no', v_no);
end $$;

-- 2) تسجيل آخر دخول (كان تحديثاً مباشراً على profiles يفشل بصمت لمن لا يملك صلاحية المستخدمين)
create or replace function public.fn_touch_login() returns void
language sql security definer set search_path = public as $$
  update public.profiles set last_login_at = now() where id = auth.uid()
$$;

-- 3) الإشعارات: كل ما يُرسل لمدير الفرع يصل أيضاً لمستخدمي الأكشاك
create or replace function public.internal_notify(
  p_type text, p_title text, p_body text, p_ref_table text, p_ref_id uuid, p_branch uuid, p_roles text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (type, title, body, ref_table, ref_id, branch_id, role_id)
  select p_type, p_title, p_body, p_ref_table, p_ref_id, p_branch, r.id
  from public.roles r
  where r.code = any (p_roles)
     or (r.code = 'kiosk' and 'branch_manager' = any (p_roles));
end $$;

-- 4) سلامة بيانات الأكشاك
-- 4-أ) مستخدم بدور «كشك» لا يُربط إلا بكشك
create or replace function public.trg_profile_kiosk_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.roles r where r.id = new.role_id and r.code = 'kiosk')
     and not exists (select 1 from public.branches b where b.id = new.branch_id and b.is_kiosk) then
    raise exception 'KIOSK_ROLE_NEEDS_KIOSK_BRANCH';
  end if;
  return new;
end $$;
drop trigger if exists profile_kiosk_check on public.profiles;
create trigger profile_kiosk_check before insert or update of role_id, branch_id on public.profiles
  for each row execute function public.trg_profile_kiosk_check();

-- 4-ب) الفرع الأب للكشك يجب أن يكون فرعاً حقيقياً (ليس مخزناً رئيسياً ولا كشكاً آخر)
create or replace function public.trg_branch_kiosk_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_kiosk then
    if new.type <> 'branch' then raise exception 'KIOSK_PARENT_INVALID'; end if;
    if not exists (select 1 from public.branches p
                   where p.id = new.parent_branch_id and p.type = 'branch' and not p.is_kiosk) then
      raise exception 'KIOSK_PARENT_INVALID';
    end if;
  end if;
  -- لا يُحوَّل فرع له أكشاك إلى كشك
  if new.is_kiosk and exists (select 1 from public.branches k where k.parent_branch_id = new.id) then
    raise exception 'KIOSK_PARENT_INVALID';
  end if;
  return new;
end $$;
drop trigger if exists branch_kiosk_check on public.branches;
create trigger branch_kiosk_check before insert or update of is_kiosk, parent_branch_id, type on public.branches
  for each row execute function public.trg_branch_kiosk_check();

-- 5) الصلاحيات التنفيذية
revoke all on function public.fn_create_stock_request(jsonb) from public, anon;
revoke all on function public.fn_touch_login() from public, anon;
grant execute on function public.fn_create_stock_request(jsonb) to authenticated, service_role;
grant execute on function public.fn_touch_login() to authenticated, service_role;
revoke all on function public.internal_notify(text, text, text, text, uuid, uuid, text[]) from public, anon, authenticated;


-- ###################### 8) 20260101000700_accounting.sql ######################
-- =====================================================================
--  تصحيح 07: النظام المحاسبي المتكامل
--  الدليل المحاسبي (شجرة الحسابات) + القيود اليومية + الرواتب والأجور محاسبياً
--  + الميزانية العمومية + قائمة الدخل + ميزان المراجعة + دفتر الأستاذ
--
--  المبدأ: كل عملية تشغيلية (بيع/شراء/مرتجع/مصروف/راتب/تحويل/جرد/تسوية...)
--  تولّد قيداً مزدوجاً تلقائياً عبر Triggers على جداولها، دون المساس بدوال RPC القائمة.
--  القيد يحمل (source_type, source_id, source_event) فيُمنع تكراره ويمكن تتبّعه للمستند الأصلي.
--  القيود غير قابلة للتعديل أو الحذف؛ التصحيح يتم بقيد عكسي فقط.
--
--  الملف مكتوب ليُنفَّذ مرة واحدة بعد patch_06 (وهو آمن عند إعادة التشغيل قدر الإمكان).
-- =====================================================================

-- ───────────────────────── 1) الأنواع ─────────────────────────
do $$ begin
  if not exists (select 1 from pg_type where typname = 'account_type') then
    create type public.account_type as enum ('asset','liability','equity','revenue','expense');
  end if;
end $$;

-- ───────────────────────── 2) الجداول ─────────────────────────
-- شجرة الحسابات: حساب رئيسي (is_group) لا يُرحَّل إليه، والفرعي (ورقة) هو الذي تُسجَّل عليه القيود
create table if not exists public.accounts (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  name         text not null,
  account_type public.account_type not null,
  parent_id    uuid references public.accounts(id),
  is_group     boolean not null default false,
  is_system    boolean not null default false,   -- حسابات أساسية لا تُحذف
  is_active    boolean not null default true,
  note         text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists idx_accounts_parent on public.accounts (parent_id);

-- ربط الأدوار المحاسبية (مفتاح منطقي) بحسابات فعلية: تغيير الحساب لا يتطلب تعديل أي كود
create table if not exists public.account_mappings (
  key        text primary key,
  label      text not null,
  account_id uuid not null references public.accounts(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.journal_entries (
  id           uuid primary key default gen_random_uuid(),
  entry_no     text not null unique,
  entry_date   date not null default current_date,
  branch_id    uuid not null references public.branches(id),   -- فرع القيد (للترقيم والعرض)، ولكل سطر فرعه
  description  text,
  source_type  text,        -- اسم الجدول المصدر (null = قيد يدوي)
  source_id    text,
  source_event text,
  status       text not null default 'posted' check (status in ('posted','reversed')),
  reversal_of  uuid references public.journal_entries(id),
  reversed_by  uuid references public.journal_entries(id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists idx_je_date on public.journal_entries (entry_date desc);
create index if not exists idx_je_source on public.journal_entries (source_type, source_id);
-- قيد واحد فعّال لكل (مصدر، حدث): يمنع تكرار الترحيل
create unique index if not exists uq_je_source_active on public.journal_entries (source_type, source_id, source_event)
  where source_type is not null and reversal_of is null and status = 'posted';

create table if not exists public.journal_lines (
  id         bigint generated always as identity primary key,
  entry_id   uuid not null references public.journal_entries(id),
  line_no    int not null,
  account_id uuid not null references public.accounts(id),
  branch_id  uuid not null references public.branches(id),
  debit      numeric(16,2) not null default 0 check (debit >= 0),
  credit     numeric(16,2) not null default 0 check (credit >= 0),
  memo       text,
  party_type text check (party_type in ('customer','supplier','employee')),
  party_id   uuid,
  check ((debit > 0) <> (credit > 0))
);
create index if not exists idx_jl_entry   on public.journal_lines (entry_id);
create index if not exists idx_jl_account on public.journal_lines (account_id, branch_id);
create index if not exists idx_jl_party   on public.journal_lines (party_type, party_id);

-- أعمدة الربط في الجداول التشغيلية (ليس فيها منطق، فقط مرجع حساب)
alter table public.payment_methods    add column if not exists account_id uuid references public.accounts(id);
alter table public.expense_categories add column if not exists account_id uuid references public.accounts(id);
alter table public.income_types       add column if not exists account_id uuid references public.accounts(id);
-- مصروف مُولَّد من صرف راتب: لا يُرحَّل كمصروف عادي (قيد الراتب يغطيه)
alter table public.expenses           add column if not exists payroll_id uuid references public.payrolls(id);
-- طريقة صرف السلفة (فارغ = أول طريقة دفع نقدية)
alter table public.employee_adjustments add column if not exists payment_method_id uuid references public.payment_methods(id);

drop trigger if exists set_updated_at on public.accounts;
create trigger set_updated_at before update on public.accounts for each row execute function public.trg_set_updated_at();
drop trigger if exists set_updated_at on public.account_mappings;
create trigger set_updated_at before update on public.account_mappings for each row execute function public.trg_set_updated_at();
drop trigger if exists doc_no on public.journal_entries;
create trigger doc_no before insert on public.journal_entries
  for each row execute function public.trg_set_doc_no('je', 'entry_no');

-- ───────────────────────── 3) حراس السلامة ─────────────────────────
-- الحساب: الأب مجموعة ومن نفس النوع، ولا يتحول لمجموعة/نوع آخر إن كانت عليه حركات
create or replace function public.trg_account_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.accounts%rowtype;
begin
  if tg_op = 'DELETE' then
    if old.is_system then raise exception 'ACCOUNT_SYSTEM: لا يمكن حذف حساب أساسي'; end if;
    if exists (select 1 from public.journal_lines where account_id = old.id) then
      raise exception 'ACCOUNT_HAS_ENTRIES: عليه قيود'; end if;
    if exists (select 1 from public.accounts where parent_id = old.id) then
      raise exception 'ACCOUNT_HAS_CHILDREN: له حسابات فرعية'; end if;
    if exists (select 1 from public.account_mappings where account_id = old.id) then
      raise exception 'ACCOUNT_IN_USE: مربوط بإعدادات الترحيل'; end if;
    return old;
  end if;

  if new.parent_id is not null then
    select * into p from public.accounts where id = new.parent_id;
    if not found or not p.is_group then raise exception 'ACCOUNT_PARENT_INVALID: الأب يجب أن يكون حساباً رئيسياً'; end if;
    if p.account_type <> new.account_type then raise exception 'ACCOUNT_TYPE_MISMATCH: نوع الحساب يخالف نوع أبيه'; end if;
    if new.id = new.parent_id then raise exception 'ACCOUNT_PARENT_INVALID'; end if;
  end if;

  if tg_op = 'UPDATE' then
    if (new.is_group is distinct from old.is_group or new.account_type is distinct from old.account_type)
       and exists (select 1 from public.journal_lines where account_id = old.id) then
      raise exception 'ACCOUNT_HAS_ENTRIES: لا يمكن تغيير نوع حساب عليه قيود';
    end if;
    if new.is_group and not old.is_group and exists (select 1 from public.account_mappings where account_id = old.id) then
      raise exception 'ACCOUNT_IN_USE: مربوط بإعدادات الترحيل';
    end if;
    if old.is_system and (new.code is distinct from old.code or new.account_type is distinct from old.account_type
                          or new.is_group is distinct from old.is_group) then
      raise exception 'ACCOUNT_SYSTEM: لا يمكن تغيير رمز/نوع حساب أساسي';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists account_guard on public.accounts;
create trigger account_guard before insert or update or delete on public.accounts
  for each row execute function public.trg_account_guard();

-- القيد: لا حذف، والتعديل الوحيد المسموح هو وسم "معكوس"
create or replace function public.trg_je_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'IMMUTABLE_LEDGER: delete on journal_entries is not allowed'; end if;
  if (to_jsonb(new) - 'status' - 'reversed_by') is distinct from (to_jsonb(old) - 'status' - 'reversed_by') then
    raise exception 'IMMUTABLE_LEDGER: update on journal_entries is not allowed';
  end if;
  if old.status = 'reversed' and new.status <> 'reversed' then
    raise exception 'IMMUTABLE_LEDGER: reversed entry cannot be reopened';
  end if;
  return new;
end $$;
drop trigger if exists je_guard on public.journal_entries;
create trigger je_guard before update or delete on public.journal_entries
  for each row execute function public.trg_je_guard();

drop trigger if exists immutable on public.journal_lines;
create trigger immutable before update or delete on public.journal_lines
  for each row execute function public.trg_immutable();

-- إقفال الفترة: القيود اليدوية لا تُقبل بتاريخ ≤ تاريخ الإقفال (القيود التلقائية لا تتأثر حتى لا تتعطل العمليات)
create or replace function public.trg_je_lock() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_lock date;
begin
  if new.source_type is null then
    select nullif(value ->> 'value', '')::date into v_lock
      from public.settings where key = 'accounting.lock_date' and branch_id is null;
    if v_lock is not null and new.entry_date <= v_lock then
      raise exception 'PERIOD_LOCKED: %', v_lock;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists je_lock on public.journal_entries;
create trigger je_lock before insert on public.journal_entries
  for each row execute function public.trg_je_lock();

-- توازن القيد (مدين = دائن) يُفحص عند إتمام المعاملة
create or replace function public.trg_je_balanced() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_d numeric; v_c numeric;
begin
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0) into v_d, v_c
    from public.journal_lines where entry_id = new.entry_id;
  if v_d <> v_c then
    raise exception 'JE_UNBALANCED: قيد % (مدين % / دائن %)', new.entry_id, v_d, v_c;
  end if;
  return null;
end $$;
drop trigger if exists je_balanced on public.journal_lines;
create constraint trigger je_balanced after insert on public.journal_lines
  deferrable initially deferred for each row execute function public.trg_je_balanced();

-- الترحيل فقط إلى حسابات فرعية فعّالة
create or replace function public.trg_jl_account_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare a public.accounts%rowtype;
begin
  select * into a from public.accounts where id = new.account_id;
  if not found or a.is_group then raise exception 'ACCOUNT_IS_GROUP: لا يُرحَّل إلى حساب رئيسي (%)', coalesce(a.code, '?'); end if;
  if not a.is_active then raise exception 'ACCOUNT_INACTIVE: الحساب % موقوف', a.code; end if;
  return new;
end $$;
drop trigger if exists jl_account_check on public.journal_lines;
create trigger jl_account_check before insert on public.journal_lines
  for each row execute function public.trg_jl_account_check();

-- ───────────────────────── 4) الأمان (RLS) ─────────────────────────
alter table public.accounts         enable row level security;
alter table public.account_mappings enable row level security;
alter table public.journal_entries  enable row level security;
alter table public.journal_lines    enable row level security;

drop policy if exists sel on public.accounts;
drop policy if exists ins on public.accounts;
drop policy if exists upd on public.accounts;
drop policy if exists del on public.accounts;
create policy sel on public.accounts for select to authenticated using (true);
create policy ins on public.accounts for insert to authenticated with check (public.has_permission('accounting', 'create'));
create policy upd on public.accounts for update to authenticated
  using (public.has_permission('accounting', 'update')) with check (public.has_permission('accounting', 'update'));
create policy del on public.accounts for delete to authenticated using (public.has_permission('accounting', 'delete'));

drop policy if exists sel on public.account_mappings;
drop policy if exists upd on public.account_mappings;
create policy sel on public.account_mappings for select to authenticated using (true);
create policy upd on public.account_mappings for update to authenticated
  using (public.has_permission('accounting', 'approve')) with check (public.has_permission('accounting', 'approve'));

-- القيود: قراءة فقط حسب الفرع والصلاحية؛ الكتابة عبر الدوال فقط
drop policy if exists sel on public.journal_entries;
drop policy if exists sel on public.journal_lines;
create policy sel on public.journal_entries for select to authenticated
  using (public.has_permission('accounting', 'view') and public.can_access_branch(branch_id));
create policy sel on public.journal_lines for select to authenticated
  using (public.has_permission('accounting', 'view') and public.can_access_branch(branch_id));

-- تدقيق تعديلات الدليل وإعدادات الربط
drop trigger if exists audit on public.accounts;
create trigger audit after insert or update or delete on public.accounts
  for each row execute function public.trg_audit('accounting');
drop trigger if exists audit on public.account_mappings;
create trigger audit after insert or update or delete on public.account_mappings
  for each row execute function public.trg_audit('accounting');

-- ───────────────────────── 5) الصلاحيات ─────────────────────────
insert into public.permissions (module, action)
select 'accounting', a from unnest(array['view','create','update','delete','print','export','approve','cancel']) as a
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.module = 'accounting'
where r.code in ('super_admin','head_office')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.module = 'accounting'
where r.code = 'accountant' and p.action in ('view','create','update','print','export','approve','cancel')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.module = 'accounting'
where r.code = 'branch_manager' and p.action in ('view','print','export')
on conflict do nothing;

-- ───────────────────────── 6) الدليل المحاسبي الافتراضي ─────────────────────────
-- (الرمز، الاسم، النوع، رمز الأب، مجموعة؟)
do $$
declare r record;
begin
  for r in select * from (values
    ('1',    'الأصول',                         'asset',     null,  true),
    ('11',   'الأصول المتداولة',               'asset',     '1',   true),
    ('1101', 'النقدية بالصناديق',              'asset',     '11',  false),
    ('1102', 'الحسابات البنكية',               'asset',     '11',  false),
    ('1103', 'المحافظ والتحويلات الإلكترونية', 'asset',     '11',  false),
    ('1110', 'العملاء (ذمم مدينة)',            'asset',     '11',  false),
    ('1120', 'المخزون',                        'asset',     '11',  false),
    ('1130', 'بضاعة في الطريق',                'asset',     '11',  false),
    ('1140', 'ضريبة القيمة المضافة - مدخلات',  'asset',     '11',  false),
    ('1150', 'سلف الموظفين',                   'asset',     '11',  false),
    ('1160', 'حسابات ما بين الفروع',           'asset',     '11',  false),
    ('12',   'الأصول الثابتة',                 'asset',     '1',   true),
    ('1201', 'الأثاث والتجهيزات',              'asset',     '12',  false),
    ('1202', 'المعدات والأجهزة',               'asset',     '12',  false),
    ('1203', 'مجمع الإهلاك',                   'asset',     '12',  false),
    ('2',    'الخصوم',                         'liability', null,  true),
    ('21',   'الخصوم المتداولة',               'liability', '2',   true),
    ('2101', 'الموردون (ذمم دائنة)',           'liability', '21',  false),
    ('2102', 'رواتب وأجور مستحقة',             'liability', '21',  false),
    ('2103', 'ضريبة القيمة المضافة - مخرجات',  'liability', '21',  false),
    ('2104', 'مصروفات مستحقة',                 'liability', '21',  false),
    ('22',   'الخصوم طويلة الأجل',             'liability', '2',   true),
    ('2201', 'قروض طويلة الأجل',               'liability', '22',  false),
    ('3',    'حقوق الملكية',                   'equity',    null,  true),
    ('3101', 'رأس المال',                      'equity',    '3',   false),
    ('3102', 'جاري الشركاء',                   'equity',    '3',   false),
    ('3103', 'الأرباح المبقاة',                'equity',    '3',   false),
    ('3104', 'أرصدة افتتاحية',                 'equity',    '3',   false),
    ('4',    'الإيرادات',                      'revenue',   null,  true),
    ('41',   'إيرادات المبيعات',               'revenue',   '4',   true),
    ('4101', 'المبيعات',                       'revenue',   '41',  false),
    ('4102', 'مردودات المبيعات',               'revenue',   '41',  false),
    ('4103', 'خصومات المبيعات',                'revenue',   '41',  false),
    ('42',   'إيرادات أخرى',                   'revenue',   '4',   true),
    ('4201', 'إيرادات أخرى',                   'revenue',   '42',  false),
    ('5',    'تكلفة المبيعات',                 'expense',   null,  true),
    ('5101', 'تكلفة البضاعة المباعة',          'expense',   '5',   false),
    ('5102', 'فروقات الجرد',                   'expense',   '5',   false),
    ('5103', 'تالف وهالك',                     'expense',   '5',   false),
    ('5104', 'فروقات استلام التحويلات',        'expense',   '5',   false),
    ('6',    'المصروفات التشغيلية',            'expense',   null,  true),
    ('61',   'الرواتب والأجور',                'expense',   '6',   true),
    ('6101', 'الرواتب الأساسية',               'expense',   '61',  false),
    ('6102', 'المكافآت والحوافز',              'expense',   '61',  false),
    ('6103', 'خصومات وجزاءات الموظفين',        'expense',   '61',  false),
    ('6104', 'عمولات المبيعات',                'expense',   '61',  false),
    ('62',   'مصروفات التشغيل',                'expense',   '6',   true),
    ('6201', 'إيجارات',                        'expense',   '62',  false),
    ('6202', 'كهرباء',                         'expense',   '62',  false),
    ('6203', 'مياه',                           'expense',   '62',  false),
    ('6204', 'إنترنت واتصالات',                'expense',   '62',  false),
    ('6290', 'عجز وزيادة الصندوق',             'expense',   '62',  false),
    ('6299', 'مصروفات أخرى',                   'expense',   '62',  false)
  ) as t(code, name, atype, parent, grp)
  loop
    insert into public.accounts (code, name, account_type, parent_id, is_group, is_system)
    values (r.code, r.name, r.atype::public.account_type,
            (select id from public.accounts where code = r.parent), r.grp, true)
    on conflict (code) do nothing;
  end loop;
end $$;

-- أدوار الترحيل (المفتاح المنطقي ← الحساب الافتراضي)
insert into public.account_mappings (key, label, account_id)
select m.key, m.label, a.id
from (values
  ('cash_default',        'الصندوق الافتراضي (عند غياب طريقة الدفع)', '1101'),
  ('receivables',         'العملاء (ذمم مدينة)',                      '1110'),
  ('inventory',           'المخزون',                                  '1120'),
  ('inventory_transit',   'بضاعة في الطريق',                          '1130'),
  ('vat_input',           'ضريبة المشتريات (مدخلات)',                 '1140'),
  ('employee_advances',   'سلف الموظفين',                             '1150'),
  ('inter_branch',        'حسابات ما بين الفروع',                     '1160'),
  ('payables',            'الموردون (ذمم دائنة)',                     '2101'),
  ('payroll_payable',     'رواتب وأجور مستحقة',                       '2102'),
  ('vat_output',          'ضريبة المبيعات (مخرجات)',                  '2103'),
  ('opening_equity',      'أرصدة افتتاحية',                           '3104'),
  ('sales_revenue',       'المبيعات',                                 '4101'),
  ('sales_returns',       'مردودات المبيعات',                         '4102'),
  ('sales_discount',      'خصومات المبيعات',                          '4103'),
  ('other_income_default','إيرادات أخرى (افتراضي)',                   '4201'),
  ('cogs',                'تكلفة البضاعة المباعة',                    '5101'),
  ('stock_count_diff',    'فروقات الجرد',                             '5102'),
  ('damaged_loss',        'تالف وهالك',                               '5103'),
  ('transfer_loss',       'فروقات استلام التحويلات',                  '5104'),
  ('payroll_base',        'الرواتب الأساسية',                         '6101'),
  ('payroll_bonus',       'المكافآت والحوافز',                        '6102'),
  ('payroll_deduction',   'خصومات وجزاءات الموظفين',                  '6103'),
  ('payroll_commission',  'عمولات المبيعات',                          '6104'),
  ('cash_difference',     'عجز وزيادة الصندوق',                       '6290'),
  ('expense_default',     'مصروفات أخرى (افتراضي)',                   '6299')
) as m(key, label, code)
join public.accounts a on a.code = m.code
on conflict (key) do nothing;

-- ───────────────────────── 7) ربط الجداول المرجعية بالحسابات ─────────────────────────
-- حساب طريقة الدفع حسب نوعها (قابل للتغيير لكل طريقة من شاشة طرق الدفع)
create or replace function public.trg_method_default_account() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.account_id is null then
    select id into new.account_id from public.accounts
     where code = case new.type::text when 'cash' then '1101' when 'bank' then '1102'
                                      when 'transfer' then '1102' else '1103' end;
  end if;
  return new;
end $$;
drop trigger if exists default_account on public.payment_methods;
create trigger default_account before insert on public.payment_methods
  for each row execute function public.trg_method_default_account();

create or replace function public.trg_expense_cat_default_account() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.account_id is null then
    select id into new.account_id from public.accounts
     where code = case new.kind::text when 'salary' then '6101' when 'commission' then '6104'
                                      when 'rent' then '6201' when 'electricity' then '6202'
                                      when 'water' then '6203' when 'internet' then '6204' else '6299' end;
  end if;
  return new;
end $$;
drop trigger if exists default_account on public.expense_categories;
create trigger default_account before insert on public.expense_categories
  for each row execute function public.trg_expense_cat_default_account();

create or replace function public.trg_income_type_default_account() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.account_id is null then
    select id into new.account_id from public.accounts where code = '4201';
  end if;
  return new;
end $$;
drop trigger if exists default_account on public.income_types;
create trigger default_account before insert on public.income_types
  for each row execute function public.trg_income_type_default_account();

-- تعبئة السجلات القائمة
update public.payment_methods pm set account_id = (select id from public.accounts
   where code = case pm.type::text when 'cash' then '1101' when 'bank' then '1102' when 'transfer' then '1102' else '1103' end)
 where pm.account_id is null;
update public.expense_categories ec set account_id = (select id from public.accounts
   where code = case ec.kind::text when 'salary' then '6101' when 'commission' then '6104' when 'rent' then '6201'
                                   when 'electricity' then '6202' when 'water' then '6203' when 'internet' then '6204' else '6299' end)
 where ec.account_id is null;
update public.income_types set account_id = (select id from public.accounts where code = '4201') where account_id is null;

-- ───────────────────────── 8) محرك الترحيل ─────────────────────────
create or replace function public.internal_acc(p_key text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  select account_id into v from public.account_mappings where key = p_key;
  if v is null then raise exception 'ACCOUNT_MAPPING_MISSING: %', p_key; end if;
  return v;
end $$;

-- حساب طريقة الدفع (وإلا الصندوق الافتراضي)
create or replace function public.internal_method_acc(p_method uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce((select account_id from public.payment_methods where id = p_method), public.internal_acc('cash_default'))
$$;

create or replace function public.internal_main_branch() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.branches where type = 'main_warehouse' limit 1
$$;

-- سطر قيد بصيغة JSON (القيم الفارغة تُحذف)
create or replace function public.internal_line(p_account uuid, p_debit numeric, p_credit numeric,
  p_branch uuid default null, p_memo text default null, p_party_type text default null, p_party uuid default null)
returns jsonb language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object('account_id', p_account, 'debit', p_debit, 'credit', p_credit,
    'branch_id', p_branch, 'memo', p_memo, 'party_type', p_party_type, 'party_id', p_party))
$$;

-- عكس قيد: قيد جديد بالأطراف معكوسة، ويُوسم الأصلي «معكوس»
create or replace function public.internal_reverse_je(p_entry uuid, p_date date default current_date, p_reason text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare e public.journal_entries%rowtype; v_id uuid;
begin
  select * into e from public.journal_entries where id = p_entry for update;
  if not found then raise exception 'ENTRY_NOT_FOUND'; end if;
  if e.status <> 'posted' or e.reversal_of is not null then raise exception 'ENTRY_NOT_REVERSIBLE'; end if;
  insert into public.journal_entries (entry_date, branch_id, description, source_type, source_id, source_event, reversal_of)
  values (coalesce(p_date, current_date), e.branch_id,
          'عكس القيد ' || e.entry_no || coalesce(' — ' || p_reason, ''), e.source_type, e.source_id, e.source_event, e.id)
  returning id into v_id;
  insert into public.journal_lines (entry_id, line_no, account_id, branch_id, debit, credit, memo, party_type, party_id)
  select v_id, line_no, account_id, branch_id, credit, debit, memo, party_type, party_id
    from public.journal_lines where entry_id = e.id;
  update public.journal_entries set status = 'reversed', reversed_by = v_id where id = e.id;
  return v_id;
end $$;

-- ترحيل قيد: p_lines = [{account_id, debit?, credit?, branch_id?, memo?, party_type?, party_id?}]
-- idempotent حسب (المصدر، الحدث). p_replace = true يعكس القيد الفعّال ويُنشئ بديلاً (للأرصدة الافتتاحية).
create or replace function public.internal_post_je(
  p_source_type text, p_source_id text, p_event text, p_date date, p_branch uuid,
  p_desc text, p_lines jsonb, p_replace boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_old uuid; l jsonb; v_n int := 0; v_net numeric;
begin
  if p_source_type is not null then
    select id into v_old from public.journal_entries
     where source_type = p_source_type and source_id = p_source_id and source_event = p_event
       and reversal_of is null and status = 'posted';
    if v_old is not null then
      if not p_replace then return v_old; end if;
      perform public.internal_reverse_je(v_old, p_date, 'تحديث المصدر');
    end if;
  end if;

  if not exists (
    select 1 from jsonb_array_elements(p_lines) e
     where round(coalesce((e ->> 'debit')::numeric, 0) - coalesce((e ->> 'credit')::numeric, 0), 2) <> 0
  ) then return null; end if;

  insert into public.journal_entries (entry_date, branch_id, description, source_type, source_id, source_event)
  values (coalesce(p_date, current_date), p_branch, p_desc, p_source_type, p_source_id, p_event)
  returning id into v_id;

  for l in select * from jsonb_array_elements(p_lines) loop
    v_net := round(coalesce((l ->> 'debit')::numeric, 0) - coalesce((l ->> 'credit')::numeric, 0), 2);
    continue when v_net = 0;
    v_n := v_n + 1;
    insert into public.journal_lines (entry_id, line_no, account_id, branch_id, debit, credit, memo, party_type, party_id)
    values (v_id, v_n, (l ->> 'account_id')::uuid, coalesce(nullif(l ->> 'branch_id', '')::uuid, p_branch),
            greatest(v_net, 0), greatest(-v_net, 0), l ->> 'memo', l ->> 'party_type', nullif(l ->> 'party_id', '')::uuid);
  end loop;
  return v_id;
end $$;

-- Trigger عام: يستدعي دالة الترحيل المسمّاة في أول وسيط ويمرّر لها id السجل
create or replace function public.trg_acc_post() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  execute format('select public.%I($1)', tg_argv[0]) using new.id;
  return null;
end $$;

-- ───────────────────────── 9) دوال الترحيل لكل مستند ─────────────────────────
-- ===== فاتورة بيع: النقد/البنك/العملاء ← المبيعات + الضريبة، وتكلفة المبيعات ← المخزون =====
create or replace function public.internal_post_sale(p_inv uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  i public.sales_invoices%rowtype; r record; v_lines jsonb := '[]'::jsonb; v_paid numeric := 0; v_cogs numeric;
begin
  select * into i from public.sales_invoices where id = p_inv;
  if not found or i.status = 'cancelled' then return; end if;

  for r in select public.internal_method_acc(sp.payment_method_id) as acc, sum(sp.amount) as amt
             from public.sales_payments sp where sp.invoice_id = p_inv group by 1
  loop
    v_lines := v_lines || public.internal_line(r.acc, r.amt, 0, i.branch_id, 'تحصيل نقطة البيع');
    v_paid := v_paid + r.amt;
  end loop;
  v_lines := v_lines
    || public.internal_line(public.internal_acc('receivables'), i.total - v_paid, 0, i.branch_id, 'بيع آجل', 'customer', i.customer_id)
    || public.internal_line(public.internal_acc('sales_revenue'), 0, i.subtotal, i.branch_id)
    || public.internal_line(public.internal_acc('sales_discount'), i.discount, 0, i.branch_id)
    || public.internal_line(public.internal_acc('vat_output'), 0, i.tax_amount, i.branch_id);

  select round(coalesce(sum(qty * unit_cost), 0), 2) into v_cogs from public.sales_invoice_items where invoice_id = p_inv;
  v_lines := v_lines
    || public.internal_line(public.internal_acc('cogs'), v_cogs, 0, i.branch_id)
    || public.internal_line(public.internal_acc('inventory'), 0, v_cogs, i.branch_id);

  perform public.internal_post_je('sales_invoices', p_inv::text, 'sale', i.invoice_date::date, i.branch_id,
                                  'فاتورة بيع ' || i.invoice_no, v_lines);
end $$;

-- ===== تحصيل من عميل =====
create or replace function public.internal_post_customer_payment(p_pay uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.customer_payments%rowtype;
begin
  select * into c from public.customer_payments where id = p_pay;
  if not found then return; end if;
  perform public.internal_post_je('customer_payments', p_pay::text, 'collect', c.paid_at, c.branch_id, 'تحصيل من عميل',
    jsonb_build_array(
      public.internal_line(public.internal_method_acc(c.payment_method_id), c.amount, 0, c.branch_id),
      public.internal_line(public.internal_acc('receivables'), 0, c.amount, c.branch_id, null, 'customer', c.customer_id)));
end $$;

-- ===== مرتجع مبيعات: مردودات + ضريبة ← رد القيمة، وإعادة السلعة السليمة للمخزون بتكلفتها =====
create or replace function public.internal_post_sales_return(p_ret uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sales_returns%rowtype; v_gross numeric; v_tax numeric; v_cost numeric; v_net numeric;
begin
  select * into s from public.sales_returns where id = p_ret;
  if not found or s.status <> 'posted' then return; end if;

  select coalesce(sum(sri.refund_amount), 0),
         coalesce(sum(case when sii.line_total > 0
                      then sri.refund_amount * (sii.line_total - (sii.qty * sii.unit_price - sii.discount)) / sii.line_total
                      else 0 end), 0),
         coalesce(sum(case when sri.condition = 'resalable' then sri.qty * sii.unit_cost else 0 end), 0)
    into v_gross, v_tax, v_cost
    from public.sales_return_items sri
    join public.sales_invoice_items sii on sii.id = sri.invoice_item_id
   where sri.return_id = p_ret;
  v_tax := round(v_tax, 2); v_cost := round(v_cost, 2); v_net := v_gross - v_tax;

  perform public.internal_post_je('sales_returns', p_ret::text, 'return', s.return_date::date, s.branch_id,
    'مرتجع مبيعات ' || s.return_no,
    jsonb_build_array(
      public.internal_line(public.internal_acc('sales_returns'), v_net, 0, s.branch_id),
      public.internal_line(public.internal_acc('vat_output'), v_tax, 0, s.branch_id),
      public.internal_line(public.internal_method_acc(s.refund_method_id), 0, v_gross, s.branch_id, 'رد قيمة المرتجع'),
      public.internal_line(public.internal_acc('inventory'), v_cost, 0, s.branch_id),
      public.internal_line(public.internal_acc('cogs'), 0, v_cost, s.branch_id)));
end $$;

-- ===== استبدال: مرتجع الأصناف القديمة + بيع الجديدة + تسوية الفرق =====
create or replace function public.internal_post_exchange(p_ex uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  x public.exchanges%rowtype; v_rg numeric; v_rt numeric; v_ret_cost numeric; v_ret_tax numeric; v_ret_net numeric;
  v_given_net numeric; v_given_tax numeric; v_given_cost numeric; v_diff numeric; v_lines jsonb;
begin
  select * into x from public.exchanges where id = p_ex;
  if not found or x.status <> 'posted' then return; end if;

  select coalesce(sum(ei.qty * sii.line_total / sii.qty), 0),
         coalesce(sum(ei.qty * (sii.line_total - (sii.qty * sii.unit_price - sii.discount)) / sii.qty), 0),
         coalesce(sum(case when ei.condition = 'resalable' then ei.qty * sii.unit_cost else 0 end), 0)
    into v_rg, v_rt, v_ret_cost
    from public.exchange_items ei join public.sales_invoice_items sii on sii.id = ei.invoice_item_id
   where ei.exchange_id = p_ex and ei.direction = 'returned';
  v_ret_tax := case when v_rg > 0 then round(x.returned_total * v_rt / v_rg, 2) else 0 end;
  v_ret_net := x.returned_total - v_ret_tax;
  v_ret_cost := round(v_ret_cost, 2);

  select coalesce(sum(qty * unit_price), 0) into v_given_net
    from public.exchange_items where exchange_id = p_ex and direction = 'given';
  v_given_net := round(v_given_net, 2);
  v_given_tax := x.new_total - v_given_net;

  select round(coalesce(sum(qty_out * unit_cost), 0), 2) into v_given_cost
    from public.stock_movements where ref_type = 'exchanges' and ref_id = p_ex and movement_type = 'exchange_out';

  v_diff := x.new_total - x.returned_total;
  v_lines := jsonb_build_array(
    public.internal_line(public.internal_acc('sales_returns'), v_ret_net, 0, x.branch_id),
    public.internal_line(public.internal_acc('vat_output'), v_ret_tax, 0, x.branch_id),
    public.internal_line(public.internal_acc('sales_revenue'), 0, v_given_net, x.branch_id),
    public.internal_line(public.internal_acc('vat_output'), 0, v_given_tax, x.branch_id),
    public.internal_line(public.internal_method_acc(x.settlement_method_id), greatest(v_diff, 0), greatest(-v_diff, 0), x.branch_id, 'تسوية فرق الاستبدال'),
    public.internal_line(public.internal_acc('inventory'), v_ret_cost, 0, x.branch_id),
    public.internal_line(public.internal_acc('cogs'), 0, v_ret_cost, x.branch_id),
    public.internal_line(public.internal_acc('cogs'), v_given_cost, 0, x.branch_id),
    public.internal_line(public.internal_acc('inventory'), 0, v_given_cost, x.branch_id));

  perform public.internal_post_je('exchanges', p_ex::text, 'exchange', x.created_at::date, x.branch_id,
                                  'استبدال ' || x.exchange_no, v_lines);
end $$;

-- ===== فاتورة شراء: المخزون + ضريبة المدخلات ← الموردون =====
create or replace function public.internal_post_purchase(p_inv uuid) returns void
language plpgsql security definer set search_path = public as $$
declare i public.purchase_invoices%rowtype;
begin
  select * into i from public.purchase_invoices where id = p_inv;
  if not found or i.status <> 'posted' then return; end if;
  perform public.internal_post_je('purchase_invoices', p_inv::text, 'purchase', i.invoice_date, i.branch_id,
    'فاتورة شراء ' || i.invoice_no,
    jsonb_build_array(
      public.internal_line(public.internal_acc('inventory'), i.total - i.tax_amount, 0, i.branch_id),
      public.internal_line(public.internal_acc('vat_input'), i.tax_amount, 0, i.branch_id),
      public.internal_line(public.internal_acc('payables'), 0, i.total, i.branch_id, null, 'supplier', i.supplier_id)));
end $$;

-- ===== دفعة لمورد =====
create or replace function public.internal_post_supplier_payment(p_pay uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p public.supplier_payments%rowtype; v_branch uuid;
begin
  select * into p from public.supplier_payments where id = p_pay;
  if not found then return; end if;
  select branch_id into v_branch from public.purchase_invoices where id = p.invoice_id;
  v_branch := coalesce(v_branch, public.internal_main_branch());
  perform public.internal_post_je('supplier_payments', p_pay::text, 'pay', p.paid_at, v_branch, 'دفعة لمورد',
    jsonb_build_array(
      public.internal_line(public.internal_acc('payables'), p.amount, 0, v_branch, null, 'supplier', p.supplier_id),
      public.internal_line(public.internal_method_acc(p.payment_method_id), 0, p.amount, v_branch)));
end $$;

-- ===== مرتجع مشتريات =====
create or replace function public.internal_post_purchase_return(p_ret uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_r public.purchase_returns%rowtype; v_tax numeric;
begin
  select * into v_r from public.purchase_returns where id = p_ret;
  if not found or v_r.status <> 'posted' then return; end if;
  select round(coalesce(sum(case when ii.line_total > 0
                           then pri.line_total * (ii.line_total - (ii.qty * ii.unit_cost - ii.discount)) / ii.line_total
                           else 0 end), 0), 2)
    into v_tax
    from public.purchase_return_items pri
    left join lateral (select x.* from public.purchase_invoice_items x
                        where x.invoice_id = v_r.invoice_id and x.product_id = pri.product_id limit 1) ii on true
   where pri.return_id = p_ret;
  perform public.internal_post_je('purchase_returns', p_ret::text, 'return', v_r.return_date, v_r.branch_id,
    'مرتجع مشتريات ' || v_r.return_no,
    jsonb_build_array(
      public.internal_line(public.internal_acc('payables'), v_r.total, 0, v_r.branch_id, null, 'supplier', v_r.supplier_id),
      public.internal_line(public.internal_acc('inventory'), 0, v_r.total - v_tax, v_r.branch_id),
      public.internal_line(public.internal_acc('vat_input'), 0, v_tax, v_r.branch_id)));
end $$;

-- ===== مصروف (باستثناء مصروفات الرواتب فقيدها من كشف الراتب) =====
create or replace function public.internal_post_expense(p_exp uuid) returns void
language plpgsql security definer set search_path = public as $$
declare e public.expenses%rowtype; v_acc uuid; v_cat text;
begin
  select * into e from public.expenses where id = p_exp;
  if not found or e.status <> 'posted' or e.payroll_id is not null then return; end if;
  select coalesce(account_id, public.internal_acc('expense_default')), name into v_acc, v_cat
    from public.expense_categories where id = e.category_id;
  perform public.internal_post_je('expenses', p_exp::text, 'post', e.expense_date, e.branch_id,
    'مصروف: ' || coalesce(v_cat, '') || coalesce(' — ' || e.description, ''),
    jsonb_build_array(
      public.internal_line(v_acc, e.amount, 0, e.branch_id),
      public.internal_line(public.internal_method_acc(e.payment_method_id), 0, e.amount, e.branch_id)));
end $$;

-- إلغاء مصروف: عكس القيد + عكس حركة الصندوق (دفتر الصندوق لا يُحذف منه شيء)
create or replace function public.trg_acc_expense_cancel() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_je uuid;
begin
  if new.payroll_id is not null then raise exception 'PAYROLL_EXPENSE_LOCKED: مصروف مرتبط بكشف راتب'; end if;
  select id into v_je from public.journal_entries
   where source_type = 'expenses' and source_id = new.id::text and source_event = 'post'
     and reversal_of is null and status = 'posted';
  if v_je is not null then perform public.internal_reverse_je(v_je, current_date, 'إلغاء المصروف'); end if;
  insert into public.cash_transactions (branch_id, shift_id, payment_method_id, tx_type, direction, amount, ref_type, ref_id)
  values (new.branch_id, new.shift_id, new.payment_method_id, 'expense', 'in', new.amount, 'expenses', new.id);
  return new;
end $$;

-- ===== إيراد آخر =====
create or replace function public.internal_post_other_income(p_inc uuid) returns void
language plpgsql security definer set search_path = public as $$
declare i public.other_incomes%rowtype; v_acc uuid; v_type text;
begin
  select * into i from public.other_incomes where id = p_inc;
  if not found then return; end if;
  select coalesce(account_id, public.internal_acc('other_income_default')), name into v_acc, v_type
    from public.income_types where id = i.income_type_id;
  perform public.internal_post_je('other_incomes', p_inc::text, 'post', i.income_date, i.branch_id,
    'إيراد: ' || coalesce(v_type, '') || coalesce(' — ' || i.description, ''),
    jsonb_build_array(
      public.internal_line(public.internal_method_acc(i.payment_method_id), i.amount, 0, i.branch_id),
      public.internal_line(coalesce(v_acc, public.internal_acc('other_income_default')), 0, i.amount, i.branch_id)));
end $$;

-- ===== تالف يدوي: خسارة التالف ← المخزون (تالف المرتجعات يظهر أصلاً ضمن تكلفة المبيعات) =====
create or replace function public.internal_post_damage(p_dmg uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d public.damaged_items%rowtype;
begin
  select * into d from public.damaged_items where id = p_dmg;
  if not found or d.source_type <> 'manual' then return; end if;
  perform public.internal_post_je('damaged_items', p_dmg::text, 'damage', d.damaged_at, d.branch_id, 'تالف مخزون',
    jsonb_build_array(
      public.internal_line(public.internal_acc('damaged_loss'), d.total_value, 0, d.branch_id),
      public.internal_line(public.internal_acc('inventory'), 0, d.total_value, d.branch_id)));
end $$;

-- ===== اعتماد جرد: فروقات الجرد (زيادة/عجز) مقابل المخزون =====
create or replace function public.internal_post_stock_count(p_count uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.stock_counts%rowtype; v_gain numeric; v_loss numeric;
begin
  select * into c from public.stock_counts where id = p_count;
  if not found or c.status <> 'approved' then return; end if;
  select round(coalesce(sum(qty_in * unit_cost), 0), 2), round(coalesce(sum(qty_out * unit_cost), 0), 2)
    into v_gain, v_loss
    from public.stock_movements
   where ref_type = 'stock_counts' and ref_id = p_count and movement_type = 'count_adjustment';
  perform public.internal_post_je('stock_counts', p_count::text, 'approve', coalesce(c.approved_at::date, current_date),
    c.branch_id, 'فروقات جرد ' || c.count_no,
    jsonb_build_array(
      public.internal_line(public.internal_acc('inventory'), v_gain, 0, c.branch_id),
      public.internal_line(public.internal_acc('stock_count_diff'), 0, v_gain, c.branch_id, 'زيادة جرد'),
      public.internal_line(public.internal_acc('stock_count_diff'), v_loss, 0, c.branch_id, 'عجز جرد'),
      public.internal_line(public.internal_acc('inventory'), 0, v_loss, c.branch_id)));
end $$;

-- ===== تحويل بضاعة: الصرف (بضاعة في الطريق) ثم الاستلام (المخزون + فرق الاستلام) =====
-- الحسابات بين الفروع تجعل ميزانية كل فرع متوازنة، وتتلاشى عند توحيد الشركة
create or replace function public.internal_post_transfer_issue(p_trf uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.stock_transfers%rowtype; v_sent numeric;
begin
  select * into t from public.stock_transfers where id = p_trf;
  if not found then return; end if;
  select round(coalesce(sum(qty_sent * unit_cost), 0), 2) into v_sent from public.stock_transfer_items where transfer_id = p_trf;
  perform public.internal_post_je('stock_transfers', p_trf::text, 'issue', t.transfer_date, t.from_branch_id,
    'صرف تحويل ' || t.transfer_no,
    jsonb_build_array(
      public.internal_line(public.internal_acc('inventory_transit'), v_sent, 0, t.from_branch_id),
      public.internal_line(public.internal_acc('inventory'), 0, v_sent, t.from_branch_id)));
end $$;

create or replace function public.internal_post_transfer_receive(p_trf uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.stock_transfers%rowtype; v_sent numeric; v_recv numeric;
begin
  select * into t from public.stock_transfers where id = p_trf;
  if not found then return; end if;
  select round(coalesce(sum(qty_sent * unit_cost), 0), 2),
         round(coalesce(sum(coalesce(qty_received, qty_sent) * unit_cost), 0), 2)
    into v_sent, v_recv from public.stock_transfer_items where transfer_id = p_trf;
  perform public.internal_post_je('stock_transfers', p_trf::text, 'receive', coalesce(t.received_at::date, current_date),
    t.to_branch_id, 'استلام تحويل ' || t.transfer_no,
    jsonb_build_array(
      public.internal_line(public.internal_acc('inter_branch'), v_sent, 0, t.from_branch_id),
      public.internal_line(public.internal_acc('inventory_transit'), 0, v_sent, t.from_branch_id),
      public.internal_line(public.internal_acc('inventory'), v_recv, 0, t.to_branch_id),
      public.internal_line(public.internal_acc('transfer_loss'), v_sent - v_recv, 0, t.to_branch_id, 'فرق الاستلام'),
      public.internal_line(public.internal_acc('inter_branch'), 0, v_sent, t.to_branch_id)));
end $$;

-- ===== إغلاق وردية بفرق نقدي (عجز/زيادة) =====
create or replace function public.internal_post_shift_difference(p_shift uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.shifts%rowtype; v_d numeric;
begin
  select * into s from public.shifts where id = p_shift;
  if not found or s.status <> 'closed' or coalesce(s.difference, 0) = 0 then return; end if;
  v_d := s.difference;   -- موجب = زيادة في الصندوق، سالب = عجز
  perform public.internal_post_je('shifts', p_shift::text, 'close', coalesce(s.closed_at::date, current_date), s.branch_id,
    case when v_d > 0 then 'زيادة صندوق وردية' else 'عجز صندوق وردية' end,
    jsonb_build_array(
      public.internal_line(public.internal_acc('cash_default'), greatest(v_d, 0), greatest(-v_d, 0), s.branch_id),
      public.internal_line(public.internal_acc('cash_difference'), greatest(-v_d, 0), greatest(v_d, 0), s.branch_id)));
end $$;

-- ===== تسوية فرع معتمدة: سداد الفرع للإدارة (قيد + حركة في دفتر الصندوق) =====
create or replace function public.internal_post_settlement(p_set uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.branch_settlements%rowtype; v_main uuid := public.internal_main_branch(); v_acc uuid; v_done uuid;
begin
  select * into s from public.branch_settlements where id = p_set;
  if not found or s.status <> 'approved' then return; end if;
  select id into v_done from public.journal_entries
   where source_type = 'branch_settlements' and source_id = p_set::text and source_event = 'approve'
     and reversal_of is null and status = 'posted';
  if v_done is not null then return; end if;

  v_acc := public.internal_method_acc(s.payment_method_id);
  perform public.internal_post_je('branch_settlements', p_set::text, 'approve', s.settlement_date, s.branch_id,
    'تسوية فرع' || coalesce(' — ' || s.ref_no, ''),
    jsonb_build_array(
      public.internal_line(public.internal_acc('inter_branch'), s.amount, 0, s.branch_id),
      public.internal_line(v_acc, 0, s.amount, s.branch_id),
      public.internal_line(v_acc, s.amount, 0, v_main),
      public.internal_line(public.internal_acc('inter_branch'), 0, s.amount, v_main)));

  insert into public.cash_transactions (branch_id, payment_method_id, tx_type, direction, amount, ref_type, ref_id)
  values (s.branch_id, s.payment_method_id, 'settlement', 'out', s.amount, 'branch_settlements', s.id);
  if v_main is not null and v_main <> s.branch_id then
    insert into public.cash_transactions (branch_id, payment_method_id, tx_type, direction, amount, ref_type, ref_id)
    values (v_main, s.payment_method_id, 'settlement', 'in', s.amount, 'branch_settlements', s.id);
  end if;
end $$;

-- ===== الرواتب والأجور =====
-- (أ) عند اعتماد الكشف: المصروفات (أساسي + مكافآت − خصومات + عمولة) ← رواتب مستحقة، وتسديد السلف
create or replace function public.internal_post_payroll_accrual(p_pr uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pr public.payrolls%rowtype; v_emp text; v_y int; v_m int;
begin
  select * into pr from public.payrolls where id = p_pr;
  if not found or pr.status not in ('approved','paid') then return; end if;
  select e.full_name, per.year, per.month into v_emp, v_y, v_m
    from public.employees e, public.payroll_periods per where e.id = pr.employee_id and per.id = pr.period_id;
  perform public.internal_post_je('payrolls', p_pr::text, 'accrual', (make_date(v_y, v_m, 1) + interval '1 month' - interval '1 day')::date,
    pr.branch_id, 'استحقاق راتب ' || coalesce(v_emp, '') || ' — ' || v_y || '/' || v_m,
    jsonb_build_array(
      public.internal_line(public.internal_acc('payroll_base'), pr.base_salary, 0, pr.branch_id, null, 'employee', pr.employee_id),
      public.internal_line(public.internal_acc('payroll_bonus'), pr.bonuses, 0, pr.branch_id, null, 'employee', pr.employee_id),
      public.internal_line(public.internal_acc('payroll_commission'), pr.commission_amount, 0, pr.branch_id, null, 'employee', pr.employee_id),
      public.internal_line(public.internal_acc('payroll_deduction'), 0, pr.deductions, pr.branch_id, null, 'employee', pr.employee_id),
      public.internal_line(public.internal_acc('employee_advances'), 0, pr.advances, pr.branch_id, 'تسديد سلف', 'employee', pr.employee_id),
      public.internal_line(public.internal_acc('payroll_payable'), 0, pr.net_salary, pr.branch_id, null, 'employee', pr.employee_id)));
end $$;

-- (ب) عند الصرف: الرواتب المستحقة ← النقد/البنك
create or replace function public.internal_post_payroll_payment(p_pr uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pr public.payrolls%rowtype; v_emp text;
begin
  select * into pr from public.payrolls where id = p_pr;
  if not found or pr.status <> 'paid' then return; end if;
  select full_name into v_emp from public.employees where id = pr.employee_id;
  perform public.internal_post_je('payrolls', p_pr::text, 'payment', coalesce(pr.paid_at::date, current_date), pr.branch_id,
    'صرف راتب ' || coalesce(v_emp, ''),
    jsonb_build_array(
      public.internal_line(public.internal_acc('payroll_payable'), pr.net_salary, 0, pr.branch_id, null, 'employee', pr.employee_id),
      public.internal_line(public.internal_method_acc(pr.payment_method_id), 0, pr.net_salary, pr.branch_id)));
end $$;

-- (ج) سلفة موظف: سلف الموظفين ← النقد (p_cash = false للتعبئة التاريخية دون المساس بدفتر الصندوق)
create or replace function public.internal_post_advance(p_adj uuid, p_cash boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare a public.employee_adjustments%rowtype; v_branch uuid; v_method uuid;
begin
  select * into a from public.employee_adjustments where id = p_adj;
  if not found or a.adj_type <> 'advance' then return; end if;
  select branch_id into v_branch from public.employees where id = a.employee_id;
  v_branch := coalesce(v_branch, public.internal_main_branch());
  v_method := coalesce(a.payment_method_id,
                       (select id from public.payment_methods where is_cash and is_active order by created_at limit 1));
  perform public.internal_post_je('employee_adjustments', p_adj::text, 'advance', a.adj_date, v_branch,
    'سلفة موظف' || coalesce(' — ' || a.reason, ''),
    jsonb_build_array(
      public.internal_line(public.internal_acc('employee_advances'), a.amount, 0, v_branch, null, 'employee', a.employee_id),
      public.internal_line(public.internal_method_acc(v_method), 0, a.amount, v_branch)));
  if p_cash then
    insert into public.cash_transactions (branch_id, payment_method_id, tx_type, direction, amount, ref_type, ref_id)
    values (v_branch, v_method, 'salary', 'out', a.amount, 'employee_adjustments', a.id);
  end if;
end $$;

-- ===== الأرصدة الافتتاحية (عملاء/موردون/مخزون أول المدة) =====
create or replace function public.internal_post_customer_opening(p_cust uuid, p_replace boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare c public.customers%rowtype; v_main uuid := public.internal_main_branch();
begin
  select * into c from public.customers where id = p_cust;
  if not found then return; end if;
  perform public.internal_post_je('customers', p_cust::text, 'opening', c.created_at::date, v_main,
    'رصيد افتتاحي للعميل ' || c.name,
    jsonb_build_array(
      public.internal_line(public.internal_acc('receivables'), c.opening_balance, 0, v_main, null, 'customer', p_cust),
      public.internal_line(public.internal_acc('opening_equity'), 0, c.opening_balance, v_main)), p_replace);
end $$;

create or replace function public.internal_post_supplier_opening(p_sup uuid, p_replace boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare s public.suppliers%rowtype; v_main uuid := public.internal_main_branch();
begin
  select * into s from public.suppliers where id = p_sup;
  if not found then return; end if;
  perform public.internal_post_je('suppliers', p_sup::text, 'opening', s.created_at::date, v_main,
    'رصيد افتتاحي للمورد ' || s.name,
    jsonb_build_array(
      public.internal_line(public.internal_acc('opening_equity'), s.opening_balance, 0, v_main),
      public.internal_line(public.internal_acc('payables'), 0, s.opening_balance, v_main, null, 'supplier', p_sup)), p_replace);
end $$;

create or replace function public.internal_post_opening_stock(p_mv bigint) returns void
language plpgsql security definer set search_path = public as $$
declare m public.stock_movements%rowtype; v_val numeric;
begin
  select * into m from public.stock_movements where id = p_mv;
  if not found or m.movement_type <> 'opening' then return; end if;
  v_val := round(m.qty_in * m.unit_cost, 2);
  perform public.internal_post_je('stock_movements', p_mv::text, 'opening', m.created_at::date, m.branch_id, 'مخزون أول المدة',
    jsonb_build_array(
      public.internal_line(public.internal_acc('inventory'), v_val, 0, m.branch_id),
      public.internal_line(public.internal_acc('opening_equity'), 0, v_val, m.branch_id)));
end $$;

create or replace function public.trg_acc_opening_stock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.internal_post_opening_stock(new.id);
  return null;
end $$;

-- ───────────────────────── 10) الربط بالجداول التشغيلية (Triggers) ─────────────────────────
-- المستندات التي تُنشأ رأسها أولاً ثم تُحدَّث مجاميعها داخل نفس الدالة: الترحيل مؤجَّل لآخر المعاملة
drop trigger if exists acc_post on public.sales_invoices;
create constraint trigger acc_post after insert on public.sales_invoices
  deferrable initially deferred for each row when (new.status <> 'cancelled')
  execute function public.trg_acc_post('internal_post_sale');

drop trigger if exists acc_post on public.sales_returns;
create constraint trigger acc_post after insert on public.sales_returns
  deferrable initially deferred for each row when (new.status = 'posted')
  execute function public.trg_acc_post('internal_post_sales_return');

drop trigger if exists acc_post on public.exchanges;
create constraint trigger acc_post after insert on public.exchanges
  deferrable initially deferred for each row when (new.status = 'posted')
  execute function public.trg_acc_post('internal_post_exchange');

drop trigger if exists acc_post on public.purchase_invoices;
create constraint trigger acc_post after insert on public.purchase_invoices
  deferrable initially deferred for each row when (new.status = 'posted')
  execute function public.trg_acc_post('internal_post_purchase');

drop trigger if exists acc_post on public.purchase_returns;
create constraint trigger acc_post after insert on public.purchase_returns
  deferrable initially deferred for each row when (new.status = 'posted')
  execute function public.trg_acc_post('internal_post_purchase_return');

-- مستندات كاملة عند الإدخال
drop trigger if exists acc_post on public.customer_payments;
create trigger acc_post after insert on public.customer_payments
  for each row execute function public.trg_acc_post('internal_post_customer_payment');

drop trigger if exists acc_post on public.supplier_payments;
create trigger acc_post after insert on public.supplier_payments
  for each row execute function public.trg_acc_post('internal_post_supplier_payment');

drop trigger if exists acc_post on public.expenses;
create trigger acc_post after insert on public.expenses
  for each row when (new.status = 'posted' and new.payroll_id is null)
  execute function public.trg_acc_post('internal_post_expense');

drop trigger if exists acc_cancel on public.expenses;
create trigger acc_cancel after update of status on public.expenses
  for each row when (old.status = 'posted' and new.status = 'cancelled')
  execute function public.trg_acc_expense_cancel();

drop trigger if exists acc_post on public.other_incomes;
create trigger acc_post after insert on public.other_incomes
  for each row execute function public.trg_acc_post('internal_post_other_income');

drop trigger if exists acc_post on public.damaged_items;
create trigger acc_post after insert on public.damaged_items
  for each row when (new.source_type = 'manual')
  execute function public.trg_acc_post('internal_post_damage');

-- تغيّر الحالة
drop trigger if exists acc_post on public.stock_counts;
create trigger acc_post after update of status on public.stock_counts
  for each row when (old.status is distinct from 'approved' and new.status = 'approved')
  execute function public.trg_acc_post('internal_post_stock_count');

drop trigger if exists acc_issue on public.stock_transfers;
create trigger acc_issue after update of status on public.stock_transfers
  for each row when (old.status = 'created' and new.status = 'issued')
  execute function public.trg_acc_post('internal_post_transfer_issue');

drop trigger if exists acc_receive on public.stock_transfers;
create trigger acc_receive after update of status on public.stock_transfers
  for each row when (old.status in ('issued','in_transit') and new.status in ('received','has_difference'))
  execute function public.trg_acc_post('internal_post_transfer_receive');

drop trigger if exists acc_post on public.shifts;
create trigger acc_post after update of status on public.shifts
  for each row when (old.status = 'open' and new.status = 'closed' and coalesce(new.difference, 0) <> 0)
  execute function public.trg_acc_post('internal_post_shift_difference');

drop trigger if exists acc_post_ins on public.branch_settlements;
create trigger acc_post_ins after insert on public.branch_settlements
  for each row when (new.status = 'approved')
  execute function public.trg_acc_post('internal_post_settlement');
drop trigger if exists acc_post_upd on public.branch_settlements;
create trigger acc_post_upd after update of status on public.branch_settlements
  for each row when (old.status is distinct from 'approved' and new.status = 'approved')
  execute function public.trg_acc_post('internal_post_settlement');

drop trigger if exists acc_accrual on public.payrolls;
create trigger acc_accrual after update of status on public.payrolls
  for each row when (old.status = 'draft' and new.status = 'approved')
  execute function public.trg_acc_post('internal_post_payroll_accrual');

drop trigger if exists acc_payment on public.payrolls;
create trigger acc_payment after update of status on public.payrolls
  for each row when (old.status = 'approved' and new.status = 'paid')
  execute function public.trg_acc_post('internal_post_payroll_payment');

drop trigger if exists acc_post on public.employee_adjustments;
create trigger acc_post after insert on public.employee_adjustments
  for each row when (new.adj_type = 'advance')
  execute function public.trg_acc_post('internal_post_advance');

-- الأرصدة الافتتاحية
drop trigger if exists acc_open_ins on public.customers;
create trigger acc_open_ins after insert on public.customers
  for each row when (new.opening_balance <> 0)
  execute function public.trg_acc_post('internal_post_customer_opening');
drop trigger if exists acc_open_upd on public.customers;
create trigger acc_open_upd after update of opening_balance on public.customers
  for each row when (old.opening_balance is distinct from new.opening_balance)
  execute function public.trg_acc_post('internal_post_customer_opening');

drop trigger if exists acc_open_ins on public.suppliers;
create trigger acc_open_ins after insert on public.suppliers
  for each row when (new.opening_balance <> 0)
  execute function public.trg_acc_post('internal_post_supplier_opening');
drop trigger if exists acc_open_upd on public.suppliers;
create trigger acc_open_upd after update of opening_balance on public.suppliers
  for each row when (old.opening_balance is distinct from new.opening_balance)
  execute function public.trg_acc_post('internal_post_supplier_opening');

drop trigger if exists acc_opening on public.stock_movements;
create trigger acc_opening after insert on public.stock_movements
  for each row when (new.movement_type = 'opening')
  execute function public.trg_acc_opening_stock();

-- ───────────────────────── 11) صرف الرواتب (تحديث الدالة القائمة) ─────────────────────────
-- التغييرات عن النسخة السابقة فقط: (1) ربط مصروفي الراتب والعمولة بالكشف عبر payroll_id حتى لا يُرحَّلا مرتين،
-- (2) السلف المخصومة لم تخرج نقداً وقت الصرف (خرجت وقت منحها) فتُعاد في دفتر الصندوق ليبقى الخارج = الصافي.
create or replace function public.fn_pay_payroll(p_payroll uuid, p_method uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  pr public.payrolls%rowtype; v_sal_cat uuid; v_com_cat uuid; v_emp text; v_salary numeric;
  v_done int; v_recorded numeric := 0;
begin
  if not public.has_permission('payroll','approve') then raise exception 'FORBIDDEN'; end if;
  select * into pr from public.payrolls where id = p_payroll for update;
  if not found then raise exception 'PAYROLL_NOT_FOUND'; end if;
  if pr.status <> 'approved' then raise exception 'INVALID_STATUS: %', pr.status; end if;
  if not public.can_access_branch(pr.branch_id) then raise exception 'FORBIDDEN_BRANCH'; end if;

  select full_name into v_emp from public.employees where id = pr.employee_id;
  select id into v_sal_cat from public.expense_categories where kind = 'salary' and is_active order by created_at limit 1;
  select id into v_com_cat from public.expense_categories where kind = 'commission' and is_active order by created_at limit 1;
  v_salary := pr.base_salary + pr.bonuses - pr.deductions;

  if v_salary > 0 and v_sal_cat is not null then
    insert into public.expenses (branch_id, category_id, amount, payment_method_id, responsible_employee_id, description, payroll_id)
    values (pr.branch_id, v_sal_cat, v_salary, p_method, pr.employee_id, 'راتب ' || v_emp, pr.id);
    v_recorded := v_recorded + v_salary;
  end if;
  if pr.commission_amount > 0 and v_com_cat is not null then
    insert into public.expenses (branch_id, category_id, amount, payment_method_id, responsible_employee_id, description, payroll_id)
    values (pr.branch_id, v_com_cat, pr.commission_amount, p_method, pr.employee_id, 'عمولة ' || v_emp, pr.id);
    v_recorded := v_recorded + pr.commission_amount;
  end if;
  if pr.advances > 0 and v_recorded > 0 then
    insert into public.cash_transactions (branch_id, payment_method_id, tx_type, direction, amount, ref_type, ref_id)
    values (pr.branch_id, p_method, 'salary', 'in', least(pr.advances, v_recorded), 'payrolls', pr.id);
  end if;

  update public.payrolls set status = 'paid', paid_at = now(), payment_method_id = p_method where id = pr.id;
  update public.commissions set status = 'paid' where payroll_id = pr.id;

  select count(*) into v_done from public.payrolls where period_id = pr.period_id and status <> 'paid';
  if v_done = 0 then update public.payroll_periods set status = 'paid' where id = pr.period_id; end if;
end $$;

-- ───────────────────────── 12) دوال الواجهة (RPC) ─────────────────────────
-- قيد يومية يدوي: p = { entry_date, branch_id?, description, lines:[{account_id, debit?, credit?, branch_id?, memo?, party_type?, party_id?}] }
create or replace function public.fn_post_manual_journal(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_branch uuid := coalesce(nullif(p ->> 'branch_id', '')::uuid, public.internal_main_branch());
  l jsonb; v_d numeric := 0; v_c numeric := 0;
begin
  if not public.has_permission('accounting', 'create') then raise exception 'FORBIDDEN'; end if;
  if not public.can_access_branch(v_branch) then raise exception 'FORBIDDEN_BRANCH'; end if;
  if jsonb_array_length(coalesce(p -> 'lines', '[]'::jsonb)) < 2 then raise exception 'JE_NEEDS_TWO_LINES'; end if;
  for l in select * from jsonb_array_elements(p -> 'lines') loop
    if not public.can_access_branch(coalesce(nullif(l ->> 'branch_id', '')::uuid, v_branch)) then
      raise exception 'FORBIDDEN_BRANCH';
    end if;
    v_d := v_d + coalesce((l ->> 'debit')::numeric, 0);
    v_c := v_c + coalesce((l ->> 'credit')::numeric, 0);
  end loop;
  if v_d = 0 or round(v_d, 2) <> round(v_c, 2) then raise exception 'JE_UNBALANCED'; end if;
  return public.internal_post_je(null, null, null, coalesce(nullif(p ->> 'entry_date', '')::date, current_date),
                                 v_branch, nullif(p ->> 'description', ''), p -> 'lines');
end $$;

-- عكس قيد يدوي (قيود المستندات تُصحَّح من المستند نفسه)
create or replace function public.fn_reverse_journal_entry(p_entry uuid, p_reason text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare e public.journal_entries%rowtype;
begin
  if not public.has_permission('accounting', 'cancel') then raise exception 'FORBIDDEN'; end if;
  select * into e from public.journal_entries where id = p_entry;
  if not found then raise exception 'ENTRY_NOT_FOUND'; end if;
  if not public.can_access_branch(e.branch_id) then raise exception 'FORBIDDEN_BRANCH'; end if;
  if e.source_type is not null then raise exception 'ENTRY_IS_AUTOMATIC: قيد مولَّد من مستند'; end if;
  return public.internal_reverse_je(p_entry, current_date, p_reason);
end $$;

-- إقفال الفترة المحاسبية (يمنع القيود اليدوية حتى هذا التاريخ)
create or replace function public.fn_set_accounting_lock(p_date date) returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.has_permission('accounting', 'approve') then raise exception 'FORBIDDEN'; end if;
  select id into v_id from public.settings where key = 'accounting.lock_date' and branch_id is null;
  if v_id is null then
    insert into public.settings (key, value) values ('accounting.lock_date', jsonb_build_object('value', p_date));
  else
    update public.settings set value = jsonb_build_object('value', p_date) where id = v_id;
  end if;
end $$;

-- ───────────────────────── 13) التقارير المالية (من الأستاذ العام فقط) ─────────────────────────
-- ميزان المراجعة: رصيد أول المدة (مدين − دائن) + حركة الفترة + الرصيد الختامي
create or replace function public.fn_trial_balance(p_from date, p_to date, p_branch uuid default null)
returns table (account_id uuid, account_code text, account_name text, account_type public.account_type,
               parent_id uuid, is_group boolean, opening numeric, period_debit numeric, period_credit numeric, closing numeric)
language sql stable security invoker set search_path = public as $$
  select a.id, a.code, a.name, a.account_type, a.parent_id, a.is_group,
         coalesce(sum(x.debit - x.credit) filter (where x.entry_date < p_from), 0),
         coalesce(sum(x.debit)  filter (where x.entry_date between p_from and p_to), 0),
         coalesce(sum(x.credit) filter (where x.entry_date between p_from and p_to), 0),
         coalesce(sum(x.debit - x.credit) filter (where x.entry_date <= p_to), 0)
    from public.accounts a
    left join (select l.account_id, l.debit, l.credit, e.entry_date
                 from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
                where p_branch is null or l.branch_id = p_branch) x on x.account_id = a.id
   group by a.id
   order by a.code
$$;

-- قائمة الدخل: الإيرادات (دائن − مدين) والمصروفات (مدين − دائن) خلال الفترة
create or replace function public.fn_income_statement(p_from date, p_to date, p_branch uuid default null)
returns table (account_id uuid, account_code text, account_name text, account_type public.account_type,
               parent_id uuid, amount numeric)
language sql stable security invoker set search_path = public as $$
  select a.id, a.code, a.name, a.account_type, a.parent_id,
         coalesce(sum(case when a.account_type = 'revenue' then x.credit - x.debit else x.debit - x.credit end), 0)
    from public.accounts a
    left join (select l.account_id, l.debit, l.credit
                 from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
                where e.entry_date between p_from and p_to and (p_branch is null or l.branch_id = p_branch)) x
           on x.account_id = a.id
   where a.account_type in ('revenue', 'expense') and not a.is_group
   group by a.id
   order by a.code
$$;

-- الميزانية العمومية في تاريخ معيّن + سطر «صافي الربح غير المقفل» (حساب افتراضي رمزه 3999)
create or replace function public.fn_balance_sheet(p_as_of date, p_branch uuid default null)
returns table (account_id uuid, account_code text, account_name text, account_type public.account_type,
               parent_id uuid, amount numeric)
language sql stable security invoker set search_path = public as $$
  with x as (
    select l.account_id, l.debit, l.credit
      from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
     where e.entry_date <= p_as_of and (p_branch is null or l.branch_id = p_branch)
  )
  select a.id, a.code, a.name, a.account_type, a.parent_id,
         coalesce(sum(case when a.account_type = 'asset' then x.debit - x.credit else x.credit - x.debit end), 0)
    from public.accounts a left join x on x.account_id = a.id
   where a.account_type in ('asset', 'liability', 'equity') and not a.is_group
   group by a.id
  union all
  select null::uuid, '3999', 'صافي الربح (الخسارة) المرحّل غير المقفل', 'equity'::public.account_type,
         (select id from public.accounts where code = '3'),
         coalesce((select sum(x.credit - x.debit) from x join public.accounts a on a.id = x.account_id
                    where a.account_type in ('revenue', 'expense')), 0)
  order by 2
$$;

-- كشف حساب (دفتر الأستاذ) مع الرصيد الجاري
create or replace function public.fn_account_ledger(p_account uuid, p_from date, p_to date, p_branch uuid default null)
returns table (line_id bigint, entry_id uuid, entry_no text, entry_date date, description text, memo text,
               branch_id uuid, debit numeric, credit numeric, balance numeric)
language sql stable security invoker set search_path = public as $$
  with opening as (
    select coalesce(sum(l.debit - l.credit), 0) as amt
      from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
     where l.account_id = p_account and e.entry_date < p_from and (p_branch is null or l.branch_id = p_branch)
  ), ln as (
    select l.id as lid, l.entry_id as eid, e.entry_no as eno, e.entry_date as edate, e.description as edesc,
           l.memo as lmemo, l.branch_id as lbranch, l.debit as ldebit, l.credit as lcredit
      from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
     where l.account_id = p_account and e.entry_date between p_from and p_to and (p_branch is null or l.branch_id = p_branch)
  )
  select null::bigint, null::uuid, null::text, p_from, 'رصيد افتتاحي'::text, null::text, null::uuid,
         0::numeric, 0::numeric, (select amt from opening)
  union all
  select r.lid, r.eid, r.eno, r.edate, r.edesc, r.lmemo, r.lbranch, r.ldebit, r.lcredit,
         (select amt from opening) + sum(r.ldebit - r.lcredit) over (order by r.edate, r.lid)
    from ln r
  order by 4, 1 nulls first
$$;

-- مطابقة الأستاذ العام مع الدفاتر المساعدة: الفرق يجب أن يكون صفراً
create or replace view public.v_accounting_reconciliation with (security_invoker = true) as
select 'receivables'::text as code, 'العملاء'::text as label,
       coalesce((select sum(l.debit - l.credit) from public.journal_lines l join public.account_mappings m
                  on m.account_id = l.account_id and m.key = 'receivables'), 0) as ledger_balance,
       coalesce((select sum(balance_due) from public.v_customer_balance), 0) as subledger_balance
union all
select 'payables', 'الموردون',
       coalesce((select sum(l.credit - l.debit) from public.journal_lines l join public.account_mappings m
                  on m.account_id = l.account_id and m.key = 'payables'), 0),
       coalesce((select sum(balance) from public.v_supplier_balance), 0)
union all
select 'inventory', 'المخزون (بالتكلفة الفعلية للدفعات)',
       coalesce((select sum(l.debit - l.credit) from public.journal_lines l join public.account_mappings m
                  on m.account_id = l.account_id and m.key = 'inventory'), 0),
       coalesce((select sum(qty_on_hand * unit_cost) from public.stock_layers), 0)
union all
select 'payroll', 'رواتب مستحقة غير مصروفة',
       coalesce((select sum(l.credit - l.debit) from public.journal_lines l join public.account_mappings m
                  on m.account_id = l.account_id and m.key = 'payroll_payable'), 0),
       coalesce((select sum(net_salary) from public.payrolls where status = 'approved'), 0);

-- قائمة الدخل القديمة كانت تقديرية (مرتجعات شاملة الضريبة ومبيعات بدونها)؛ حلّت محلها fn_income_statement
drop view if exists public.v_branch_pnl;

-- ───────────────────────── 14) التعبئة التاريخية للبيانات القائمة ─────────────────────────
-- يرحّل المستندات الموجودة قبل هذا التصحيح (آمن عند التكرار: القيد الفعّال لا يتكرر)
do $$
declare r record; v_has_main boolean;
begin
  select exists (select 1 from public.branches where type = 'main_warehouse') into v_has_main;
  if not v_has_main then return; end if;

  -- مصروفات الرواتب القديمة تُوسم بكشفها لتُستثنى من الترحيل العادي
  update public.expenses x set payroll_id = pr.id
    from public.payrolls pr
   where x.payroll_id is null and pr.status = 'paid' and x.responsible_employee_id = pr.employee_id
     and x.branch_id = pr.branch_id and pr.paid_at is not null
     and x.created_at between pr.paid_at - interval '2 minutes' and pr.paid_at + interval '2 minutes'
     and x.category_id in (select id from public.expense_categories where kind in ('salary', 'commission'));

  for r in select id from public.customers where opening_balance <> 0 loop perform public.internal_post_customer_opening(r.id, false); end loop;
  for r in select id from public.suppliers where opening_balance <> 0 loop perform public.internal_post_supplier_opening(r.id, false); end loop;
  for r in select id from public.stock_movements where movement_type = 'opening' order by id loop perform public.internal_post_opening_stock(r.id); end loop;

  for r in select id from public.purchase_invoices where status = 'posted' order by invoice_date loop perform public.internal_post_purchase(r.id); end loop;
  for r in select id from public.supplier_payments order by paid_at loop perform public.internal_post_supplier_payment(r.id); end loop;
  for r in select id from public.purchase_returns where status = 'posted' loop perform public.internal_post_purchase_return(r.id); end loop;

  for r in select id from public.sales_invoices where status <> 'cancelled' order by invoice_date loop perform public.internal_post_sale(r.id); end loop;
  for r in select id from public.customer_payments order by paid_at loop perform public.internal_post_customer_payment(r.id); end loop;
  for r in select id from public.sales_returns where status = 'posted' loop perform public.internal_post_sales_return(r.id); end loop;
  for r in select id from public.exchanges where status = 'posted' loop perform public.internal_post_exchange(r.id); end loop;

  for r in select id from public.expenses where status = 'posted' and payroll_id is null order by expense_date loop perform public.internal_post_expense(r.id); end loop;
  for r in select id from public.other_incomes order by income_date loop perform public.internal_post_other_income(r.id); end loop;
  for r in select id from public.damaged_items where source_type = 'manual' loop perform public.internal_post_damage(r.id); end loop;
  for r in select id from public.stock_counts where status = 'approved' loop perform public.internal_post_stock_count(r.id); end loop;

  for r in select id, status from public.stock_transfers where status <> 'created' loop
    perform public.internal_post_transfer_issue(r.id);
    if r.status in ('received', 'has_difference') then perform public.internal_post_transfer_receive(r.id); end if;
  end loop;

  for r in select id from public.shifts where status = 'closed' and coalesce(difference, 0) <> 0 loop perform public.internal_post_shift_difference(r.id); end loop;
  for r in select id from public.branch_settlements where status = 'approved' loop
    -- القيد فقط: حركات الصندوق التاريخية لا تُنشأ بأثر رجعي
    perform public.internal_post_je('branch_settlements', r.id::text, 'approve',
      (select settlement_date from public.branch_settlements where id = r.id),
      (select branch_id from public.branch_settlements where id = r.id), 'تسوية فرع',
      jsonb_build_array(
        public.internal_line(public.internal_acc('inter_branch'), (select amount from public.branch_settlements where id = r.id), 0,
                             (select branch_id from public.branch_settlements where id = r.id)),
        public.internal_line(public.internal_method_acc((select payment_method_id from public.branch_settlements where id = r.id)), 0,
                             (select amount from public.branch_settlements where id = r.id), (select branch_id from public.branch_settlements where id = r.id)),
        public.internal_line(public.internal_method_acc((select payment_method_id from public.branch_settlements where id = r.id)),
                             (select amount from public.branch_settlements where id = r.id), 0, public.internal_main_branch()),
        public.internal_line(public.internal_acc('inter_branch'), 0, (select amount from public.branch_settlements where id = r.id), public.internal_main_branch())));
  end loop;

  for r in select id from public.employee_adjustments where adj_type = 'advance' order by adj_date loop perform public.internal_post_advance(r.id, false); end loop;
  for r in select id from public.payrolls where status in ('approved', 'paid') loop perform public.internal_post_payroll_accrual(r.id); end loop;
  for r in select id from public.payrolls where status = 'paid' loop perform public.internal_post_payroll_payment(r.id); end loop;
end $$;

-- ───────────────────────── 15) صلاحيات التنفيذ ─────────────────────────
-- دوال الترحيل الداخلية لا تُستدعى من الواجهة إطلاقاً (وإلا أمكن تزوير قيود)
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'internal\_post\_%' or p.proname in ('internal_acc','internal_line','internal_method_acc',
            'internal_main_branch','internal_reverse_je') or p.proname like 'trg\_acc\_%')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('fn_post_manual_journal','fn_reverse_journal_entry','fn_set_accounting_lock',
            'fn_trial_balance','fn_income_statement','fn_balance_sheet','fn_account_ledger')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;
