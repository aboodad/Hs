// يولّد supabase/full_setup.sql من ملفات supabase/migrations بالترتيب — مصدر الحقيقة الوحيد هو مجلد migrations
// الاستخدام:  node scripts/build-full-setup.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase')
const files = readdirSync(join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort()

let out = `-- =====================================================================
--  هاشم للطيب والعطور — الإعداد الكامل لقاعدة البيانات في ملف واحد
--  ملف مولَّد تلقائياً من supabase/migrations — لا تعدّله يدوياً
--  أعد توليده بالأمر:  node scripts/build-full-setup.mjs
--  الصقه في Supabase > SQL Editor ونفّذه مرة واحدة على مشروع جديد فارغ
-- =====================================================================\n`
files.forEach((f, i) => {
  out += `\n\n-- ###################### ${i + 1}) ${f} ######################\n` + readFileSync(join(root, 'migrations', f), 'utf8')
})
writeFileSync(join(root, 'full_setup.sql'), out)
console.log(`full_setup.sql ← ${files.length} migrations (${out.length} chars)`)
