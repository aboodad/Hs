import type { LucideIcon } from 'lucide-react'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import clsx from 'clsx'
import { Sparkline } from './Sparkline'
import { Skeleton } from '@/components/ui/Skeleton'

type Tone = 'brand' | 'gold' | 'green' | 'red' | 'blue'
const TILE: Record<Tone, string> = { brand: 'tile-gold', gold: 'tile-gold', green: 'tile-green', red: 'tile-red', blue: 'tile-brown' }
const LINE: Record<Tone, string> = { brand: '#c9a24b', gold: '#c9a24b', green: '#059669', red: '#dc2626', blue: '#7a5230' }

interface Props {
  label: string
  value: string
  icon?: LucideIcon
  tone?: Tone
  sub?: string
  /** نسبة التغير مقابل الفترة السابقة. invert=true: الارتفاع سيّئ (مثل المصروفات) */
  trend?: { pct: number | null; invert?: boolean; label?: string }
  spark?: number[]
  /** hero: بطاقة داكنة بارزة */
  variant?: 'default' | 'hero'
  loading?: boolean
  delay?: number
}

export function StatCard({ label, value, icon: Icon, tone = 'brand', sub, trend, spark, variant = 'default', loading, delay = 0 }: Props) {
  const hero = variant === 'hero'
  // فصل الرقم عن رمز العملة ليبقى الرقم كبيراً والعملة صغيرة
  const mm = /^(-?[\d.,٫٬\s]+?)\s+([^\d\s][^\d]*)$/.exec(value)
  const num = mm ? mm[1] : value
  const cur = mm ? mm[2] : ''
  const pct = trend?.pct
  const good = pct == null ? null : trend?.invert ? pct <= 0 : pct >= 0

  return (
    <div style={{ animationDelay: `${delay}ms` }}
      className={clsx('fade-up relative overflow-hidden p-4', hero
        ? 'rounded-2xl border border-gold-500/30 bg-gradient-to-br from-brand-800 via-brand-900 to-brand-950 text-cream-100 shadow-[0_12px_30px_-12px_rgba(46,32,20,.6)]'
        : 'card card-hover')}>
      {hero && <div className="pointer-events-none absolute -end-10 -top-10 h-36 w-36 rounded-full bg-gold-400/20 blur-2xl" />}
      {!hero && <div className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-gradient-to-l from-gold-300 via-gold-500 to-transparent opacity-70" />}

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className={clsx('truncate text-[12.5px] font-medium', hero ? 'text-gold-300' : 'text-brand-400')}>{label}</div>
          {loading ? <Skeleton className="mt-2 h-7 w-32" /> : (
            <div className={clsx('mt-1 flex items-baseline gap-1.5 whitespace-nowrap font-bold tabular-nums', hero ? 'text-[26px] text-cream-50' : 'text-[21px] text-brand-900')}>
              <span className="truncate">{num}</span>
              {cur && <span className={clsx('text-[12.5px] font-medium', hero ? 'text-gold-300/80' : 'text-brand-300')}>{cur}</span>}
            </div>
          )}
        </div>
        {Icon && <div className={clsx('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl shadow-sm', hero ? 'bg-gold-400/15 text-gold-300 ring-1 ring-gold-400/30' : TILE[tone])}><Icon className="h-5 w-5" /></div>}
      </div>

      {(pct !== undefined || sub) && !loading && (
        <div className="relative mt-2.5 flex flex-wrap items-center gap-2 text-xs">
          {pct !== undefined && (pct == null
            ? <span className={hero ? 'text-cream-400/70' : 'text-brand-300'}>—</span>
            : <span className={clsx('inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 font-bold', good ? (hero ? 'bg-emerald-400/15 text-emerald-300' : 'bg-emerald-100 text-emerald-700') : (hero ? 'bg-red-400/15 text-red-300' : 'bg-red-100 text-red-700'))}>
                {pct >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}{Math.abs(pct).toFixed(1)}%</span>)}
          {trend?.label && pct !== undefined && <span className={hero ? 'text-cream-400/70' : 'text-brand-300'}>{trend.label}</span>}
          {sub && <span className={hero ? 'text-cream-300/80' : 'text-brand-300'}>{sub}</span>}
        </div>
      )}

      {spark && spark.length > 1 && !loading && <div className="relative mt-3 -mb-1"><Sparkline values={spark} color={hero ? '#e8c960' : LINE[tone]} /></div>}
    </div>
  )
}
