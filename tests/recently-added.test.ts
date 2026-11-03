import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  isRecentlyAddedEligible,
  mergeRecentlyAddedTracks,
  selectRecentlyAddedTracks,
  sortByPublicationDesc,
} from '../src/services/catalog/recently-added.ts'
import type { MusicTrack } from '../src/types/music.ts'

/**
 * "Recently added" is a strict view of the global published catalog: only
 * published, playable, audio-backed tracks, newest publication first, without
 * duplicates, and it must absorb newly published uploads immediately.
 */

let sequence = 0

function makeTrack(overrides: Partial<MusicTrack> & { title: string }): MusicTrack {
  sequence += 1

  return {
    provider: 'orbim',
    providerTrackId: `recent-${sequence}`,
    artistName: 'ORBIM Artist',
    durationSeconds: 205,
    genre: 'Pop',
    moods: [],
    isPlayable: true,
    playbackUrl: `https://cdn.example.test/orbim/${sequence}.mp3`,
    storagePath: `catalog/audio/${sequence}.mp3`,
    publicationStatus: 'published',
    publishedAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  }
}

describe('Recently Added catalog section', () => {
  describe('Visibility rules', () => {
    it('accepts only published, playable tracks with a real audio source', () => {
      assert.equal(isRecentlyAddedEligible(makeTrack({ title: 'Uploaded and published' })), true)

      assert.equal(
        isRecentlyAddedEligible(
          makeTrack({
            title: 'Storage path only',
            playbackUrl: undefined,
          }),
        ),
        true,
      )
    })

    it('rejects metadata-only, draft, unpublished, unplayable and audio-less records', () => {
      const excluded: Array<[string, MusicTrack]> = [
        [
          'metadata-only search result',
          makeTrack({
            title: 'Metadata only',
            isPlayable: false,
            playbackUrl: undefined,
            storagePath: undefined,
          }),
        ],
        ['draft', makeTrack({ title: 'Draft', publicationStatus: 'draft' })],
        ['unpublished', makeTrack({ title: 'Unpublished', publicationStatus: 'unpublished' })],
        [
          'unplayable',
          makeTrack({
            title: 'Unplayable',
            isPlayable: false,
            playbackUrl: undefined,
            storagePath: 'catalog/audio/unplayable.mp3',
          }),
        ],
        [
          'missing audio path',
          makeTrack({ title: 'No audio', playbackUrl: undefined, storagePath: undefined }),
        ],
        [
          'failed upload (blank path)',
          makeTrack({ title: 'Failed upload', playbackUrl: undefined, storagePath: '   ' }),
        ],
      ]

      for (const [label, track] of excluded) {
        assert.equal(isRecentlyAddedEligible(track), false, label)
      }
    })

    it('filters an entire mixed catalog page down to playable published tracks', () => {
      const selected = selectRecentlyAddedTracks([
        makeTrack({ title: 'Published A', publishedAt: '2026-09-10T10:00:00.000Z' }),
        makeTrack({ title: 'Draft B', publicationStatus: 'draft' }),
        makeTrack({ title: 'Metadata C', isPlayable: false, playbackUrl: undefined, storagePath: undefined }),
        makeTrack({ title: 'Published D', publishedAt: '2026-09-12T10:00:00.000Z' }),
      ])

      assert.deepEqual(
        selected.map((track) => track.title),
        ['Published D', 'Published A'],
      )
    })
  })

  describe('Sorting', () => {
    it('orders by real publication time, newest first', () => {
      const older = makeTrack({ title: 'Older', publishedAt: '2026-08-01T08:00:00.000Z' })
      const newest = makeTrack({ title: 'Newest', publishedAt: '2026-10-30T22:15:00.000Z' })
      const middle = makeTrack({ title: 'Middle', publishedAt: '2026-09-15T12:00:00.000Z' })

      assert.deepEqual(
        sortByPublicationDesc([older, newest, middle]).map((track) => track.title),
        ['Newest', 'Middle', 'Older'],
      )
    })

    it('does not use the metadata discovery time as the publication time', () => {
      const neverPublished = makeTrack({
        title: 'No publication timestamp',
        publishedAt: null,
        releaseDate: '2020-01-01',
      })
      const published = makeTrack({
        title: 'Published today',
        publishedAt: '2026-10-31T09:00:00.000Z',
      })

      assert.deepEqual(
        selectRecentlyAddedTracks([neverPublished, published]).map((track) => track.title),
        ['Published today', 'No publication timestamp'],
      )
    })

    it('respects the page limit for lazy loading', () => {
      const tracks = Array.from({ length: 5 }, (_, index) =>
        makeTrack({
          title: `Track ${index}`,
          publishedAt: `2026-10-0${index + 1}T10:00:00.000Z`,
        }),
      )

      const page = selectRecentlyAddedTracks(tracks, { limit: 2 })

      assert.deepEqual(
        page.map((track) => track.title),
        ['Track 4', 'Track 3'],
      )
    })
  })

  describe('Duplicates', () => {
    it('never lists the same catalog track twice', () => {
      const track = makeTrack({ title: 'About You' })
      const duplicate = { ...track, title: 'About You (duplicate row)' }

      const selected = selectRecentlyAddedTracks([track, duplicate])

      assert.equal(selected.length, 1)
      assert.equal(selected[0].providerTrackId, track.providerTrackId)
    })
  })

  describe('Automatic updates', () => {
    it('shows a newly published upload first without a manual refresh', () => {
      const existing = [
        makeTrack({ title: 'Yesterday', publishedAt: '2026-10-30T10:00:00.000Z' }),
        makeTrack({ title: 'Last week', publishedAt: '2026-10-24T10:00:00.000Z' }),
      ]

      const aboutYou = makeTrack({
        title: 'About You',
        publishedAt: '2026-10-31T23:59:00.000Z',
      })

      const merged = mergeRecentlyAddedTracks({ existing, incoming: [aboutYou] })

      assert.deepEqual(
        merged.map((track) => track.title),
        ['About You', 'Yesterday', 'Last week'],
      )
      assert.equal(merged[0].isPlayable, true)
      assert.ok(merged[0].storagePath || merged[0].playbackUrl)
    })

    it('stays idempotent when other clients receive the same realtime payload twice', () => {
      const existing = [makeTrack({ title: 'Existing', publishedAt: '2026-10-01T10:00:00.000Z' })]
      const incoming = [makeTrack({ title: 'New upload', publishedAt: '2026-10-31T10:00:00.000Z' })]

      const once = mergeRecentlyAddedTracks({ existing, incoming })
      const twice = mergeRecentlyAddedTracks({ existing: once, incoming })

      assert.equal(twice.length, once.length)
      assert.deepEqual(
        twice.map((track) => track.title),
        ['New upload', 'Existing'],
      )
    })

    it('ignores realtime events that are not published and playable', () => {
      const existing = [makeTrack({ title: 'Existing', publishedAt: '2026-10-01T10:00:00.000Z' })]
      const draft = makeTrack({
        title: 'Draft upload',
        publicationStatus: 'draft',
        publishedAt: '2026-10-31T10:00:00.000Z',
      })

      const merged = mergeRecentlyAddedTracks({ existing, incoming: [draft] })

      assert.deepEqual(
        merged.map((track) => track.title),
        ['Existing'],
      )
    })
  })
})
