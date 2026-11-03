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
