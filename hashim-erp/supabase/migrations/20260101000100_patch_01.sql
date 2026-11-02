-- تصحيح مطلوب للواجهات: علاقة created_by في طلبات البضاعة (تُستخدم لعرض "من أنشأ الطلب")
-- شغّله مرة واحدة بعد ملف hashim_erp_schema.sql
alter table public.stock_requests
  add constraint fk_requests_created_by
  foreign key (created_by) references public.profiles(id) on delete set null;
