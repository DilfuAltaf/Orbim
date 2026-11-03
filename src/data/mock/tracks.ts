import type { MusicTrack } from '../../types/music.ts'

/**
 * Demo catalog used by every screen in Phase 2.
 *
 * These are fictional artists and releases — nothing here represents a real
 * recording. DatabaseMusicProvider replaces this module as the
 * primary data source; the `MusicTrack` shape is already provider-neutral so components
 * do not need to change.
 */

type TrackInput = {
  title: string
  artist: string
  album: string
  genre: string
  moods: string[]
  durationSeconds: number
  releaseDate: string
  /** Demonstrates the unavailable-track state without inventing a provider error. */
  unavailable?: boolean
}

function makeTrack(providerTrackId: string, input: TrackInput): MusicTrack {
  return {
    provider: 'demo',
    providerTrackId,
    title: input.title,
    artistName: input.artist,
    albumName: input.album,
    durationSeconds: input.durationSeconds,
    releaseDate: input.releaseDate,
    genre: input.genre,
    moods: input.moods,
    isPlayable: input.unavailable !== true,
  }
}

export const mockTracks: MusicTrack[] = [
  makeTrack('orb-0001', {
    title: 'Paper Satellites',
    artist: 'Lumen Arcade',
    album: 'Paper Satellites',
    genre: 'Dream Pop',
    moods: ['Hazy', 'Late night'],
    durationSeconds: 214,
    releaseDate: '2026-04-12',
  }),
  makeTrack('orb-0002', {
    title: 'Velvet Static',
    artist: 'Nao Kestrel',
    album: 'Soft Focus',
    genre: 'Neo-Soul',
    moods: ['Warm', 'Slow'],
    durationSeconds: 198,
    releaseDate: '2026-02-27',
  }),
  makeTrack('orb-0003', {
    title: 'Harbour Lights',
    artist: 'Sora & the Tide',
    album: 'Blue Hour Tapes',
    genre: 'Ambient Pop',
    moods: ['Calm', 'Coastal'],
    durationSeconds: 243,
    releaseDate: '2026-06-05',
  }),
  makeTrack('orb-0004', {
    title: 'Midnight Commute',
    artist: 'Kiro Vale',
    album: 'Night Transit',
    genre: 'Lo-Fi',
    moods: ['Focused', 'Late night'],
    durationSeconds: 176,
    releaseDate: '2026-01-18',
  }),
  makeTrack('orb-0005', {
    title: 'Salt & Circuitry',
    artist: 'The Meridian Club',
    album: 'Analog Coast',
    genre: 'Indie Rock',
    moods: ['Driving', 'Bright'],
    durationSeconds: 231,
    releaseDate: '2025-11-09',
  }),
  makeTrack('orb-0006', {
    title: 'Slow Orbit',
    artist: 'Ayla Rune',
    album: 'Gravity Well',
    genre: 'Electronic',
    moods: ['Focused', 'Nocturnal'],
    durationSeconds: 267,
    releaseDate: '2026-07-21',
  }),
  makeTrack('orb-0007', {
    title: 'Ferry to Nowhere',
    artist: 'Miro Halden',
    album: 'Quiet Ports',
    genre: 'Folk',
    moods: ['Calm', 'Reflective'],
    durationSeconds: 205,
    releaseDate: '2025-09-30',
  }),
  makeTrack('orb-0008', {
    title: 'Amber Room',
    artist: 'Nadia Vex',
    album: 'Amber Room',
    genre: 'Jazz',
    moods: ['Warm', 'Evening'],
    durationSeconds: 289,
    releaseDate: '2026-03-14',
  }),
  makeTrack('orb-0009', {
    title: 'Static Bloom',
    artist: 'Ilya Marrow',
    album: 'Greenhouse',
    genre: 'Shoegaze',
    moods: ['Hazy', 'Loud'],
    durationSeconds: 254,
    releaseDate: '2026-05-02',
  }),
  makeTrack('orb-0010', {
    title: 'Tokyo Rain Loop',
    artist: 'Sora & the Tide',
    album: 'Blue Hour Tapes',
    genre: 'Lo-Fi',
    moods: ['Rainy', 'Focused'],
    durationSeconds: 168,
    releaseDate: '2026-06-05',
  }),
  makeTrack('orb-0011', {
    title: 'Neon Orchard',
    artist: 'Kestrel & Kiro',
    album: 'Split Signal',
    genre: 'Synthwave',
    moods: ['Driving', 'Nocturnal'],
    durationSeconds: 223,
    releaseDate: '2026-08-08',
  }),
  makeTrack('orb-0012', {
    title: 'Glass Elevator',
    artist: 'The Meridian Club',
    album: 'Analog Coast',
    genre: 'Indie Rock',
    moods: ['Bright', 'Restless'],
    durationSeconds: 240,
    releaseDate: '2025-11-09',
  }),
  makeTrack('orb-0013', {
    title: 'Low Tide Letters',
    artist: 'Miro Halden',
    album: 'Quiet Ports',
    genre: 'Folk',
    moods: ['Reflective', 'Calm'],
    durationSeconds: 197,
    releaseDate: '2025-09-30',
  }),
  makeTrack('orb-0014', {
    title: 'Afterglow Protocol',
    artist: 'Ayla Rune',
    album: 'Gravity Well',
    genre: 'Electronic',
    moods: ['Nocturnal', 'Driving'],
    durationSeconds: 312,
    releaseDate: '2026-07-21',
  }),
  makeTrack('orb-0015', {
    title: 'Sunday Typewriter',
    artist: 'Kiro Vale',
    album: 'Night Transit',
    genre: 'Lo-Fi',
    moods: ['Focused', 'Warm'],
    durationSeconds: 154,
    releaseDate: '2026-01-18',
  }),
  makeTrack('orb-0016', {
    title: 'Lavender Hours',
    artist: 'Nao Kestrel',
    album: 'Soft Focus',
    genre: 'Neo-Soul',
    moods: ['Warm', 'Slow'],
    durationSeconds: 226,
    releaseDate: '2026-02-27',
  }),
  makeTrack('orb-0017', {
    title: 'Signal Fires',
    artist: 'Lumen Arcade',
    album: 'Paper Satellites',
    genre: 'Dream Pop',
    moods: ['Hazy', 'Hopeful'],
    durationSeconds: 208,
    releaseDate: '2026-04-12',
  }),
  makeTrack('orb-0018', {
    title: 'Northern Drift',
    artist: 'Ilya Marrow',
    album: 'Greenhouse',
    genre: 'Ambient',
    moods: ['Calm', 'Wide'],
    durationSeconds: 341,
    releaseDate: '2026-05-02',
  }),
  makeTrack('orb-0019', {
    title: 'Corner Store Romance',
    artist: 'Ana Reyes',
    album: 'Small Hours',
    genre: 'Jazz',
    moods: ['Evening', 'Warm'],
    durationSeconds: 262,
    releaseDate: '2026-09-11',
  }),
  makeTrack('orb-0020', {
    title: 'Hollow Moon',
    artist: 'Vera Sol',
    album: 'Nightjar',
    genre: 'Indie Pop',
    moods: ['Hopeful', 'Bright'],
    durationSeconds: 189,
    releaseDate: '2026-08-29',
  }),
  makeTrack('orb-0021', {
    title: 'Copper Wires',
    artist: 'Vera Sol',
    album: 'Nightjar',
    genre: 'Indie Pop',
    moods: ['Restless', 'Bright'],
    durationSeconds: 202,
    releaseDate: '2026-08-29',
  }),
  makeTrack('orb-0022', {
    title: 'Slow Motion Freeway',
    artist: 'Kestrel & Kiro',
    album: 'Split Signal',
    genre: 'Synthwave',
    moods: ['Driving', 'Nocturnal'],
    durationSeconds: 236,
    releaseDate: '2026-08-08',
  }),
  makeTrack('orb-0023', {
    title: 'Quiet Machine',
    artist: 'Nadia Vex',
    album: 'Amber Room',
    genre: 'Ambient Jazz',
    moods: ['Focused', 'Calm'],
    durationSeconds: 275,
    releaseDate: '2026-03-14',
  }),
  makeTrack('orb-0024', {
    title: 'Until the Tide Turns',
    artist: 'Sora & the Tide',
    album: 'Blue Hour Tapes',
    genre: 'Ambient Pop',
    moods: ['Coastal', 'Reflective'],
    durationSeconds: 258,
    releaseDate: '2026-06-05',
    unavailable: true,
  }),
  makeTrack('orb-0025', {
    title: 'Ghost Frequency',
    artist: 'Ilya Marrow',
    album: 'Greenhouse',
    genre: 'Shoegaze',
    moods: ['Hazy', 'Nocturnal'],
    durationSeconds: 301,
    releaseDate: '2026-05-02',
    unavailable: true,
  }),
]

export const tracksById = new Map(
  mockTracks.map((track) => [track.providerTrackId, track] as const),
)

/** Sorted list of genres for the Explore filter chips. */
export const trackGenres = [...new Set(mockTracks.map((track) => track.genre))].sort()
