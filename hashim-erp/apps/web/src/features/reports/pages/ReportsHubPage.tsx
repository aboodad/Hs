import { Link } from 'react-router-dom'
import { BarChart3, ChevronLeft } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { REPORTS, REPORT_GROUPS } from '../definitions'

export default function ReportsHubPage() {
  return (
    <>
      <PageHeader title="التقارير" subtitle={`${REPORTS.length} تقريراً — حدّد الفترة والفرع، ثم اطبع أو صدّر PDF / Excel`} />
      <div className="space-y-6">
        {REPORT_GROUPS.map((g) => (
          <section key={g}>
            <h2 className="mb-2 text-sm font-bold text-gold-700">{g}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {REPORTS.filter((r) => r.group === g).map((r) => (
                <Link key={r.code} to={`/reports/${r.code}`} className="card group flex items-center gap-3 p-4 transition hover:border-gold-400 hover:shadow-gold">
                  <div className="rounded-xl bg-gradient-to-br from-gold-100 to-gold-200 p-2.5 text-gold-800"><BarChart3 className="h-5 w-5" /></div>
                  <div className="min-w-0 flex-1"><div className="font-semibold text-brand-800">{r.title}</div><div className="truncate text-xs text-brand-300">{r.desc}</div></div>
                  <ChevronLeft className="h-4 w-4 text-brand-300 group-hover:text-gold-600" />
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  )
}
