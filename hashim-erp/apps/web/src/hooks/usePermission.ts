import { useCallback } from 'react'
import { useAuth } from '@/store/auth.store'

export function usePermission() {
  const profile = useAuth((s) => s.profile)
  const permissions = useAuth((s) => s.permissions)
  const can = useCallback(
    (module: string, action: string = 'view') => {
      if (!profile) return false
      if (profile.role.code === 'super_admin') return true
      return permissions.has(`${module}:${action}`)
    },
    [profile, permissions],
  )
  return { can, profile, seesAllBranches: !!profile?.role.all_branches || profile?.role.code === 'super_admin' }
}
