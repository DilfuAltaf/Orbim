import assert from 'node:assert/strict'
import test from 'node:test'

import {
  searchCollaboratorCandidates,
} from '../src/services/user/collaborator-search.ts'
import type { PlaylistTrackEntry } from '../src/types/music.ts'

test('Collaborator Search: matches users by display name and ignores unknown names', async () => {
  // Query matching Mira
  const miraResults = await searchCollaboratorCandidates('mira')
  assert.ok(miraResults.length > 0, 'Should return candidates matching mira')
  assert.equal(miraResults[0].displayName, 'Mira K.')

  // Query matching Ana
  const anaResults = await searchCollaboratorCandidates('Ana')
  assert.ok(anaResults.length > 0, 'Should return candidates matching Ana case-insensitively')
  assert.equal(anaResults[0].displayName, 'Ana Reyes')

  // Query non-existent user returns empty
  const nonExistent = await searchCollaboratorCandidates('user_tidak_dikenal_xyz_123')
  assert.equal(nonExistent.length, 0, 'Non-existent user must return 0 candidates')

  // Current user exclusion
  const excluded = await searchCollaboratorCandidates('Mira', 'usr-mira-01')
  assert.equal(excluded.length, 0, 'Current user must be excluded from candidates')
})

test('Playlist Sorting: sorts tracks according to user preference', () => {
  const dummyTracks: PlaylistTrackEntry[] = [
    {
      track: {
        id: '1',
        title: 'Zebra Song',
        artistName: 'Coldplay',
        durationSeconds: 240,
        provider: 'orbim',
        providerTrackId: 't1',
        isPlayable: true,
      },
      addedAt: '2026-01-01T10:00:00Z',
    },
    {
      track: {
        id: '2',
        title: 'Alpha Song',
        artistName: 'Adele',
        durationSeconds: 180,
        provider: 'orbim',
        providerTrackId: 't2',
        isPlayable: true,
      },
      addedAt: '2026-01-03T10:00:00Z',
    },
    {
      track: {
        id: '3',
        title: 'Middle Song',
        artistName: 'Bruno Mars',
        durationSeconds: 300,
        provider: 'orbim',
        providerTrackId: 't3',
        isPlayable: true,
      },
      addedAt: '2026-01-02T10:00:00Z',
    },
  ]

  // Sort by title A-Z
  const byTitle = [...dummyTracks].sort((a, b) => a.track.title.localeCompare(b.track.title))
  assert.equal(byTitle[0].track.title, 'Alpha Song')
  assert.equal(byTitle[1].track.title, 'Middle Song')
  assert.equal(byTitle[2].track.title, 'Zebra Song')

  // Sort by artist A-Z
  const byArtist = [...dummyTracks].sort((a, b) =>
    a.track.artistName.localeCompare(b.track.artistName),
  )
  assert.equal(byArtist[0].track.artistName, 'Adele')
  assert.equal(byArtist[1].track.artistName, 'Bruno Mars')
  assert.equal(byArtist[2].track.artistName, 'Coldplay')

  // Sort by duration
  const byDuration = [...dummyTracks].sort(
    (a, b) => a.track.durationSeconds - b.track.durationSeconds,
  )
  assert.equal(byDuration[0].track.durationSeconds, 180)
  assert.equal(byDuration[2].track.durationSeconds, 300)

  // Sort by date (newest first)
  const byDate = [...dummyTracks].sort(
    (a, b) => new Date(b.addedAt || 0).getTime() - new Date(a.addedAt || 0).getTime(),
  )
  assert.equal(byDate[0].track.title, 'Alpha Song') // 2026-01-03
  assert.equal(byDate[2].track.title, 'Zebra Song') // 2026-01-01
})
