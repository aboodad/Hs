import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import clsx from 'clsx'

export function Field({ label, error, hint, children, className }: {
  label?: string; error?: string; hint?: string; children: ReactNode; className?: string
}) {
  return (
    <label className={clsx('block', className)}>
      {label && <span className="mb-1 block text-xs font-semibold text-stone-600">{label}</span>}
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-stone-400">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...p }, ref) => <input ref={ref} className={clsx('input', className)} {...p} />,
)
Input.displayName = 'Input'

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...p }, ref) => (
    <select ref={ref} className={clsx('input', className)} {...p}>{children}</select>
  ),
)
Select.displayName = 'Select'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...p }, ref) => <textarea ref={ref} rows={3} className={clsx('input', className)} {...p} />,
)
Textarea.displayName = 'Textarea'
