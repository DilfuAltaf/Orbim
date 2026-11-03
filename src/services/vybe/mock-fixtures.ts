/**
 * Offline mock fixtures for VYBE Library API (v1).
 * Used for development, testing, and Phase 2 offline validation.
 * No real API requests or credentials required.
 */

import type { VybeApiTrackItem } from './types.ts'

export const MOCK_VYBE_TRACK_1: VybeApiTrackItem = {
  id: '6c1f2a4e-8d3b-4f7a-9b21-0e5d7c9a1f30',
  title: 'Midnight Horizon',
  artist: {
    id: 'art_vybe_001',
    name: 'Aetheria',
    slug: 'aetheria',
    url: 'https://vybemusic.com/artists/aetheria',
  },
  album: {
    title: 'Neon Odyssey',
    slug: 'neon-odyssey',
  },
  duration: 214.5,
  artwork: 'https://cdn.vybemusic.com/art/6c1f2a4e-8d3b-4f7a-9b21-0e5d7c9a1f30.webp',
  stream_url: 'https://stream.vybemusic.com/v1/s/mock_stream_token_001.mp3',
  slug: 'midnight-horizon',
  url: 'https://vybemusic.com/tracks/midnight-horizon',
  genre: 'Synthwave',
  vybe: 'chill',
  vybes: ['chill', 'focus', 'night'],
  bpm: 118,
  key: 'F# minor',
  camelot: '11A',
  energy: 0.72,
  credits: {
    producer: ['Aetheria'],
    writer: ['Aetheria', 'Kai Winters'],
  },
  lyrics: [
    { time: 14.0, text: 'Under the neon canopy glowing bright' },
    { time: 28.5, text: 'Chasing the shadows into the endless night' },
  ],
  attribution: 'Music from VYBE',
}

export const MOCK_VYBE_TRACK_2: VybeApiTrackItem = {
  id: '3e9b1a2c-4d5e-6f7a-8b9c-0d1e2f3a4b5c',
  title: 'Solar Flare',
  // Test with string artist shape
  artist: 'Solstice Collective',
  album: 'Equinox',
  duration: 182,
  artwork_url: 'https://cdn.vybemusic.com/art/3e9b1a2c-4d5e-6f7a-8b9c-0d1e2f3a4b5c.jpg',
  stream_url: 'https://stream.vybemusic.com/v1/s/mock_stream_token_002.mp3',
  slug: 'solar-flare',
  url: 'https://vybemusic.com/tracks/solar-flare',
  genre: 'Lo-Fi',
  vibe: 'euphoric',
  vybes: ['euphoric', 'sunny'],
  bpm: 85,
  key: 'C major',
  camelot: '8B',
  energy: 0.88,
  credits: {
    producer: ['Leo Solstice'],
  },
  attribution: 'Music from VYBE',
}

export const MOCK_VYBE_TRACK_3: VybeApiTrackItem = {
  id: '8f7a6b5c-4d3e-2f1a-0b9c-8e7d6c5b4a3f',
  title: 'Quantum Drift',
  artist: {
    name: 'Kroma Sound',
    slug: 'kroma-sound',
  },
  duration: 245,
  artwork: 'https://cdn.vybemusic.com/art/quantum-drift.webp',
  slug: 'quantum-drift',
  genre: 'Ambient Electronic',
  vybe: 'meditative',
  vybes: ['meditative', 'deep'],
  bpm: 90,
  key: 'D minor',
  energy: 0.45,
  attribution: 'Music from VYBE',
}

export const MOCK_VYBE_CATALOG: VybeApiTrackItem[] = [
  MOCK_VYBE_TRACK_1,
  MOCK_VYBE_TRACK_2,
  MOCK_VYBE_TRACK_3,
]
