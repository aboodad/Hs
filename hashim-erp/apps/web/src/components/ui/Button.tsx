import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type MouseEvent } from 'react'
import clsx from 'clsx'
import { ArrowLeft, Check, Loader2 } from 'lucide-react'

type Variant = 'primary' | 'gold' | 'secondary' | 'danger' | 'ghost' | 'success'

const styles: Record<Variant, string> = {
  primary: 'bg-gradient-to-b from-brand-600 to-brand-800 text-cream-50 shadow-sm hover:from-brand-700 hover:to-brand-900',
  gold: 'bg-gradient-to-b from-gold-400 to-gold-600 text-brand-950 shadow-gold hover:from-gold-300 hover:to-gold-500',
  secondary: 'border border-cream-400 bg-white text-brand-700 hover:bg-cream-100',
  danger: 'bg-red-700 text-white hover:bg-red-800',
  success: 'bg-emerald-700 text-white hover:bg-emerald-800',
  ghost: 'text-brand-600 hover:bg-cream-200',
}

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  variant?: Variant
  /** تحميل يدوي؛ وإن أعاد onClick وعداً (async) يُفعَّل التحميل تلقائياً ويمنع الضغط المزدوج */
  loading?: boolean
  size?: 'sm' | 'md' | 'lg'
  /** أيقونة سهم تنزلق عند التمرير (زر "متابعة") */
  arrow?: boolean
  /** علامة ✓ قصيرة بعد نجاح العملية غير المتزامنة */
  flash?: boolean
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void | Promise<unknown>
}

export const Button = forwardRef<HTMLButtonElement, Props>(
  ({ variant = 'primary', loading, size = 'md', arrow, flash, className, children, disabled, type = 'button', onClick, ...rest }, ref) => {
    const [pending, setPending] = useState(false)
    const [ok, setOk] = useState(false)
    const alive = useRef(true)
    useEffect(() => () => { alive.current = false }, [])

    const click = (e: MouseEvent<HTMLButtonElement>) => {
      const r = onClick?.(e) as Promise<unknown> | void
      if (r && typeof (r as any).then === 'function') {
        setPending(true)
        ;(r as Promise<unknown>)
          .then(() => { if (flash && alive.current) { setOk(true); setTimeout(() => alive.current && setOk(false), 1100) } })
          .catch(() => {})
          .finally(() => alive.current && setPending(false))
      }
    }
    const busy = loading || pending

    return (
      <button ref={ref} type={type} disabled={disabled || busy} onClick={click}
        className={clsx('btn group', styles[variant], size === 'sm' && '!px-3 !py-1.5 !text-xs', size === 'lg' && '!px-6 !py-3 !text-base', className)} {...rest}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {ok && !busy && <Check className="pop-in h-4 w-4" />}
        {children}
        {arrow && !busy && <ArrowLeft className="h-4 w-4 transition-transform duration-200 group-hover:-translate-x-1" />}
      </button>
    )
  },
)
Button.displayName = 'Button'
