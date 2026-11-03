import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classifyInvitationFailure,
  dedupeCandidates,
  invitationFailureMessage,
  isInvitationUsable,
  isRecoverableFailure,
  isTerminalStatus,
  resolveInvitationStatus,
  type CandidateLike,
} from '../src/services/playlist/invitation-lifecycle.ts'
import {
  searchCollaboratorCandidates,
} from '../src/services/user/collaborator-search.ts'

test('Invitation Lifecycle: Status resolution and expiry checks', () => {
  // Pending invitation with future expiration
  const future = new Date(Date.now() + 1000 * 60 * 60).toISOString()
  assert.equal(resolveInvitationStatus({ status: 'pending', expiresAt: future }), 'pending')
  assert.equal(isInvitationUsable({ status: 'pending', expiresAt: future }), true)

  // Past expiration automatically resolves to expired even if stored as pending
  const past = new Date(Date.now() - 1000 * 60).toISOString()
  assert.equal(resolveInvitationStatus({ status: 'pending', expiresAt: past }), 'expired')
  assert.equal(isInvitationUsable({ status: 'pending', expiresAt: past }), false)

  // Terminal statuses
  assert.equal(resolveInvitationStatus({ status: 'accepted' }), 'accepted')
  assert.equal(resolveInvitationStatus({ status: 'declined' }), 'declined')
  assert.equal(resolveInvitationStatus({ status: 'revoked' }), 'revoked')
  assert.equal(resolveInvitationStatus({ accepted_at: new Date().toISOString() }), 'accepted')

  assert.equal(isTerminalStatus('accepted'), true)
  assert.equal(isTerminalStatus('declined'), true)
  assert.equal(isTerminalStatus('revoked'), true)
  assert.equal(isTerminalStatus('expired'), true)
  assert.equal(isTerminalStatus('pending'), false)
})

test('Invitation Lifecycle: Failure classification and recoverability', () => {
  // Recoverable errors
  assert.equal(classifyInvitationFailure({ message: 'Failed to fetch' }), 'network')
  assert.equal(isRecoverableFailure('network'), true)

  assert.equal(classifyInvitationFailure({ message: 'Database connection error' }), 'server')
  assert.equal(isRecoverableFailure('server'), true)

  // Non-recoverable errors
  assert.equal(
    classifyInvitationFailure({ message: 'This invitation has already been accepted and is no longer valid.' }),
    'already_accepted',
  )
  assert.equal(isRecoverableFailure('already_accepted'), false)

  assert.equal(classifyInvitationFailure({ message: 'This invitation has expired.' }), 'expired')
  assert.equal(isRecoverableFailure('expired'), false)

  assert.equal(
    classifyInvitationFailure({ message: 'This invitation has been revoked by the playlist owner.' }),
    'revoked',
  )
  assert.equal(isRecoverableFailure('revoked'), false)

  assert.equal(classifyInvitationFailure({ message: 'This invitation was declined.' }), 'declined')
  assert.equal(isRecoverableFailure('declined'), false)

  assert.equal(
    classifyInvitationFailure({ message: 'This invitation is addressed to another ORBIM account.' }),
    'wrong_account',
  )
  assert.equal(isRecoverableFailure('wrong_account'), false)

  assert.equal(
    classifyInvitationFailure({ message: 'Invalid or missing invitation token.' }),
    'invalid',
  )
  assert.equal(isRecoverableFailure('invalid'), false)

  // By Postgres error code
  assert.equal(classifyInvitationFailure({ code: 'ORB01' }), 'not_authenticated')
  assert.equal(classifyInvitationFailure({ code: 'ORB04' }), 'already_accepted')
  assert.equal(classifyInvitationFailure({ code: 'ORB05' }), 'expired')
  assert.equal(classifyInvitationFailure({ code: 'ORB09' }), 'revoked')
  assert.equal(classifyInvitationFailure({ code: 'ORB10' }), 'declined')
  assert.equal(classifyInvitationFailure({ code: 'ORB11' }), 'wrong_account')
  assert.equal(classifyInvitationFailure({ code: 'ORB12' }), 'unauthorized')
  assert.equal(classifyInvitationFailure({ code: '42501' }), 'unauthorized')

  // User-facing messages exist for all kinds
  assert.ok(invitationFailureMessage('invalid').length > 5)
  assert.ok(invitationFailureMessage('already_member').length > 5)
  assert.ok(invitationFailureMessage('expired').length > 5)
})

test('Collaborator Search Deduplication: Collapses duplicate records using canonical identity', () => {
  const records: CandidateLike[] = [
    // Supabase canonical record (priority 3)
    {
      id: 'uuid-dilfu-supabase',
      displayName: 'dilfualtaf07',
      email: 'dilfualtaf07@gmail.com',
      priority: 3,
    },
    // Local dev server record (priority 1) with matching email
    {
      id: 'usr-admin-dilfu',
      displayName: 'dilfualtaf07',
      email: 'dilfualtaf07@gmail.com',
      priority: 1,
    },
    // Local fallback record with matching id
    {
      id: 'uuid-dilfu-supabase',
      displayName: 'Dilfu Altaf',
      email: 'other@example.com',
      priority: 0,
    },
    // Distinct user
    {
      id: 'uuid-mira',
      displayName: 'Mira K.',
      email: 'mira@example.com',
      priority: 2,
    },
  ]

  const deduped = dedupeCandidates(records)
  assert.equal(deduped.length, 2, 'Should collapse 3 dilfu records into 1 canonical record')
  assert.equal(deduped[0].id, 'uuid-dilfu-supabase', 'Highest priority canonical ID should win')
  assert.equal(deduped[0].displayName, 'dilfualtaf07')
  assert.equal(deduped[1].id, 'uuid-mira')
})

test('Collaborator Search: Excludes current user, playlist owner, and existing collaborators', async () => {
  const query = 'mira'
  const ownerId = 'usr-owner-id'
  const existingCollabId = 'usr-mira-01'

  // Exclude current user via identity parameter
  const excludedSelf = await searchCollaboratorCandidates(query, { id: 'usr-mira-01' })
  assert.equal(excludedSelf.length, 0, 'Self must be excluded')

  // Exclude via options.excludeUserIds
  const excludedOptions = await searchCollaboratorCandidates(query, undefined, {
    excludeUserIds: [ownerId, existingCollabId],
  })
  assert.equal(
    excludedOptions.some((c) => c.id === existingCollabId),
    false,
    'Existing collaborator must be excluded',
  )
})
