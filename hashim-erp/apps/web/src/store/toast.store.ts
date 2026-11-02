import { create } from 'zustand'

export interface Toast { id: number; type: 'success' | 'error' | 'info'; text: string }
interface ToastState { toasts: Toast[]; push: (type: Toast['type'], text: string) => void; dismiss: (id: number) => void }

let n = 0
export const useToast = create<ToastState>((set, get) => ({
  toasts: [],
  push: (type, text) => {
    const id = ++n
    set({ toasts: [...get().toasts, { id, type, text }] })
    setTimeout(() => get().dismiss(id), 4500)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}))

export const toast = {
  success: (t: string) => useToast.getState().push('success', t),
  error: (t: string) => useToast.getState().push('error', t),
  info: (t: string) => useToast.getState().push('info', t),
}
