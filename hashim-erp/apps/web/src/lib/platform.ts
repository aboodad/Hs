import { Capacitor } from '@capacitor/core'

export const isNative = () => Capacitor.isNativePlatform()

/** مسح باركود بالكاميرا (تطبيق الجوال فقط). على الويب يُستخدم قارئ USB كلوحة مفاتيح. */
export async function scanBarcode(): Promise<string | null> {
  if (!isNative()) return null
  const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning')
  const perm = await BarcodeScanner.requestPermissions()
  if (perm.camera !== 'granted' && perm.camera !== 'limited') return null
  const { barcodes } = await BarcodeScanner.scan()
  return barcodes[0]?.rawValue ?? null
}

/** مشاركة نص (الويب: navigator.share إن توفر، الجوال: Capacitor Share) */
export async function shareText(title: string, text: string) {
  if (isNative()) {
    const { Share } = await import('@capacitor/share')
    await Share.share({ title, text, dialogTitle: title })
  } else if (navigator.share) {
    await navigator.share({ title, text })
  } else {
    await navigator.clipboard.writeText(text)
    alert('تم نسخ الفاتورة إلى الحافظة')
  }
}
