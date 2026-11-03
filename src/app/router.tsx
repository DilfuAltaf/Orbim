import { createBrowserRouter, Navigate } from 'react-router-dom'

import { AppShell } from '@/components/layout/AppShell'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { AuthGuard } from '@/features/auth/AuthGuard'
import { ExplorePage } from '@/pages/ExplorePage'
import { HomePage } from '@/pages/HomePage'
import { InvitePage } from '@/pages/InvitePage'
import { LoginPage } from '@/pages/LoginPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { PlaylistPage } from '@/pages/PlaylistPage'
import { RegisterPage } from '@/pages/RegisterPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { SpotifyCallbackPage } from '@/pages/SpotifyCallbackPage'

/**
 * Route map (PRD §6). Authenticated screens sit behind `AuthGuard`.
 * Library and Playlist routes redirect seamlessly to Explore.
 */
export const router = createBrowserRouter([
  {
    element: <AuthLayout />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
    ],
  },
  {
    element: <AppShell />,
    children: [
      // Public discovery & playback routes (accessible to guests and authenticated users)
      { index: true, element: <HomePage /> },
      { path: 'explore', element: <ExplorePage /> },
      { path: 'playlist/:playlistId', element: <PlaylistPage /> },
      { path: 'invite/:token', element: <InvitePage /> },
      { path: 'callback/spotify', element: <SpotifyCallbackPage /> },

      // Private routes (protected by AuthGuard; requires authentication in Supabase mode)
      {
        element: <AuthGuard />,
        children: [
          { path: 'library', element: <Navigate to="/explore" replace /> },
          { path: 'shared', element: <Navigate to="/explore" replace /> },
          { path: 'import', element: <Navigate to="/explore" replace /> },
          { path: 'settings', element: <SettingsPage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
