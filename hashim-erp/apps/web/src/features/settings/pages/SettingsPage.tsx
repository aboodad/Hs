import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Calculator, Coins, Database, FileText, Printer, Ruler, Save, Tags, Warehouse } from 'lucide-react'
import clsx from 'clsx'
import { supabase } from '@/lib/supabase'
import { errMsg } from '@/lib/errors'
import { toast } from '@/store/toast.store'
import { usePermission } from '@/hooks/usePermission'
import { saveBrandingCache, saveSetting, useSetting } from '@/hooks/useLookups'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { PaymentMethodsPage, TaxesPage, UnitsPage } from '@/features/lookups/pages/LookupPages'
import { DropZone } from '@/components/ui/DropZone'

const TABS = [
  { k: 'company', l: 'بيانات الشركة', i: Building2 }, { k: 'invoice', l: 'الفواتير والطباعة', i: Printer }, { k: 'commission', l: 'العمولات', i: Calculator },
  { k: 'inventory', l: 'المخزون والبيع', i: Warehouse }, { k: 'taxes', l: 'الضرائب', i: FileText }, { k: 'payments', l: 'طرق الدفع', i: Coins },
  { k: 'units', l: 'الوحدات', i: Ruler }, { k: 'categories', l: 'التصنيفات', i: Tags }, { k: 'backup', l: 'النسخ الاحتياطي', i: Database },
] as const

export default function SettingsPage() {
  const { can } = usePermission()
  const [tab, setTab] = useState<(typeof TABS)[number]['k']>('company')
  const canEdit = can('settings', 'update')

  return (
    <>
      <PageHeader title="إعدادات النظام" />
      <div className="grid gap-5 lg:grid-cols-[230px_1fr]">
        <nav className="card flex gap-1 overflow-x-auto p-2 lg:flex-col">
          {TABS.map((t) => (
            <button key={t.k} onClick={() => setTab(t.k)}
              className={clsx('flex items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-semibold transition', tab === t.k ? 'bg-brand-800 text-gold-200' : 'text-brand-500 hover:bg-cream-100')}>
              <t.i className="h-4 w-4" /> {t.l}
            </button>
          ))}
        </nav>
        <div className="min-w-0">
          {tab === 'company' && <CompanyTab canEdit={canEdit} />}
          {tab === 'invoice' && <InvoiceTab canEdit={canEdit} />}
          {tab === 'commission' && <CommissionTab canEdit={canEdit} />}
          {tab === 'inventory' && <InventoryTab canEdit={canEdit} />}
          {tab === 'taxes' && <TaxesPage />}
          {tab === 'payments' && <PaymentMethodsPage />}
          {tab === 'units' && <UnitsPage />}
          {tab === 'categories' && <div className="card p-8 text-center"><p className="mb-4 text-brand-500">تُدار التصنيفات من صفحتها المستقلة.</p><Link to="/categories" className="btn bg-brand-700 text-cream-50">فتح التصنيفات</Link></div>}
          {tab === 'backup' && <BackupTab />}
        </div>
      </div>
    </>
  )
}

function CompanyTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['company-full'], queryFn: async () => (await supabase.from('company_profile').select('*').limit(1).maybeSingle()).data })
  const [f, setF] = useState<any>({ name: '', tax_number: '', phone: '', address: '', invoice_footer: '', logo_url: '' })
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (data) setF({ ...f, ...data }) }, [data]) // eslint-disable-line

  const upload = async (file: File) => {
    const path = `logo/${crypto.randomUUID()}.${file.name.split('.').pop()}`
    const { error } = await supabase.storage.from('product-images').upload(path, file)
    if (error) return toast.error(errMsg(error))
    setF((s: any) => ({ ...s, logo_url: supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl }))
  }
  const save = async () => {
    setBusy(true)
    const payload = { name: f.name, tax_number: f.tax_number || null, phone: f.phone || null, address: f.address || null, invoice_footer: f.invoice_footer || null, logo_url: f.logo_url || null }
    const res = data?.id ? await supabase.from('company_profile').update(payload).eq('id', data.id) : await supabase.from('company_profile').insert(payload)
    setBusy(false)
    if (res.error) return toast.error(errMsg(res.error))
    toast.success('تم الحفظ'); saveBrandingCache({ name: f.name, logo_url: f.logo_url || null }); qc.invalidateQueries({ queryKey: ['company'] }); qc.invalidateQueries({ queryKey: ['company-full'] }); qc.invalidateQueries({ queryKey: ['branding'] })
  }
  return (
    <div className="card space-y-5 p-6">
      <h3 className="font-bold text-brand-800">بيانات الشركة</h3>
      {canEdit
        ? <DropZone accept="image/*" label="شعار الشركة" hint="يظهر في الفواتير وشاشة الدخول" previewUrl={f.logo_url} onChange={(file) => file && upload(file)} compact />
        : (f.logo_url && <img src={f.logo_url} className="h-20 rounded-2xl border border-cream-300 bg-white object-contain p-2" alt="" />)}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="اسم الشركة"><Input disabled={!canEdit} value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="الرقم الضريبي"><Input disabled={!canEdit} dir="ltr" value={f.tax_number ?? ''} onChange={(e) => setF({ ...f, tax_number: e.target.value })} /></Field>
        <Field label="الهاتف"><Input disabled={!canEdit} dir="ltr" value={f.phone ?? ''} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="العنوان"><Input disabled={!canEdit} value={f.address ?? ''} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <Field label="نص أسفل الفاتورة" className="sm:col-span-2"><Textarea disabled={!canEdit} value={f.invoice_footer ?? ''} onChange={(e) => setF({ ...f, invoice_footer: e.target.value })} /></Field>
      </div>
      {canEdit && <Button loading={busy} onClick={save}><Save className="h-4 w-4" /> حفظ</Button>}
    </div>
  )
}

function SettingCard({ title, children, onSave, canEdit, busy }: { title: string; children: React.ReactNode; onSave: () => void; canEdit: boolean; busy: boolean }) {
  return (<div className="card space-y-5 p-6"><h3 className="font-bold text-brand-800">{title}</h3>{children}{canEdit && <Button flash loading={busy} onClick={onSave}><Save className="h-4 w-4" /> حفظ</Button>}</div>)
}

function useSettingForm<T extends object>(key: string, fallback: T) {
  const qc = useQueryClient()
  const { data } = useSetting<T>(key, fallback)
  const [v, setV] = useState<T>(fallback)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (data) setV({ ...fallback, ...data }) }, [data]) // eslint-disable-line
  const save = async () => {
    setBusy(true)
    try { await saveSetting(key, v); toast.success('تم الحفظ'); qc.invalidateQueries({ queryKey: ['setting', key] }) } catch (e) { toast.error(errMsg(e)) }
    setBusy(false)
  }
  return { v, setV, save, busy }
}

function InvoiceTab({ canEdit }: { canEdit: boolean }) {
  const { v, setV, save, busy } = useSettingForm<{ paper: string }>('invoice.print', { paper: '80mm' })
  return (
    <SettingCard title="الفواتير والطباعة" canEdit={canEdit} busy={busy} onSave={save}>
      <Field label="حجم ورق الفاتورة" hint="الحراري 80mm للكاشير، أو A4 للفواتير الرسمية">
        <Select disabled={!canEdit} value={v.paper} onChange={(e) => setV({ ...v, paper: e.target.value })}><option value="80mm">حراري 80 مم</option><option value="A4">A4</option></Select>
      </Field>
      <p className="text-xs text-brand-300">نص أسفل الفاتورة والشعار من تبويب «بيانات الشركة». الطباعة من شاشة الفاتورة عبر طابعة النظام أو «حفظ كـ PDF».</p>
    </SettingCard>
  )
}

