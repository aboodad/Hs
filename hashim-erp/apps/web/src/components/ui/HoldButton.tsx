import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { Check } from 'lucide-react'

/**
 * زر "اضغط مطولاً للتأكيد": يمنع الحذف/الإلغاء بنقرة عفوية.
 * يمتلئ شريط تقدّم أثناء الضغط، وعند الاكتمال ينفّذ onConfirm. الإفلات قبل الاكتمال يلغي العملية.
 * يدعم الماوس واللمس ولوحة المفاتيح (Space / Enter).
 */
export function HoldButton({ onConfirm, children, holdMs = 1100, tone = 'danger', icon, disabled, className, hint = 'اضغط مطولاً' }: {
  onConfirm: () => void | Promise<unknown>
  children: ReactNode
  holdMs?: number
  tone?: 'danger' | 'brand' | 'success'
  icon?: ReactNode
  disabled?: boolean
  className?: string
  hint?: string
}) {
  const [progress, setProgress] = useState(0)
  const [done, setDone] = useState(false)
  const raf = useRef<number | null>(null)
  const start = useRef(0)
  const holding = useRef(false)

  const stop = useCallback(() => {
    holding.current = false
    if (raf.current) cancelAnimationFrame(raf.current)
    raf.current = null
  }, [])

  const tick = useCallback(() => {
    if (!holding.current) return
    const p = Math.min((performance.now() - start.current) / holdMs, 1)
    setProgress(p)
    if (p >= 1) {
      stop(); setDone(true)
      Promise.resolve(onConfirm()).finally(() => setTimeout(() => { setDone(false); setProgress(0) }, 900))
      return
    }
    raf.current = requestAnimationFrame(tick)
  }, [holdMs, onConfirm, stop])

  const begin = () => {
    if (disabled || done || holding.current) return
    holding.current = true; start.current = performance.now(); raf.current = requestAnimationFrame(tick)
  }
  const cancel = () => {
    if (!holding.current) return
    stop()
    // رجوع سلس للصفر
    const from = progress, t0 = performance.now()
    const back = (now: number) => {
      const k = Math.min((now - t0) / 220, 1)
      setProgress(from * (1 - k))
      if (k < 1 && !holding.current) requestAnimationFrame(back)
    }
    requestAnimationFrame(back)
  }

  useEffect(() => stop, [stop])

  const colors = {
    danger: { base: 'bg-red-50 text-red-700 border-red-200', fill: 'bg-red-600', done: 'bg-red-600 text-white border-red-600' },
    brand: { base: 'bg-cream-100 text-brand-700 border-cream-400', fill: 'bg-brand-700', done: 'bg-brand-700 text-white border-brand-700' },
    success: { base: 'bg-emerald-50 text-emerald-700 border-emerald-200', fill: 'bg-emerald-600', done: 'bg-emerald-600 text-white border-emerald-600' },
  }[tone]

  return (
    <button type="button" disabled={disabled}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); begin() }}
      onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel}
      onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); begin() } }}
      onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') cancel() }}
      onContextMenu={(e) => e.preventDefault()}
      className={clsx('relative inline-flex select-none touch-none items-center justify-center gap-2 overflow-hidden rounded-xl border px-5 py-2.5 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        done ? colors.done : colors.base, className)}>
      <span aria-hidden className={clsx('pointer-events-none absolute inset-y-0 start-0', colors.fill)} style={{ width: `${progress * 100}%`, opacity: done ? 0 : 0.9 }} />
      <span className={clsx('relative z-10 inline-flex items-center gap-2 transition-colors', progress > 0.45 || done ? 'text-white' : '')}>
        {done ? <Check className="pop-in h-4 w-4" /> : icon}
        {done ? 'تم' : children}
        {!done && progress === 0 && <span className="rounded-md bg-black/5 px-1.5 py-0.5 text-[10px] font-semibold opacity-70">{hint}</span>}
      </span>
    </button>
  )
}
