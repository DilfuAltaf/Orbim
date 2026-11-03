import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import { spotifyApiDevPlugin } from './src/server/spotify-api-plugin.ts'

export default defineConfig({
  plugins: [react(), tailwindcss(), spotifyApiDevPlugin()],
  // Spotify requires a loopback IP literal for local HTTP redirects.
  // Pin the dev server to 127.0.0.1:5173 (matching the registered redirect URI)
  // and forbid silent port switching so OAuth callbacks never break.
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/assets/**', '**/*.json'],
    },
  },
  // `CLIENT_ID_SPOTIFY` is the public Spotify Client ID used by the existing PKCE flow.
  // Exposing it is intentional and safe: PKCE never needs the client secret, and
  // `CLIENT_SECRET_SPOTIFY` does not match either prefix.
  envPrefix: ['VITE_', 'CLIENT_ID_SPOTIFY'],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