function CommissionTab({ canEdit }: { canEdit: boolean }) {
  const { v, setV, save, busy } = useSettingForm<{ basis: string; type: string }>('commission.mode', { basis: 'net_sales', type: 'flat' })
  return (
    <SettingCard title="طريقة احتساب العمولة" canEdit={canEdit} busy={busy} onSave={save}>
      <Field label="أساس الاحتساب">
        <Select disabled={!canEdit} value={v.basis} onChange={(e) => setV({ ...v, basis: e.target.value })}>
          <option value="net_sales">صافي المبيعات (بعد الخصم والمرتجعات، بدون الضريبة)</option><option value="total">إجمالي الفواتير شاملاً الضريبة (بعد المرتجعات)</option></Select>
      </Field>
      <p className="text-xs text-brand-300">نسبة العمولة تُحدَّد لكل موظف من صفحة الموظفين، وتُحتسب شهرياً من صفحة العمولات أو عند حساب الرواتب.</p>
    </SettingCard>
  )
}

function InventoryTab({ canEdit }: { canEdit: boolean }) {
  const { v, setV, save, busy } = useSettingForm<{ value: boolean }>('sales.allow_credit', { value: true })
  const lot = useSettingForm<{ value: string }>('inventory.lot_order', { value: 'fifo' })
  return (
    <div className="space-y-5">
    <SettingCard title="دفعات التسعيرة" canEdit={canEdit} busy={lot.busy} onSave={lot.save}>
      <Field label="ترتيب صرف المخزون بين الدفعات" hint="عند اختلاف سعر الشراء لنفس المنتج: أي دفعة تُباع وتُحوَّل أولاً؟">
        <Select disabled={!canEdit} value={lot.v.value} onChange={(e) => lot.setV({ value: e.target.value })}>
          <option value="fifo">الأقدم أولاً (FIFO) — الموصى به</option><option value="lifo">الأحدث أولاً (LIFO)</option></Select>
      </Field>
      <p className="text-xs text-brand-300">يسري على المبيعات والتحويلات والتالف الجديدة فقط، ولا يغيّر ما صُرف سابقاً.</p>
    </SettingCard>
    <SettingCard title="المخزون والبيع" canEdit={canEdit} busy={busy} onSave={save}>
      <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 accent-brand-700" disabled={!canEdit} checked={!!v.value} onChange={(e) => setV({ value: e.target.checked })} /> السماح بالبيع الآجل للعملاء من شاشة نقطة البيع</label>
      <div className="rounded-xl bg-cream-100 p-3 text-xs text-brand-500">• الرصيد السالب للمخزون ممنوع دائماً (مفروض من قاعدة البيانات).<br />• الحد الأدنى للمخزون يُحدَّد لكل منتج من صفحة المنتجات، وتصل تنبيهات الانخفاض تلقائياً.</div>
    </SettingCard>
    </div>
  )
}

function BackupTab() {
  return (
    <div className="card space-y-4 p-6 text-sm leading-7">
      <h3 className="font-bold text-brand-800">النسخ الاحتياطي</h3>
      <p>النسخ الاحتياطي يتم على مستوى Supabase، وليس من داخل التطبيق:</p>
      <ul className="list-disc space-y-1 pe-5 text-brand-600">
        <li>الخطط المدفوعة تتضمن نسخاً احتياطية يومية تلقائية، ويمكن استعادتها من لوحة Supabase ← Database ← Backups.</li>
        <li>للحصول على نسخة يدوية: <code className="rounded bg-cream-200 px-1.5" dir="ltr">supabase db dump -f backup.sql</code> أو <code className="rounded bg-cream-200 px-1.5" dir="ltr">pg_dump</code>.</li>
        <li>للتقارير: تصدير Excel من صفحة التقارير.</li>
        <li>ملفات الصور والمرفقات محفوظة في Storage وتُنسخ منفصلة عن قاعدة البيانات.</li>
      </ul>
    </div>
  )
}
