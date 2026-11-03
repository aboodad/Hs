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
