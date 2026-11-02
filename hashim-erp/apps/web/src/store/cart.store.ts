import { create } from 'zustand'
import { round2 } from '@/lib/formatters'

export interface CartItem {
  product_id: string
  name: string
  barcode: string | null
  unit_price: number
  qty: number
  discount: number // خصم السطر (قيمة)
  tax_rate: number
  max_qty: number // المتاح في الفرع
}

interface CartState {
  items: CartItem[]
  headerDiscount: number
  customer: { id: string; name: string } | null
  add: (item: Omit<CartItem, 'qty' | 'discount'>) => string | null
  setQty: (id: string, qty: number) => void
  setDiscount: (id: string, d: number) => void
  setPrice: (id: string, p: number) => void
  remove: (id: string) => void
  setHeaderDiscount: (d: number) => void
  setCustomer: (c: CartState['customer']) => void
  clear: () => void
}

export const useCart = create<CartState>((set, get) => ({
  items: [],
  headerDiscount: 0,
  customer: null,
  add: (item) => {
    const ex = get().items.find((i) => i.product_id === item.product_id)
    const nextQty = (ex?.qty ?? 0) + 1
    if (nextQty > item.max_qty) return 'الكمية المتاحة غير كافية'
    set({
      items: ex
        ? get().items.map((i) => (i.product_id === item.product_id ? { ...i, qty: nextQty } : i))
        : [...get().items, { ...item, qty: 1, discount: 0 }],
    })
    return null
  },
  setQty: (id, qty) =>
    set({ items: get().items.map((i) => (i.product_id === id ? { ...i, qty: Math.max(0, Math.min(qty, i.max_qty)) } : i)) }),
  setDiscount: (id, d) =>
    set({ items: get().items.map((i) => (i.product_id === id ? { ...i, discount: Math.max(0, d) } : i)) }),
  setPrice: (id, p) =>
    set({ items: get().items.map((i) => (i.product_id === id ? { ...i, unit_price: Math.max(0, p) } : i)) }),
  remove: (id) => set({ items: get().items.filter((i) => i.product_id !== id) }),
  setHeaderDiscount: (d) => set({ headerDiscount: Math.max(0, d) }),
  setCustomer: (customer) => set({ customer }),
  clear: () => set({ items: [], headerDiscount: 0, customer: null }),
}))

/** نفس معادلات دالة fn_create_sale في قاعدة البيانات (الضريبة تُضاف فوق السعر) */
export function computeTotals(items: CartItem[], headerDiscount: number) {
  let subtotal = 0, lineDiscount = 0, tax = 0
  for (const i of items) {
    const gross = i.qty * i.unit_price
    const net = gross - i.discount
    subtotal += gross
    lineDiscount += i.discount
    tax += round2((net * i.tax_rate) / 100)
  }
  const discount = lineDiscount + headerDiscount
  return { subtotal: round2(subtotal), discount: round2(discount), tax: round2(tax), total: round2(subtotal - discount + tax) }
}
