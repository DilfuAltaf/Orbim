/**
 * Single source of truth for brand copy and asset paths.
 * The original logo files in the repository root are never modified; these point at
 * the copies under `public/brand/`.
 */
export const site = {
  name: 'ORBIM',
  tagline: 'Different Worlds. One Soundtrack.',
  description:
    'Discover music and build shared playlists together, no matter where you are.',
  logoMark: '/brand/logo-mark.png',
  logoWordmark: '/brand/wordmark.png',
} as const
