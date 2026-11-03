import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Clock } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errMsg } from '@/lib/errors'
import { toast } from '@/store/toast.store'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { useAuth } from '@/store/auth.store'

/** شاشة فتح الوردية: لا بيع قبل فتح وردية */
export function OpenShiftPanel() {
  const qc = useQueryClient()
  const profile = useAuth((s) => s.profile)
  const [cash, setCash] = useState('0')
  const [loading, setLoading] = useState(false)

  const open = async () => {
    setLoading(true)
    const { error } = await supabase.rpc('fn_open_shift', { p_opening_cash: Number(cash) || 0 })
    setLoading(false)
    if (error) return toast.error(errMsg(error))
    toast.success('تم فتح الوردية')
    qc.invalidateQueries({ queryKey: ['open-shift'] })
  }

  return (
    <div className="flex h-full items-center justify-center p-4">
      <div className="card w-full max-w-sm space-y-4 p-6 text-center">
        <Clock className="mx-auto h-12 w-12 text-brand-600" />
        <h2 className="text-lg font-bold">فتح وردية جديدة</h2>
        <p className="text-sm text-stone-500">الفرع: {profile?.branch.name} · الموظف: {profile?.full_name}</p>
        <Field label="الرصيد الافتتاحي (النقد في الدرج)"><Input type="number" min={0} step="any" value={cash} onChange={(e) => setCash(e.target.value)} /></Field>
        <Button size="lg" className="w-full" loading={loading} onClick={open}>فتح الوردية</Button>
      </div>
    </div>
  )
}
