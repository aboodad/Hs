import { AlertTriangle, HelpCircle } from 'lucide-react'
import clsx from 'clsx'
import { useConfirm } from '@/store/confirm.store'
import { Button } from './Button'
import { HoldButton } from './HoldButton'

/** نافذة التأكيد العامة (تُركَّب مرة واحدة في Providers) */
export function ConfirmHost() {
  const { req, close } = useConfirm()
  if (!req) return null
  const danger = req.tone === 'danger'
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-brand-950/50 p-4 backdrop-blur-sm" onMouseDown={() => close(false)}>
      <div className="card fade-up w-full max-w-sm p-6 text-center" onMouseDown={(e) => e.stopPropagation()}>
        <div className={clsx('mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl', danger ? 'tile-red' : 'tile-gold')}>
          {danger ? <AlertTriangle className="h-7 w-7" /> : <HelpCircle className="h-7 w-7" />}
        </div>
        <h3 className="text-lg font-bold text-brand-800">{req.title}</h3>
        {req.description && <p className="mt-1.5 text-sm leading-6 text-brand-400">{req.description}</p>}
        <div className="mt-6 flex flex-col gap-2.5">
          {req.hold
            ? <HoldButton tone={danger ? 'danger' : 'brand'} className="w-full !py-3" onConfirm={() => close(true)}>{req.confirmLabel ?? 'تأكيد'}</HoldButton>
            : <Button variant={danger ? 'danger' : 'primary'} size="lg" className="w-full" onClick={() => close(true)}>{req.confirmLabel ?? 'تأكيد'}</Button>}
          <Button variant="ghost" className="w-full" onClick={() => close(false)}>{req.cancelLabel ?? 'إلغاء'}</Button>
        </div>
      </div>
    </div>
  )
}
