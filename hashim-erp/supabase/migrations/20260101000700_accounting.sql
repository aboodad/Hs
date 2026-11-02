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
