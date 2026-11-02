import { useEffect, useRef, useState } from 'react'
import JsBarcode from 'jsbarcode'
import { Printer } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { fmtMoney } from '@/lib/formatters'

export function BarcodePrintDialog({ product, onClose }: { product: any | null; onClose: () => void }) {
  const [copies, setCopies] = useState(1)
  const refs = useRef<(SVGSVGElement | null)[]>([])

  useEffect(() => {
    if (!product?.barcode) return
    refs.current.forEach((el) => {
      if (el) {
        try { JsBarcode(el, product.barcode, { format: 'CODE128', height: 40, fontSize: 12, margin: 2, displayValue: true }) } catch { /* باركود غير صالح */ }
      }
    })
  }, [product, copies])

  if (!product) return null
  const n = Math.max(1, Math.min(copies || 1, 60))
  return (
    <Modal open onClose={onClose} title={`طباعة باركود: ${product.name}`}
      footer={<><Button variant="secondary" onClick={onClose}>إغلاق</Button><Button onClick={() => window.print()}><Printer className="h-4 w-4" /> طباعة</Button></>}>
      <Field label="عدد النسخ" className="mb-4 max-w-[160px]">
        <Input type="number" min={1} max={60} value={copies} onChange={(e) => setCopies(Number(e.target.value))} />
      </Field>
      <div id="print-area" className="grid grid-cols-2 gap-2">
        {Array.from({ length: n }).map((_, i) => (
          <div key={i} className="rounded border border-dashed border-stone-300 p-1 text-center text-[10px]">
            <div className="truncate font-semibold">{product.name}</div>
            <svg ref={(el) => { refs.current[i] = el }} className="mx-auto" />
            <div>{fmtMoney(product.retail_price)}</div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
