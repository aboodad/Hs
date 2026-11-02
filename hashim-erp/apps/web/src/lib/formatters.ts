const currency = import.meta.env.VITE_CURRENCY_LABEL ?? 'ريال'

const nf = new Intl.NumberFormat('ar-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const nInt = new Intl.NumberFormat('ar-u-nu-latn', { maximumFractionDigits: 3 })

export const fmtMoney = (n: number | string | null | undefined, withCurrency = true) => {
  const v = Number(n ?? 0)
  return withCurrency ? `${nf.format(v)} ${currency}` : nf.format(v)
}
export const fmtNum = (n: number | string | null | undefined) => nInt.format(Number(n ?? 0))

export const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Intl.DateTimeFormat('ar-u-nu-latn', { dateStyle: 'medium' }).format(new Date(d)) : '—'

export const fmtDateTime = (d: string | Date | null | undefined) =>
  d ? new Intl.DateTimeFormat('ar-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(d)) : '—'

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export const toISODate = (d: Date) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return z.toISOString().slice(0, 10)
}

/** مجموع حقل رقمي عبر صفوف */
export const sumBy = (rows: any[] | undefined, k: string) => (rows ?? []).reduce((s, r) => s + Number(r[k] ?? 0), 0)
