import { useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent } from 'react'
import clsx from 'clsx'
import { File as FileIcon, FileText, ImageIcon, UploadCloud, X } from 'lucide-react'
import { toast } from '@/store/toast.store'

const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

/**
 * منطقة إفلات ملفات "مغناطيسية": الأيقونة تنجذب نحو المؤشر، وتتوهج عند سحب ملف فوقها.
 * للتجهيز: value/onChange (الملف يُرفع لاحقاً) — أو onChange فقط للرفع الفوري مع previewUrl.
 */
export function DropZone({ value, onChange, previewUrl, accept = 'image/*,application/pdf', maxMB = 10, label = 'اسحب الملف وأفلته هنا', hint, compact, disabled }: {
  value?: File | null
  onChange: (file: File | null) => void
  previewUrl?: string | null
  accept?: string
  maxMB?: number
  label?: string
  hint?: string
  compact?: boolean
  disabled?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [pull, setPull] = useState({ x: 0, y: 0 })

  const take = (f?: File | null) => {
    if (!f) return
    if (f.size > maxMB * 1048576) return toast.error(`الحد الأقصى للملف ${maxMB} MB`)
    const ok = accept.split(',').some((a) => { a = a.trim(); return a === '*' || (a.endsWith('/*') ? f.type.startsWith(a.slice(0, -1)) : a.startsWith('.') ? f.name.toLowerCase().endsWith(a) : f.type === a) })
    if (!ok) return toast.error('نوع الملف غير مدعوم')
    onChange(f)
  }
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setPull({ x: (e.clientX - (r.left + r.width / 2)) * 0.12, y: (e.clientY - (r.top + r.height / 2)) * 0.18 })
  }
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); setPull({ x: 0, y: 0 }); if (!disabled) take(e.dataTransfer.files?.[0]) }

  const isImg = value?.type.startsWith('image/')
  const Kind = !value ? UploadCloud : isImg ? ImageIcon : value.type === 'application/pdf' ? FileText : FileIcon
  const objUrl = useMemo(() => (value && isImg ? URL.createObjectURL(value) : null), [value, isImg])
  useEffect(() => () => { if (objUrl) URL.revokeObjectURL(objUrl) }, [objUrl])
  const thumb = objUrl ?? previewUrl

  return (
    <div
      onPointerMove={onMove} onPointerLeave={() => setPull({ x: 0, y: 0 })}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true) }} onDragLeave={() => { setOver(false); setPull({ x: 0, y: 0 }) }} onDrop={onDrop}
      onClick={() => !disabled && input.current?.click()}
      className={clsx('group relative flex cursor-pointer items-center gap-4 overflow-hidden rounded-2xl border-2 border-dashed transition-all duration-200',
        compact ? 'p-3' : 'p-5', disabled && 'cursor-not-allowed opacity-50',
        over ? 'scale-[1.015] border-gold-500 bg-gold-50 shadow-gold' : 'border-cream-400 bg-cream-50 hover:border-gold-400 hover:bg-white')}>
      <input ref={input} type="file" hidden accept={accept} onChange={(e) => { take(e.target.files?.[0]); e.currentTarget.value = '' }} />

      <div style={{ transform: `translate(${pull.x}px, ${pull.y}px) scale(${over ? 1.15 : 1})`, transition: 'transform .18s ease-out' }}
        className={clsx('flex shrink-0 items-center justify-center overflow-hidden rounded-2xl shadow-sm', compact ? 'h-12 w-12' : 'h-16 w-16',
          value || thumb ? 'bg-white ring-1 ring-cream-300' : 'tile-gold')}>
        {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : <Kind className={clsx(compact ? 'h-5 w-5' : 'h-7 w-7', over && 'animate-bounce')} />}
      </div>

      <div className="min-w-0 flex-1">
        {value ? (<>
          <div className="truncate text-sm font-bold text-brand-800">{value.name}</div>
          <div className="text-xs text-brand-300">{fmtSize(value.size)} · اضغط للاستبدال</div>
        </>) : (<>
          <div className="text-sm font-bold text-brand-700">{over ? 'أفلت الملف الآن' : label}</div>
          <div className="text-xs text-brand-300">{hint ?? `أو اضغط للاختيار · حتى ${maxMB} MB`}</div>
        </>)}
      </div>

      {value && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onChange(null) }} className="rounded-lg p-1.5 text-brand-300 hover:bg-red-50 hover:text-red-600"><X className="h-4 w-4" /></button>
      )}
    </div>
  )
}
