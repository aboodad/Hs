// تحويل أخطاء قاعدة البيانات (التي تُرمى من دوال fn_*) إلى رسائل عربية
const MAP: Record<string, string> = {
  INSUFFICIENT_STOCK: 'الكمية المتاحة غير كافية',
  NO_OPEN_SHIFT: 'لا توجد وردية مفتوحة، افتح وردية أولاً',
  SHIFT_ALREADY_OPEN: 'لديك وردية مفتوحة بالفعل',
  SHIFT_NOT_OPEN: 'الوردية مغلقة',
  FORBIDDEN_BRANCH: 'لا تملك صلاحية على هذا الفرع',
  FORBIDDEN: 'ليست لديك صلاحية لتنفيذ هذه العملية',
  EMPTY_CART: 'السلة فارغة',
  EMPTY_INVOICE: 'الفاتورة بلا بنود',
  EMPTY_TRANSFER: 'التحويل بلا بنود',
  EMPTY_RETURN: 'لم تحدد أي بند للإرجاع',
  CUSTOMER_REQUIRED_FOR_CREDIT: 'يجب اختيار عميل عند البيع بالآجل',
  OVERPAID: 'المبلغ المدفوع أكبر من إجمالي الفاتورة',
  INVALID_QTY: 'كمية غير صحيحة',
  INVALID_DISCOUNT: 'قيمة الخصم غير صحيحة',
  INVALID_STATUS: 'لا يمكن تنفيذ العملية في الحالة الحالية',
  RETURN_EXCEEDS_SOLD: 'كمية المرتجع أكبر من الكمية المباعة',
  PAYMENT_EXCEEDS_REMAINING: 'الدفعة أكبر من المتبقي',
  SAME_BRANCH: 'لا يمكن التحويل إلى نفس الموقع',
  INVALID_RECEIVED_QTY: 'الكمية المستلمة غير صحيحة',
  INVALID_PAID_AMOUNT: 'المبلغ المدفوع غير صحيح',
  COUNT_INCOMPLETE: 'أكمل إدخال الكميات الفعلية لكل المنتجات',
  LAYER_NOT_FOUND: 'الدفعة غير موجودة',
  INVALID_PRICE: 'السعر غير صحيح',
  PRODUCT_NOT_FOUND: 'منتج غير موجود أو موقوف',
  EMPTY_REQUEST: 'الطلب بلا بنود',
  KIOSK_ROLE_NEEDS_KIOSK_BRANCH: 'مستخدم دور «كشك» يجب أن يُربط بكشك (أنشئ الكشك من صفحة الفروع أولاً)',
  KIOSK_PARENT_INVALID: 'الكشك يجب أن يتبع فرعاً عادياً (ليس مخزناً رئيسياً ولا كشكاً آخر)',
  JE_UNBALANCED: 'القيد غير متوازن (مجموع المدين ≠ مجموع الدائن)',
  JE_NEEDS_TWO_LINES: 'القيد يحتاج سطرين على الأقل',
  PERIOD_LOCKED: 'الفترة المحاسبية مقفلة حتى',
  ACCOUNT_MAPPING_MISSING: 'حساب الترحيل غير معرّف في إعدادات الدليل المحاسبي',
  ACCOUNT_IS_GROUP: 'لا يمكن الترحيل إلى حساب رئيسي',
  ACCOUNT_INACTIVE: 'الحساب موقوف',
  ACCOUNT_SYSTEM: 'حساب أساسي في النظام',
  ACCOUNT_HAS_ENTRIES: 'الحساب عليه قيود',
  ACCOUNT_HAS_CHILDREN: 'الحساب له حسابات فرعية',
  ACCOUNT_IN_USE: 'الحساب مربوط بإعدادات الترحيل',
  ACCOUNT_PARENT_INVALID: 'الحساب الأب غير صالح (يجب أن يكون حساباً رئيسياً)',
  ACCOUNT_TYPE_MISMATCH: 'نوع الحساب يخالف نوع أبيه',
  ENTRY_IS_AUTOMATIC: 'قيد مولَّد من مستند؛ صحّحه من المستند نفسه',
  ENTRY_NOT_REVERSIBLE: 'لا يمكن عكس هذا القيد',
  PAYROLL_EXPENSE_LOCKED: 'مصروف مرتبط بكشف راتب ولا يمكن إلغاؤه من هنا',
  IMMUTABLE_LEDGER: 'القيود المحاسبية لا تُعدَّل ولا تُحذف (استخدم القيد العكسي)',
  chk_kiosk_parent: 'اختر الفرع التابع له الكشك',
}

export function errMsg(e: unknown): string {
  const raw: string = (e as any)?.message ?? String(e)
  for (const k of Object.keys(MAP)) {
    if (raw.includes(k)) {
      const extra = raw.split(k)[1]?.replace(/^[:\s]+/, '').trim()
      const showExtra = extra && !/[0-9a-f]{8}-[0-9a-f]{4}/.test(extra)
      return showExtra ? `${MAP[k]}: ${extra}` : MAP[k]
    }
  }
  if (raw.includes('row-level security')) return 'ليست لديك صلاحية لتنفيذ هذه العملية'
  if (raw.includes('duplicate key')) return 'القيمة مكررة (موجودة مسبقاً)'
  if (raw.includes('violates foreign key')) return 'لا يمكن الحذف أو التعديل لارتباط السجل ببيانات أخرى'
  if (raw.includes('Invalid login credentials')) return 'بيانات الدخول غير صحيحة'
  return raw
}
