import { Loader2 } from 'lucide-react'

export function Spinner({ label = 'جارٍ التحميل...' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 p-10 text-stone-400">
      <Loader2 className="h-5 w-5 animate-spin" /> <span className="text-sm">{label}</span>
    </div>
  )
}
