import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addPlaylistCollaborator,
  loadPlaylistCollaborators,
  removePlaylistCollaborator,
} from '../src/server/user-invitation-service.ts'

test('Playlist Member Kick Interactive Workflow', async (t) => {
  const testPlaylistId = `test-kick-pl-${Date.now()}`
  const testUserId = `test-user-${Date.now()}`

  await t.test('Owner can add and then kick/remove a collaborator', () => {
    addPlaylistCollaborator({
      playlistId: testPlaylistId,
      userId: testUserId,
      displayName: 'Test Collaborator',
      role: 'editor',
    })

    const current = loadPlaylistCollaborators(testPlaylistId)
    const exists = current.some((c) => c.userId === testUserId)
    assert.equal(exists, true, 'Collaborator should be present after adding')

    const removed = removePlaylistCollaborator(testPlaylistId, testUserId)
    assert.equal(removed, true, 'removePlaylistCollaborator should return true')

    const afterKick = loadPlaylistCollaborators(testPlaylistId)
    const stillExists = afterKick.some((c) => c.userId === testUserId)
    assert.equal(stillExists, false, 'Collaborator should no longer exist after being kicked')
  })
})
