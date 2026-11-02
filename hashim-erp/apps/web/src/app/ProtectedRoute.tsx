import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/store/auth.store'
import { usePermission } from '@/hooks/usePermission'
import { Spinner } from '@/components/ui/Spinner'
import { ShieldAlert } from 'lucide-react'

/** حماية المسارات: تسجيل الدخول أولاً، ثم صلاحية القسم (module/action) */
export function ProtectedRoute({ module, action = 'view' }: { module?: string; action?: string }) {
  const { session, loading, profile } = useAuth()
  const { can } = usePermission()
  const loc = useLocation()

  if (loading) return <div className="flex min-h-screen items-center justify-center"><Spinner /></div>
  if (!session || !profile) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  if (module && !can(module, action)) {
    return (
      <div className="card mx-auto mt-16 max-w-md p-10 text-center">
        <ShieldAlert className="mx-auto mb-3 h-12 w-12 text-red-400" />
        <div className="font-bold">ليست لديك صلاحية للوصول إلى هذه الصفحة</div>
      </div>
    )
  }
  return <Outlet />
}
