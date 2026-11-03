// Edge Function: إدارة حسابات المستخدمين (إعداد أول مدير / إنشاء / إعادة تعيين كلمة المرور / إيقاف)
// تحتاج مفتاح service_role لذلك لا تعمل من الواجهة مباشرة.
// النشر:  supabase functions deploy manage-user
// المتغيرات (تُضاف تلقائياً في Supabase): SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const url = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })

  const body = await req.json().catch(() => ({}))
  const action: string = body.action

  // 0) الإعداد الأول: إنشاء أول مدير للنظام (يعمل فقط والجدول profiles فارغ)
  if (action === 'bootstrap') {
    try {
      const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true })
      if ((count ?? 0) > 0) return json({ error: 'تم إعداد النظام مسبقاً' }, 403)
      const { username, password, full_name } = body
      if (!username || !password || password.length < 6 || !full_name)
        return json({ error: 'أدخل الاسم واسم المستخدم وكلمة مرور (6 أحرف على الأقل)' }, 400)

      const { data: role } = await admin.from('roles').select('id').eq('code', 'super_admin').maybeSingle()
      const { data: branch } = await admin.from('branches').select('id').eq('type', 'main_warehouse').maybeSingle()
      if (!role || !branch) return json({ error: 'قاعدة البيانات غير مهيأة: شغّل ملفات SQL أولاً' }, 400)

      const mail = `${String(username).trim().toLowerCase()}@hashim.local`
      const { data: created, error } = await admin.auth.admin.createUser({ email: mail, password, email_confirm: true })
      if (error || !created.user) return json({ error: error?.message ?? 'تعذر إنشاء الحساب' }, 400)
      const { error: pErr } = await admin.from('profiles').insert({
        id: created.user.id, username: String(username).trim().toLowerCase(), full_name,
        role_id: role.id, branch_id: branch.id, is_active: true,
      })
      if (pErr) { await admin.auth.admin.deleteUser(created.user.id); return json({ error: pErr.message }, 400) }
      return json({ ok: true })
    } catch (e) {
      return json({ error: String(e) }, 500)
    }
  }

  // 1) التحقق من هوية المستدعي وصلاحيته (نفس دالة RLS في قاعدة البيانات)
  const { data: u } = await caller.auth.getUser()
  if (!u.user) return json({ error: 'غير مصرح' }, 401)

  const need = action === 'create' ? 'create' : 'update'
  const { data: ok } = await caller.rpc('has_permission', { p_module: 'users', p_action: need })
  if (!ok) return json({ error: 'ليست لديك صلاحية على المستخدمين' }, 403)

  try {
    if (action === 'create') {
      const { username, password, full_name, role_id, branch_id, employee_id, phone, email } = body
      if (!username || !password || password.length < 6 || !full_name || !role_id || !branch_id)
        return json({ error: 'بيانات ناقصة (اسم المستخدم، كلمة المرور 6+، الاسم، الدور، الفرع)' }, 400)

      // البريد الداخلي = username@hashim.local ما لم يُحدَّد بريد حقيقي
      const mail = (email as string | undefined)?.trim() || `${String(username).trim().toLowerCase()}@hashim.local`
      const { data: created, error } = await admin.auth.admin.createUser({ email: mail, password, email_confirm: true })
      if (error || !created.user) return json({ error: error?.message ?? 'تعذر إنشاء الحساب' }, 400)

      const { error: pErr } = await admin.from('profiles').insert({
        id: created.user.id, username: String(username).trim().toLowerCase(), full_name, role_id, branch_id,
        employee_id: employee_id || null, phone: phone || null, is_active: true,
      })
      if (pErr) {
        await admin.auth.admin.deleteUser(created.user.id) // تراجع كامل
        return json({ error: pErr.message }, 400)
      }
      return json({ ok: true, id: created.user.id })
    }

    if (action === 'reset_password') {
      const { user_id, password } = body
      if (!user_id || !password || password.length < 6) return json({ error: 'كلمة المرور 6 أحرف على الأقل' }, 400)
      const { error } = await admin.auth.admin.updateUserById(user_id, { password })
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    if (action === 'set_active') {
      const { user_id, active } = body
      if (user_id === u.user.id) return json({ error: 'لا يمكنك إيقاف حسابك' }, 400)
      const { error } = await admin.from('profiles').update({ is_active: !!active }).eq('id', user_id)
      if (error) return json({ error: error.message }, 400)
      // منع الدخول فعلياً عند الإيقاف
      await admin.auth.admin.updateUserById(user_id, { ban_duration: active ? 'none' : '876000h' })
      return json({ ok: true })
    }

    return json({ error: 'إجراء غير معروف' }, 400)
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
