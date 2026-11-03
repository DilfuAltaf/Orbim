import { ana, demoViewer, dima, june, mira, toCollaborator } from './people.ts'
import { tracksById } from './tracks.ts'
import type { MusicTrack, PersonSummary, Playlist, PlaylistTrackEntry } from '../../types/music.ts'

/**
 * Demo playlists. Ownership and collaboration are mock relationships that exercise
 * the UI; nothing is stored, fetched, or shared. Real persistence starts in Phase 5.
 */

function track(id: string): MusicTrack {
  const found = tracksById.get(id)

  if (!found) {
    throw new Error(`Unknown demo track: ${id}`)
  }

  return found
}

function entry(id: string, addedBy: PersonSummary, addedAt: string): PlaylistTrackEntry {
  return { track: track(id), addedBy, addedAt }
}

export const mockPlaylists: Playlist[] = [
  {
    id: 'long-distance-same-sky',
    title: 'Long Distance, Same Sky',
    description:
      'Tracks that made the 8,000 km feel shorter. Built together across three time zones.',
    owner: demoViewer,
    visibility: 'shared',
    collaborators: [
      toCollaborator(demoViewer, 'owner', '2026-03-02T09:12:00Z'),
      toCollaborator(mira, 'editor', '2026-03-05T18:40:00Z'),
      toCollaborator(dima, 'editor', '2026-04-11T20:05:00Z'),
    ],
    trackEntries: [
      entry('orb-0004', demoViewer, '2026-03-02T09:20:00Z'),
      entry('orb-0003', mira, '2026-03-05T18:44:00Z'),
      entry('orb-0024', dima, '2026-04-12T21:02:00Z'),
      entry('orb-0017', mira, '2026-05-19T07:31:00Z'),
      entry('orb-0007', demoViewer, '2026-06-08T15:12:00Z'),
      entry('orb-0013', dima, '2026-08-23T22:18:00Z'),
      entry('orb-0022', mira, '2026-10-14T19:26:00Z'),
    ],
    createdAt: '2026-03-02T09:12:00Z',
    updatedAt: '2026-10-14T19:26:00Z',
  },
  {
    id: 'night-shift',
    title: 'Night Shift',
    description: 'For deadlines that bleed into sunrise. No vocals after 02:00.',
    owner: demoViewer,
    visibility: 'private',
    collaborators: [toCollaborator(demoViewer, 'owner', '2026-05-27T23:10:00Z')],
    trackEntries: [
      entry('orb-0004', demoViewer, '2026-05-27T23:14:00Z'),
      entry('orb-0015', demoViewer, '2026-05-27T23:26:00Z'),
      entry('orb-0010', demoViewer, '2026-06-15T01:05:00Z'),
      entry('orb-0023', demoViewer, '2026-07-30T00:41:00Z'),
      entry('orb-0002', demoViewer, '2026-09-02T02:12:00Z'),
      entry('orb-0020', demoViewer, '2026-10-19T22:03:00Z'),
    ],
    createdAt: '2026-05-27T23:10:00Z',
    updatedAt: '2026-10-19T22:03:00Z',
  },
  {
    id: 'slow-mornings',
    title: 'Slow Mornings',
    description: 'Coffee, open windows, nothing urgent.',
    owner: demoViewer,
    visibility: 'shared',
    collaborators: [
      toCollaborator(demoViewer, 'owner', '2026-02-14T06:30:00Z'),
      toCollaborator(ana, 'editor', '2026-02-20T07:05:00Z'),
    ],
    trackEntries: [
      entry('orb-0007', demoViewer, '2026-02-14T06:34:00Z'),
      entry('orb-0013', demoViewer, '2026-02-14T06:41:00Z'),
      entry('orb-0019', ana, '2026-02-20T07:09:00Z'),
      entry('orb-0016', ana, '2026-03-28T06:52:00Z'),
      entry('orb-0008', demoViewer, '2026-06-11T08:15:00Z'),
    ],
    createdAt: '2026-02-14T06:30:00Z',
    updatedAt: '2026-06-11T08:15:00Z',
  },
  {
    id: 'signal-bloom',
    title: 'Signal Bloom',
    description: 'Guitars that dissolve. Kept private until it feels finished.',
    owner: demoViewer,
    visibility: 'private',
    collaborators: [toCollaborator(demoViewer, 'owner', '2026-09-04T13:00:00Z')],
    trackEntries: [
      entry('orb-0009', demoViewer, '2026-09-04T13:04:00Z'),
      entry('orb-0018', demoViewer, '2026-09-04T13:12:00Z'),
      entry('orb-0006', demoViewer, '2026-09-18T10:22:00Z'),
      entry('orb-0014', demoViewer, '2026-10-06T21:48:00Z'),
      entry('orb-0001', demoViewer, '2026-10-21T09:37:00Z'),
    ],
    createdAt: '2026-09-04T13:00:00Z',
    updatedAt: '2026-10-21T09:37:00Z',
  },
  {
    id: 'mira-kitchen-radio',
    title: 'Mira’s Kitchen Radio',
    description: 'Played loud while cooking. Contributions welcome, mess tolerated.',
    owner: mira,
    visibility: 'shared',
    collaborators: [
      toCollaborator(mira, 'owner', '2026-01-09T17:20:00Z'),
      toCollaborator(demoViewer, 'editor', '2026-01-12T19:02:00Z'),
    ],
    trackEntries: [
      entry('orb-0005', mira, '2026-01-09T17:24:00Z'),
      entry('orb-0012', mira, '2026-01-09T17:31:00Z'),
      entry('orb-0011', demoViewer, '2026-01-12T19:09:00Z'),
      entry('orb-0022', demoViewer, '2026-05-04T18:40:00Z'),
      entry('orb-0021', mira, '2026-09-25T16:11:00Z'),
    ],
    createdAt: '2026-01-09T17:20:00Z',
    updatedAt: '2026-09-25T16:11:00Z',
  },
  {
    id: 'petersburg-tape-shelf',
    title: 'Petersburg Tape Shelf',
    description: 'Slow, cold, and long. Recorded to cassette in a kitchen in 2019.',
    owner: dima,
    visibility: 'shared',
    collaborators: [
      toCollaborator(dima, 'owner', '2025-12-03T21:00:00Z'),
      toCollaborator(demoViewer, 'editor', '2026-01-02T20:15:00Z'),
    ],
    trackEntries: [
      entry('orb-0018', dima, '2025-12-03T21:06:00Z'),
      entry('orb-0009', dima, '2025-12-03T21:20:00Z'),
      entry('orb-0014', demoViewer, '2026-01-02T20:22:00Z'),
      entry('orb-0025', dima, '2026-02-17T19:45:00Z'),
      entry('orb-0003', demoViewer, '2026-08-30T18:05:00Z'),
    ],
    createdAt: '2025-12-03T21:00:00Z',
    updatedAt: '2026-08-30T18:05:00Z',
  },
  {
    id: 'late-set',
    title: 'Late Set',
    description: 'For the last hour of the bar, when the room gets quiet.',
    owner: ana,
    visibility: 'shared',
    collaborators: [
      toCollaborator(ana, 'owner', '2026-07-08T22:30:00Z'),
      toCollaborator(demoViewer, 'editor', '2026-07-15T21:12:00Z'),
      toCollaborator(june, 'editor', '2026-08-01T23:48:00Z'),
    ],
    trackEntries: [
      entry('orb-0008', ana, '2026-07-08T22:36:00Z'),
      entry('orb-0019', ana, '2026-07-08T22:44:00Z'),
      entry('orb-0023', demoViewer, '2026-07-15T21:19:00Z'),
      entry('orb-0002', june, '2026-08-01T23:55:00Z'),
    ],
    createdAt: '2026-07-08T22:30:00Z',
    updatedAt: '2026-08-01T23:55:00Z',
  },
]
