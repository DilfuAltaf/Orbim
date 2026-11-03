import type { Collaborator, PersonSummary, PlaylistRole } from '../../types/music.ts'

/**
 * Demo people. The signed-in user does not exist yet (Supabase Auth is Phase 4),
 * so `demoViewer` is only a display handle for mock attribution — never a session.
 */
export const demoViewer: PersonSummary = {
  id: 'person-viewer',
  displayName: 'You',
  location: 'Jakarta, ID',
}

export const mira: PersonSummary = {
  id: 'person-mira',
  displayName: 'Mira K.',
  location: 'Lisbon, PT',
}

export const dima: PersonSummary = {
  id: 'person-dima',
  displayName: 'Dima S.',
  location: 'St. Petersburg, RU',
}

export const ana: PersonSummary = {
  id: 'person-ana',
  displayName: 'Ana Reyes',
  location: 'Manila, PH',
}

export const june: PersonSummary = {
  id: 'person-june',
  displayName: 'June Park',
  location: 'Seoul, KR',
}

export function toCollaborator(
  person: PersonSummary,
  role: PlaylistRole,
  joinedAt: string,
): Collaborator {
  return { ...person, role, joinedAt }
}
