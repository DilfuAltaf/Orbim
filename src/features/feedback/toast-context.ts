import { createContext, useContext } from 'react'

export type ToastTone = 'info' | 'success'

export type ToastInput = {
  title: string
  description?: string
  tone?: ToastTone
}

export type ToastMessage = ToastInput & { id: number }

export type ToastContextValue = {
  notify: (toast: ToastInput) => void
  dismiss: () => void
}

export const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)

  if (!context) {
    throw new Error('useToast must be used inside <ToastProvider>')
  }

  return context
}
