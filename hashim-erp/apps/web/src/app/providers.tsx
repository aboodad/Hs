import { useEffect, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuth } from '@/store/auth.store'
import { Toaster } from '@/components/ui/Toaster'
import { ConfirmHost } from '@/components/ui/ConfirmHost'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 } },
})

export function Providers({ children }: { children: ReactNode }) {
  const init = useAuth((s) => s.init)
  useEffect(() => { void init() }, [init])
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster />
      <ConfirmHost />
    </QueryClientProvider>
  )
}
