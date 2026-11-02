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
