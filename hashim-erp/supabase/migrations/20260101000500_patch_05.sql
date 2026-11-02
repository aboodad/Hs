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
