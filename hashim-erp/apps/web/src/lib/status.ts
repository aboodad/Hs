export type Tone = 'gray' | 'blue' | 'green' | 'amber' | 'red' | 'purple'

export const REQUEST_STATUS: Record<string, [string, Tone]> = {
  new: ['جديد', 'blue'], under_review: ['قيد المراجعة', 'amber'], approved: ['معتمد', 'green'],
  partially_approved: ['معتمد جزئياً', 'amber'], rejected: ['مرفوض', 'red'], issued: ['تم الصرف', 'purple'],
  in_transit: ['قيد النقل', 'purple'], received: ['تم الاستلام', 'green'],
}
export const TRANSFER_STATUS: Record<string, [string, Tone]> = {
  created: ['تم الإنشاء', 'blue'], issued: ['تم الصرف', 'purple'], in_transit: ['قيد النقل', 'amber'],
  received: ['تم الاستلام', 'green'], has_difference: ['يوجد اختلاف', 'red'],
}
export const SALE_STATUS: Record<string, [string, Tone]> = {
  completed: ['مكتملة', 'green'], partially_returned: ['مرتجع جزئي', 'amber'],
  returned: ['مرتجعة', 'red'], cancelled: ['ملغاة', 'gray'],
}
export const DOC_STATUS: Record<string, [string, Tone]> = {
  draft: ['مسودة', 'gray'], posted: ['مرحّلة', 'green'], cancelled: ['ملغاة', 'red'],
}
export const PAY_STATUS: Record<string, [string, Tone]> = {
  unpaid: ['غير مدفوعة', 'red'], partial: ['مدفوعة جزئياً', 'amber'], paid: ['مدفوعة', 'green'],
}
export const APPROVAL_STATUS: Record<string, [string, Tone]> = {
  pending: ['بانتظار الاعتماد', 'amber'], approved: ['معتمد', 'green'], rejected: ['مرفوض', 'red'],
}
