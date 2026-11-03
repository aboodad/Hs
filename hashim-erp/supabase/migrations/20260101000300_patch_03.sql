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
