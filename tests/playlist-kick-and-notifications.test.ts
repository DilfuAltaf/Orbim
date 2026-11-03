import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addPlaylistCollaborator,
  deleteServerNotification,
  loadPlaylistCollaborators,
  loadServerNotifications,
  removePlaylistCollaborator,
  saveServerNotification,
  updateNotificationStatus,
  type ServerNotificationRecord,
} from '../src/server/user-invitation-service.ts'

test('Playlist Member Kick & Notification Interactive Workflow', async (t) => {
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

  await t.test('Interactive Notification: send, query, allow, and reject', () => {
    const notifId = `test-notif-${Date.now()}`
    const targetUserId = `user-target-${Date.now()}`

    const notif: ServerNotificationRecord = {
      id: notifId,
      type: 'playlist_invitation',
      recipientUserId: targetUserId,
      recipientDisplayName: 'Target User',
      senderUserId: 'owner-123',
      senderDisplayName: 'dilfualtaf07',
      playlistId: testPlaylistId,
      playlistTitle: 'Rock Anthem',
      role: 'editor',
      status: 'pending',
      createdAt: new Date().toISOString(),
    }

    // Save notification
    saveServerNotification(notif)

    // Load by user
    const loaded = loadServerNotifications(targetUserId)
    assert.equal(loaded.length >= 1, true, 'Target user should receive notification')
    assert.equal(loaded[0].status, 'pending')

    // Also test multi-attribute query (email and displayName matching)
    const multiQueryLoaded = loadServerNotifications({
      userId: 'some-random-supabase-uuid',
      displayName: 'Target User',
    })
    assert.equal(
      multiQueryLoaded.some((n) => n.id === notifId),
      true,
      'Multi-attribute query matching displayName should find notification',
    )

    // Accept (Allow) notification
    const accepted = updateNotificationStatus(notifId, 'accepted', 'caller-supabase-uuid', 'Target User Active')
    assert.ok(accepted)
    assert.equal(accepted.status, 'accepted')

    // Check that accepting also added collaborator to the playlist
    const collabs = loadPlaylistCollaborators(testPlaylistId)
    assert.equal(
      collabs.some((c) => c.userId === targetUserId || c.userId === 'caller-supabase-uuid'),
      true,
      'Accepting invitation notification should add collaborator',
    )

    // Reject workflow for a second notification
    const rejectNotifId = `test-notif-reject-${Date.now()}`
    saveServerNotification({
      ...notif,
      id: rejectNotifId,
      status: 'pending',
    })

    const rejected = updateNotificationStatus(rejectNotifId, 'rejected')
    assert.ok(rejected)
    assert.equal(rejected.status, 'rejected')

    // Cleanup
    deleteServerNotification(notifId)
    deleteServerNotification(rejectNotifId)
    removePlaylistCollaborator(testPlaylistId, targetUserId)
  })
})
