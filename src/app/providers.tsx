import type { ReactNode } from 'react'

import { AuthProvider } from '@/features/auth/AuthProvider'
import { ToastProvider } from '@/features/feedback/ToastProvider'
import { LayoutProvider } from '@/features/layout/LayoutProvider'
import { PlayerProvider } from '@/features/player/PlayerProvider'

/**
 * Global provider boundary.
 *
 * Mounts auth, layout, player, and toast feedback providers.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>
        <LayoutProvider>
          <PlayerProvider>{children}</PlayerProvider>
        </LayoutProvider>
      </AuthProvider>
    </ToastProvider>
  )
}
