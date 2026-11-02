import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { errMsg } from '@/lib/errors'
import { toast } from '@/store/toast.store'
import { fmtMoney } from '@/lib/formatters'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'

export function CloseShiftDialog({ shiftId, onClose }: { shiftId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [actual, setActual] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any | null>(null)

  const close = async () => {
    if (actual === '') return toast.error('أدخل النقد الفعلي في الدرج')
    setLoading(true)
    const { data, error } = await supabase.rpc('fn_close_shift', { p_shift: shiftId, p_actual_cash: Number(actual) })
    setLoading(false)
    if (error) return toast.error(errMsg(error))
    setResult(data)
    qc.invalidateQueries({ queryKey: ['open-shift'] })
  }

  return (
    <Modal open onClose={result ? () => { onClose() } : onClose} title="إغلاق الوردية" size="sm"
      footer={result ? <Button onClick={onClose}>تم</Button> : <><Button variant="secondary" onClick={onClose}>إلغاء</Button><Button variant="danger" loading={loading} onClick={close}>إغلاق الوردية</Button></>}>
      {!result ? (
        <Field label="النقد الفعلي في الدرج" hint="عُدّ النقد الموجود فعلياً ثم أدخل المبلغ">
          <Input type="number" min={0} step="any" autoFocus value={actual} onChange={(e) => setActual(e.target.value)} />
        </Field>
      ) : (
        <div className="space-y-2 text-sm">
          {[['إجمالي المبيعات', result.total_sales], ['المبيعات النقدية', result.cash_sales], ['طرق الدفع الأخرى', result.other_sales],
            ['المرتجعات', result.returns_total], ['النقد المتوقع', result.expected_cash], ['النقد الفعلي', result.actual_cash]].map(([l, v]) => (
            <div key={l as string} className="flex justify-between"><span className="text-stone-500">{l}</span><b>{fmtMoney(v as number)}</b></div>
          ))}
          <div className={`flex justify-between rounded-lg p-3 font-bold ${Number(result.difference) === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
            <span>الفرق</span><span>{fmtMoney(result.difference)}</span>
          </div>
        </div>
      )}
    </Modal>
  )
}
