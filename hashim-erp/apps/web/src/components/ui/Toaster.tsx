import clsx from 'clsx'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import { useToast } from '@/store/toast.store'

export function Toaster() {
  const { toasts, dismiss } = useToast()
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-3">
      {toasts.map((t) => (
        <div key={t.id} className={clsx('pointer-events-auto flex w-full max-w-md items-start gap-2 rounded-lg px-4 py-3 text-sm text-white shadow-lg',
          t.type === 'success' && 'bg-emerald-600', t.type === 'error' && 'bg-red-600', t.type === 'info' && 'bg-stone-700')}>
          {t.type === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : t.type === 'error' ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <Info className="mt-0.5 h-4 w-4 shrink-0" />}
          <span className="flex-1">{t.text}</span>
          <button onClick={() => dismiss(t.id)}><X className="h-4 w-4 opacity-70" /></button>
        </div>
      ))}
    </div>
  )
}
