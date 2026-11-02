import { create } from 'zustand'

export interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  /** danger: إجراء مدمّر (يُفضَّل مع hold) | brand: تأكيد عادي */
  tone?: 'danger' | 'brand'
  /** اضغط مطولاً للتأكيد */
  hold?: boolean
}
interface State {
  req: (ConfirmOptions & { resolve: (v: boolean) => void }) | null
  ask: (o: ConfirmOptions) => Promise<boolean>
  close: (v: boolean) => void
}

export const useConfirm = create<State>((set, get) => ({
  req: null,
  ask: (o) => new Promise<boolean>((resolve) => { get().req?.resolve(false); set({ req: { ...o, resolve } }) }),
  close: (v) => { get().req?.resolve(v); set({ req: null }) },
}))

/** بديل window.confirm: const ok = await askConfirm({ title: 'حذف؟', tone: 'danger', hold: true }) */
export const askConfirm = (o: ConfirmOptions) => useConfirm.getState().ask(o)
