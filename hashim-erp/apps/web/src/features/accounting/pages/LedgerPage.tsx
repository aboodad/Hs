import { useState } from 'react'
import { Printer } from 'lucide-react'
import { usePermission } from '@/hooks/usePermission'
import { useAuth } from '@/store/auth.store'
import { fmtDate, fmtMoney, toISODate } from '@/lib/formatters'
import { PageHeader } from '@/components/shared/PageHeader'
import { DataTable, type Column } from '@/components/data/DataTable'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { AccountSelect } from '../components/AccountSelect'
import { PeriodBar } from '../components/PeriodBar'
import { useReportRpc } from '../hooks'

export default function LedgerPage() {
  const { seesAllBranches } = usePermission()
  const myBranch = useAuth((s) => s.profile?.branch_id) ?? ''
  const [account, setAccount] = useState('')
  const [branch, setBranch] = useState(seesAllBranches ? '' : myBranch)
  const [from, setFrom] = useState(toISODate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)))
  const [to, setTo] = useState(toISODate(new Date()))
  const { data, isLoading } = useReportRpc<any>([account, branch, from, to], 'fn_account_ledger',
    { p_account: account, p_from: from, p_to: to, p_branch: branch || null }, !!account)

  const rows = (data ?? []).map((r: any, i: number) => ({ ...r, id: i }))
  const cols: Column<any>[] = [
    { key: 'entry_date', header: 'التاريخ', render: (r) => fmtDate(r.entry_date) },
    { key: 'entry_no', header: 'رقم القيد', render: (r) => <span className="font-mono text-xs" dir="ltr">{r.entry_no ?? ''}</span> },
    { key: 'description', header: 'البيان', render: (r) => <>{r.description}{r.memo && <span className="text-xs text-brand-300"> — {r.memo}</span>}</> },
    { key: 'debit', header: 'مدين', render: (r) => (Number(r.debit) ? fmtMoney(r.debit, false) : '') },
    { key: 'credit', header: 'دائن', render: (r) => (Number(r.credit) ? fmtMoney(r.credit, false) : '') },
    { key: 'balance', header: 'الرصيد (مدين + / دائن −)', render: (r) => <b className={Number(r.balance) < 0 ? 'text-red-600' : ''} dir="ltr">{fmtMoney(r.balance, false)}</b> },
  ]
  return (
    <>
      <PageHeader title="دفتر الأستاذ" subtitle="كشف حساب بحركاته ورصيده الجاري"
        actions={<>
          <AccountSelect className="w-72" value={account} onChange={setAccount} />
          <PeriodBar from={from} to={to} branch={branch} onFrom={setFrom} onTo={setTo} onBranch={setBranch} showBranch={seesAllBranches} />
          <Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" /></Button>
        </>} />
      {!account ? <div className="card p-16 text-center text-brand-400">اختر حساباً لعرض كشفه</div> : isLoading ? <Spinner /> : <DataTable columns={cols} rows={rows} />}
    </>
  )
}
