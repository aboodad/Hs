import { useEffect, useState } from 'react'
import { CheckCircle2, Printer, Share2 } from 'lucide-react'
import clsx from 'clsx'
import { fmtDateTime, fmtMoney, fmtNum } from '@/lib/formatters'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useCompany, useSetting } from '@/hooks/useLookups'
import { shareText } from '@/lib/platform'

export interface ReceiptData {
  invoice_no: string; invoice_date: string; branch?: string; cashier?: string; customer?: string
  items: { name: string; qty: number; unit_price: number; line_total: number }[]
  subtotal: number; discount: number; tax_amount: number; total: number
  paid_amount: number; change_amount: number; remaining: number
  payments?: { method: string; amount: number }[]
}

/**
 * معاينة الإيصال. مع animate=true تظهر طابعة تُخرج الإيصال تدريجياً
 * ثم تتحول الحالة إلى «اكتملت العملية» (يُستخدم بعد إتمام البيع في نقطة البيع).
 */
export function ReceiptModal({ data, onClose, animate = false }: { data: ReceiptData | null; onClose: () => void; animate?: boolean }) {
  const { data: company } = useCompany()
  const { data: printCfg } = useSetting<{ paper?: string }>('invoice.print', { paper: '80mm' })
  const a4 = printCfg?.paper === 'A4'
  const [done, setDone] = useState(!animate)

  useEffect(() => {
    setDone(!animate)
    if (!animate || !data) return
    const t = setTimeout(() => setDone(true), 2500)
    return () => clearTimeout(t)
  }, [animate, data?.invoice_no]) // eslint-disable-line

  if (!data) return null

  const asText = () =>
    [`${company?.name ?? ''}`, `فاتورة ${data.invoice_no}`, fmtDateTime(data.invoice_date),
      ...data.items.map((i) => `${i.name} × ${fmtNum(i.qty)} = ${fmtMoney(i.line_total)}`),
      `الإجمالي: ${fmtMoney(data.total)}`].join('\n')

  return (
    <Modal open onClose={onClose} title={animate ? 'إتمام البيع' : `فاتورة ${data.invoice_no}`} size="sm"
      footer={<>
        <Button variant="secondary" disabled={!done} onClick={() => shareText(`فاتورة ${data.invoice_no}`, asText())}><Share2 className="h-4 w-4" /> مشاركة</Button>
        <Button disabled={!done} onClick={() => window.print()}><Printer className="h-4 w-4" /> طباعة</Button>
      </>}>

      {animate && (
        <div className="relative z-10 mx-auto -mb-1 w-full max-w-[330px] rounded-t-2xl bg-gradient-to-b from-brand-800 to-brand-950 px-4 pb-3 pt-3 text-cream-100 shadow-lg">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 font-semibold">
              {done ? <CheckCircle2 className="pop-in h-4 w-4 text-emerald-400" /> : <Printer className="printer-shake h-4 w-4 text-gold-300" />}
              {done ? 'اكتملت العملية' : 'جارٍ طباعة الإيصال...'}
            </span>
            <span className="rounded-md bg-white/10 px-2 py-0.5 font-bold tabular-nums text-gold-200" dir="ltr">{fmtMoney(data.total)}</span>
          </div>
          <div className="mt-2.5 h-1.5 rounded-full bg-black/50 shadow-inner" />{/* فتحة خروج الورق */}
        </div>
      )}

      <div className={clsx('mx-auto overflow-hidden', animate && 'max-w-[330px]')}>
        <div id="print-area" style={{ width: a4 ? '190mm' : undefined }}
          className={clsx('mx-auto w-full bg-white leading-5', animate && 'paper-out border-x border-b border-cream-300 px-3 pb-3 shadow-md', animate && done && '!animate-none',
            a4 ? 'max-w-[560px] text-[13px]' : 'max-w-[300px] text-[12px]')}>
          <div className="text-center">
            {company?.logo_url && <img src={company.logo_url} alt="" className="mx-auto mb-1 h-12" />}
            <div className="text-base font-bold">{company?.name ?? 'هاشم للطيب والعطور'}</div>
            {company?.phone && <div>{company.phone}</div>}
            {company?.tax_number && <div>الرقم الضريبي: {company.tax_number}</div>}
          </div>
          <hr className="my-2 border-dashed" />
          <div>رقم الفاتورة: <b>{data.invoice_no}</b></div>
          <div>التاريخ: {fmtDateTime(data.invoice_date)}</div>
          {data.branch && <div>الفرع: {data.branch}</div>}
          {data.cashier && <div>البائع: {data.cashier}</div>}
          {data.customer && <div>العميل: {data.customer}</div>}
          <hr className="my-2 border-dashed" />
          <table className="w-full">
            <thead><tr className="border-b border-dashed"><th className="text-start">الصنف</th><th>كمية</th><th className="text-end">المبلغ</th></tr></thead>
            <tbody>
              {data.items.map((i, k) => (
                <tr key={k}>
                  <td className="py-0.5">{i.name}<div className="text-[10px] text-stone-500">{fmtMoney(i.unit_price, false)}</div></td>
                  <td className="text-center">{fmtNum(i.qty)}</td>
                  <td className="text-end">{fmtMoney(i.line_total, false)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <hr className="my-2 border-dashed" />
          <Row l="المجموع" v={fmtMoney(data.subtotal)} />
          {data.discount > 0 && <Row l="الخصم" v={`- ${fmtMoney(data.discount)}`} />}
          {data.tax_amount > 0 && <Row l="الضريبة" v={fmtMoney(data.tax_amount)} />}
          <div className="flex justify-between border-t border-dashed pt-1 text-sm font-bold"><span>الصافي</span><span>{fmtMoney(data.total)}</span></div>
          {data.payments?.map((p, k) => <Row key={k} l={p.method} v={fmtMoney(p.amount)} />)}
          {data.change_amount > 0 && <Row l="الباقي للعميل" v={fmtMoney(data.change_amount)} />}
          {data.remaining > 0 && <Row l="المتبقي (آجل)" v={fmtMoney(data.remaining)} />}
          {company?.invoice_footer && <div className="mt-3 text-center">{company.invoice_footer}</div>}
          {/* حافة إيصال مسنّنة */}
          <div className="mt-3 h-2 w-full" style={{ background: 'linear-gradient(-45deg, transparent 4px, #fff 0) 0 0/8px 8px, linear-gradient(45deg, transparent 4px, #f1e6d6 0) 0 0/8px 8px' }} />
        </div>
      </div>
    </Modal>
  )
}

const Row = ({ l, v }: { l: string; v: string }) => <div className="flex justify-between"><span>{l}</span><span>{v}</span></div>
