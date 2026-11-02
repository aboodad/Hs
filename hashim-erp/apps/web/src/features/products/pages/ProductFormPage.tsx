import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { errMsg } from '@/lib/errors'
import { toast } from '@/store/toast.store'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Spinner'
import { DropZone } from '@/components/ui/DropZone'

const num = (label: string) => z.number({ invalid_type_error: `${label}: أدخل رقماً` }).min(0, `${label}: لا يقل عن صفر`)

const schema = z.object({
  name: z.string().min(2, 'اسم المنتج مطلوب'),
  sku: z.string().min(1, 'رمز المنتج مطلوب'),
  barcode: z.string().optional(),
  category_id: z.string().min(1, 'اختر التصنيف'),
  unit_id: z.string().min(1, 'اختر الوحدة'),
  size_label: z.string().optional(),
  cost_price: num('سعر الشراء'),
  wholesale_price: num('سعر الجملة'),
  retail_price: num('سعر البيع'),
  min_stock: num('الحد الأدنى'),
  tax_rate_id: z.string().optional(),
  is_active: z.boolean(),
})
type Form = z.infer<typeof schema>

export default function ProductFormPage() {
  const { id } = useParams()
  const editing = !!id
  const nav = useNavigate()
  const qc = useQueryClient()
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { is_active: true, cost_price: 0, wholesale_price: 0, retail_price: 0, min_stock: 0 },
  })

  const lookups = useQuery({
    queryKey: ['product-form-lookups'],
    queryFn: async () => {
      const [c, u, t] = await Promise.all([
        supabase.from('categories').select('id,name').eq('is_active', true).order('sort_order'),
        supabase.from('units').select('id,name').eq('is_active', true).order('name'),
        supabase.from('tax_rates').select('id,name,rate').eq('is_active', true).order('name'),
      ])
      return { cats: c.data ?? [], units: u.data ?? [], taxes: t.data ?? [] }
    },
  })

  const { data: product, isLoading } = useQuery({
    queryKey: ['product', id], enabled: editing,
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('*').eq('id', id!).single()
      if (error) throw error
      return data
    },
  })

  useEffect(() => {
    if (product) {
      reset({ ...product, barcode: product.barcode ?? '', size_label: product.size_label ?? '', tax_rate_id: product.tax_rate_id ?? '',
        cost_price: Number(product.cost_price), wholesale_price: Number(product.wholesale_price),
        retail_price: Number(product.retail_price), min_stock: Number(product.min_stock) })
      setImageUrl(product.image_url)
    }
  }, [product, reset])

  const uploadImage = async (file: File) => {
    setUploading(true)
    const ext = file.name.split('.').pop() || 'jpg'
    const path = `${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from('product-images').upload(path, file, { cacheControl: '3600' })
    setUploading(false)
    if (error) return toast.error(errMsg(error))
    setImageUrl(supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl)
  }

  const onSubmit = async (v: Form) => {
    const payload = {
      ...v, barcode: v.barcode || null, size_label: v.size_label || null, tax_rate_id: v.tax_rate_id || null, image_url: imageUrl,
    }
    const { error } = editing
      ? await supabase.from('products').update(payload).eq('id', id!)
      : await supabase.from('products').insert(payload)
    if (error) return toast.error(errMsg(error))
    toast.success('تم حفظ المنتج')
    qc.invalidateQueries({ queryKey: ['products'] })
    nav('/products')
  }

  if (editing && isLoading) return <Spinner />
  const L = lookups.data

  return (
    <>
      <PageHeader title={editing ? 'تعديل منتج' : 'إضافة منتج'} />
      <form onSubmit={handleSubmit(onSubmit)} className="card grid gap-5 p-5 lg:grid-cols-[260px_1fr]">
        <div>
          <div className="mb-2 text-xs font-semibold text-brand-600">صورة المنتج</div>
          <DropZone accept="image/*" label={uploading ? 'جارٍ الرفع...' : 'اسحب صورة المنتج هنا'} hint="PNG أو JPG حتى 10 MB" previewUrl={imageUrl}
            onChange={(f) => f && uploadImage(f)} disabled={uploading} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="اسم المنتج *" error={errors.name?.message} className="sm:col-span-2"><Input {...register('name')} /></Field>
          <Field label="رمز المنتج *" error={errors.sku?.message}><Input dir="ltr" {...register('sku')} /></Field>
          <Field label="الباركود" error={errors.barcode?.message}><Input dir="ltr" {...register('barcode')} /></Field>
          <Field label="التصنيف *" error={errors.category_id?.message}>
            <Select {...register('category_id')}><option value="">— اختر —</option>{L?.cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          </Field>
          <Field label="الوحدة *" error={errors.unit_id?.message}>
            <Select {...register('unit_id')}><option value="">— اختر —</option>{L?.units.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          </Field>
          <Field label="الحجم / النوع"><Input placeholder="مثال: 100 مل" {...register('size_label')} /></Field>
          <Field label="الضريبة">
            <Select {...register('tax_rate_id')}><option value="">بدون</option>{L?.taxes.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.rate}%)</option>)}</Select>
          </Field>
          <Field label="سعر الشراء" error={errors.cost_price?.message}><Input type="number" step="any" {...register('cost_price', { valueAsNumber: true })} /></Field>
          <Field label="سعر الجملة" error={errors.wholesale_price?.message}><Input type="number" step="any" {...register('wholesale_price', { valueAsNumber: true })} /></Field>
          <Field label="سعر البيع" error={errors.retail_price?.message}><Input type="number" step="any" {...register('retail_price', { valueAsNumber: true })} /></Field>
          <Field label="الحد الأدنى للمخزون" error={errors.min_stock?.message}><Input type="number" step="any" {...register('min_stock', { valueAsNumber: true })} /></Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="h-5 w-5 accent-brand-700" {...register('is_active')} /> المنتج نشط</label>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button variant="secondary" onClick={() => nav('/products')}>إلغاء</Button>
            <Button type="submit" loading={isSubmitting}>حفظ</Button>
          </div>
        </div>
      </form>
    </>
  )
}
