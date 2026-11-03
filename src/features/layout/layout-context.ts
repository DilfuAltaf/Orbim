import { createContext, useContext } from 'react'
import type { LayoutContextValue } from './layout-constants'

export * from './layout-constants'

export const LayoutContext = createContext<LayoutContextValue | null>(null)

export function useLayout(): LayoutContextValue {
  const context = useContext(LayoutContext)
  if (!context) {
    throw new Error('useLayout must be used within a LayoutProvider')
  }
  return context
}
