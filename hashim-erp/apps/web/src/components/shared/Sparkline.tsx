import { useId } from 'react'

/** رسم مصغّر للاتجاه داخل البطاقات */
export function Sparkline({ values, color = '#c9a24b', height = 36, fill = true }: { values: number[]; color?: string; height?: number; fill?: boolean }) {
  const id = useId()
  if (!values || values.length < 2) return null
  const w = 120, max = Math.max(...values), min = Math.min(...values), span = max - min || 1
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, height - 4 - ((v - min) / span) * (height - 8)])
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height, direction: 'ltr' }}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".35" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      {fill && <path d={`${line} L${w},${height} L0,${height} Z`} fill={`url(#${id})`} />}
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
