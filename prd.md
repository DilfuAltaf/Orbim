# ORBIM — Product Requirements Document (PRD)

> **Product:** ORBIM  
> **Tagline:** Different Worlds. One Soundtrack.  
> **Document:** Product Requirements & Implementation Roadmap  
> **Status:** Initial Specification  
> **Version:** 1.0.0

---

## 1. Product Overview

### 1.1 What Is ORBIM?

ORBIM is a collaborative music discovery and playlist web application that allows people to discover music, create shared playlists, and collect songs together regardless of geographical distance.

The project originated from a simple problem: sharing and collaborating on playlists can be difficult when people cannot access the same music platforms.

ORBIM aims to provide an independent, accessible, and visually distinctive experience without requiring users to depend on Spotify's collaborative playlist functionality.

ORBIM is initially designed for two friends in Indonesia and Russia but must be architected to support more users in the future.

### 1.2 Product Vision

Create a beautiful, lightweight, and reliable shared music space where people can discover music and build collections together.

ORBIM should feel like a carefully designed music product, not a generic dashboard or a copy of an existing streaming service.

### 1.3 Core Value Proposition

- Discover music through an integrated music catalog.
- Create and manage playlists collaboratively.
- Invite friends through shareable links.
- See who added each song.
- Synchronize playlist changes in real time.
- Keep the music provider replaceable as the product evolves.

### 1.4 Product Principles

1. **Collaboration first:** Shared playlists are the primary differentiator.
2. **Design with intention:** Every screen must have a clear hierarchy and purpose.
3. **Lightweight:** Avoid unnecessary dependencies and heavy animations.
4. **Provider independent:** Music catalog integration must not dictate the entire application architecture.
5. **Security by default:** Database access, invitations, and authentication must be protected.
6. **Progressive implementation:** Build and validate one phase before proceeding to the next.

---

## 2. Goals and Non-Goals

### 2.1 Goals

- Deliver a responsive music web application.
- Integrate Jamendo API for catalog search and supported playback.
- Allow users to create personal and shared playlists.
- Enable users to add, remove, and reorder tracks.
- Display playlist changes in real time.
- Support sharing playlists with another user through a secure invitation mechanism.
- Provide an elegant, functional music player.
- Use Supabase for authentication, PostgreSQL, and Realtime.
- Deploy the frontend independently from any future backend services.

### 2.2 Non-Goals for the Initial Release

The initial release will not attempt to:

- Replace Spotify's complete music catalog.
- Host or redistribute copyrighted music files.
- Scrape restricted music streaming platforms.
- Guarantee that every track is playable in every country.
- Implement AI-generated music recommendations.
- Build social feeds, public comments, or messaging systems.
- Implement synchronized playback across multiple devices.
- Build a native mobile application.
- Implement subscription payments or monetization.

These features may be evaluated in later releases.

---

## 3. Target Users

### Primary User

A person who wants to create and maintain a shared music collection with a friend.

### Secondary User

An invited friend who wants to discover, contribute to, and listen to music in the same playlist.

### User Requirements

Users should be able to:

- Access the application using a supported browser.
- Understand the interface without extensive onboarding.
- Search for available music.
- Create playlists and contribute tracks.
- Identify who added a track.
- Invite collaborators without complicated procedures.
- Use the application on desktop and mobile devices.

International accessibility is important. The application must not assume that every music provider is accessible in every country.

---

## 4. Technology Stack

### Frontend

- React
- Vite
- TypeScript
- Tailwind CSS
- React Router
- Lucide React for icons

### Backend Services

- Supabase Auth for user authentication.
- Supabase PostgreSQL for application data.
- Supabase Realtime for playlist updates.
- Supabase Row Level Security (RLS) for access control.
- Supabase Edge Functions only when a trusted server-side operation is necessary.

### Music Provider

- Jamendo API v3.0.
- Jamendo audio playback URLs where permitted.
- Official documentation: https://developer.jamendo.com/v3.0

### Deployment

- Vercel for the frontend.
- Supabase-hosted services for authentication, database, and realtime functionality.

### Architecture Rules

- Use the official Supabase JavaScript client.
- Keep music-provider logic separate from UI components.
- Keep database operations separate from presentation logic.
- Use TypeScript types for API responses and application entities.
- Do not introduce a separate backend server unless a concrete requirement justifies it.
- Do not introduce Prisma or another ORM without explicit approval.

---

## 5. Brand Identity and Design Direction

### 5.1 Brand Name

**ORBIM**

The name represents the idea of separate worlds connected through a shared musical experience.

The name should remain independent of the original personal inspiration so that ORBIM can grow into a product for a wider audience.

### 5.2 Tagline

Primary tagline:

**Different Worlds. One Soundtrack.**

Secondary copy may use:

- Music Beyond Distance.
- Discover Together.
- Your Songs, Our Collection.

Do not display every tagline simultaneously. Use the primary tagline in brand-oriented areas and secondary copy only when appropriate.

### 5.3 Visual Direction

Design a premium, modern, dark music application with subtle futuristic elements.

The design should feel:

- Minimal but not empty.
- Atmospheric but readable.
- Modern without excessive neon effects.
- Personal without looking like a romantic or couples application.
- Distinctive without copying Spotify, Apple Music, or SoundCloud.

### 5.4 Color Palette

Suggested initial design tokens:

| Token | Value | Usage |
|---|---|---|
| Background | `#0D0F12` | Main application background |
| Surface | `#15181D` | Cards and panels |
| Elevated Surface | `#1C2026` | Dialogs and elevated elements |
| Primary Accent | `#B7F36B` | Primary actions and active states |
| Secondary Accent | `#A78BFA` | Secondary highlights |
| Primary Text | `#F4F4F5` | Headings and primary content |
| Secondary Text | `#A1A1AA` | Metadata and supporting text |
| Border | `#292D34` | Dividers and card borders |

These values are initial design tokens. Centralize them so the visual system can be refined without editing every component.

### 5.5 Logo Direction

Explore an abstract orbital symbol with two small points connected through intersecting orbital paths.

The logo must work in:

- Full wordmark format.
- Sidebar and navigation.
- Browser favicon.
- Playlist covers.
- Loading states.

Do not make the orbital symbol overly complex or dependent on animation.

### 5.6 Typography

Use a modern sans-serif typeface such as Inter or Manrope.

Typography rules:

- Clear distinction between page headings, section headings, track titles, and metadata.
- Avoid oversized headings that dominate functional screens.
- Use consistent font weights and line heights.
- Maintain readability on small screens.

### 5.7 Motion and Interaction

Allowed:

- Subtle hover transitions.
- Short fade and slide transitions.
- Smooth sidebar interactions.
- Lightweight player progress animations.
- Small visual feedback for playlist changes.

Avoid:

- Heavy 3D scenes.
- Excessive particle effects.
- Long intro animations.
- Continuous glowing backgrounds.
- Animations that delay user interaction.

Respect reduced-motion preferences.

---

## 6. Information Architecture

### Main Navigation

1. Home
2. Explore
3. Your Library
4. Shared Playlists
5. Settings

### Routes

| Route | Purpose |
|---|---|
| `/` | Home or redirect based on authentication |
| `/login` | Sign in |
| `/register` | Create account |
| `/explore` | Discover and search music |
| `/library` | Personal playlists and collections |
| `/playlist/:playlistId` | Playlist details |
| `/shared` | Playlists shared with the user |
| `/invite/:token` | Accept a playlist invitation |
| `/settings` | Profile and application preferences |

Route guards must protect authenticated pages. Invitation acceptance must validate the invitation on the server or through secure database operations.

---

## 7. Core User Flows

### Flow A — First-Time User

1. User opens ORBIM.
2. User sees the landing or authentication experience.
3. User registers or signs in.
4. User arrives at Home.
5. User can create a playlist or explore music.

### Flow B — Search and Add Music

1. User opens Explore.
2. User enters a song title or artist name.
3. ORBIM requests results from Jamendo.
4. The application displays available results with album art, title, artist, and duration.
5. User previews a playable track when supported.
6. User selects Add to Playlist.
7. User chooses an existing playlist.
8. The application saves the track reference and attribution.
9. The UI confirms success and updates the playlist.

The application must handle unavailable tracks, empty results, API errors, rate limits, and playback failures.

### Flow C — Create a Playlist

1. User selects Create Playlist.
2. User enters a playlist title and optional description.
3. The application creates the playlist and records its owner.
4. The user arrives at the playlist detail page.
5. The user can add tracks or invite collaborators.

### Flow D — Invite a Friend

1. Playlist owner selects Invite.
2. ORBIM generates a secure invitation.
3. Owner copies and shares the invitation URL.
4. The invited user opens the link.
5. ORBIM checks invitation validity and expiration.
6. The invited user signs in or registers if required.
7. The invitation is accepted.
8. The collaborator receives the appropriate playlist permissions.

The initial implementation may require an account to accept invitations. Do not promise anonymous editing before a secure guest-access model exists.

### Flow E — Collaborate in Real Time

1. Two authorized collaborators open the same playlist.
2. One collaborator adds, removes, or reorders a track.
3. The database validates and stores the operation.
4. Supabase Realtime broadcasts the permitted update.
5. The other collaborator's playlist view updates without a full page refresh.
6. Attribution reflects the user who performed the operation.

Handle duplicate events, stale state, failed operations, and reconnecting clients.

### Flow F — Playback

1. User selects a playable track.
2. ORBIM uses the supported Jamendo playback source.
3. The player displays track metadata and playback progress.
4. User can play, pause, seek, and skip where supported.
5. Playback errors produce a clear recovery state.

Playback capabilities must be verified against the actual provider response and licensing terms.

---

## 8. Functional Requirements

### FR-01 — Authentication

- Users can register, sign in, and sign out.
- Authentication state persists according to Supabase Auth behavior.
- Protected routes require a valid session.
- Authentication errors are presented clearly.

### FR-02 — Music Search

- Search by track title and artist.
- Display available metadata and artwork.
- Support loading, empty, and error states.
- Debounce text input to reduce unnecessary requests.
- Handle pagination or load-more functionality when supported.
- Do not treat API results as permanently available.

### FR-03 — Playlist Management

- Create and rename playlists.
- Delete playlists with appropriate confirmation.
- Add tracks to a playlist.
- Remove tracks.
- Reorder tracks.
- Display track count and total duration when calculable.
- Record who added each track.

### FR-04 — Collaboration

- Share playlists through invitation links.
- Accept or reject invalid or expired invitations.
- Enforce owner and collaborator permissions.
- Receive playlist updates through Supabase Realtime.
- Show collaborator identities where appropriate.

### FR-05 — Music Player

- Play and pause supported audio.
- Display current track information.
- Display playback progress.
- Support seeking when the media source allows it.
- Support next and previous track controls.
- Show loading, unavailable, and playback error states.
- Ensure player state remains consistent during navigation.

### FR-06 — Responsive UI

- Support desktop, tablet, and mobile layouts.
- Preserve important playback controls on small screens.
- Use accessible touch targets.
- Prevent horizontal overflow.

### FR-07 — Application Feedback

- Provide visible feedback for successful operations.
- Show actionable error messages.
- Include skeletons or loading indicators where appropriate.
- Include empty states with useful calls to action.

---

## 9. Music Provider Architecture

Create a provider abstraction rather than coupling the application directly to Jamendo responses.

Suggested interface:

```ts
export interface MusicTrack {
  provider: string;
  providerTrackId: string;
  title: string;
  artistName: string;
  albumName?: string;
  artworkUrl?: string;
  durationSeconds?: number;
  releaseDate?: string;
  playbackUrl?: string;
  trackUrl?: string;
  isPlayable: boolean;
}

export interface MusicProvider {
  searchTracks(
    query: string,
    options?: { limit?: number; offset?: number }
  ): Promise<MusicTrack[]>;

  getTrack(
    trackId: string
  ): Promise<MusicTrack | null>;
}
```

Adapt the interface to actual provider capabilities during implementation.

### Provider Rules

- Create a dedicated Jamendo adapter.
- Normalize provider responses into `MusicTrack`.
- Store the provider name and provider track ID.
- Do not assume every track has artwork, a valid license URL, or playable audio.
- Do not assume the `audio` field is guaranteed to remain available indefinitely.
- Do not persist temporary playback URLs as permanent identifiers.
- Never download and redistribute provider audio unless explicitly permitted.
- Do not add another provider until its technical and licensing requirements are assessed.

### Credentials

- A public Jamendo Client ID may be used for permitted public requests.
- Never expose a Client Secret in frontend code.
- Never place secrets in `VITE_*` environment variables.
- Add a server-side proxy or trusted function only when required by the provider's authentication rules.
- Keep local `.env` files out of version control.

### Initial Integration Test

Verify:

1. Search returns valid JSON.
2. Results map correctly into `MusicTrack`.
3. Artwork loads where available.
4. Playback succeeds for a permitted sample.
5. Empty and failed responses are handled.
6. API usage complies with Jamendo terms.

---

## 10. Data Model

Use Supabase PostgreSQL with migrations and appropriate foreign keys.

### `profiles`

- `id` — UUID, references `auth.users`.
- `display_name` — text.
- `avatar_url` — nullable text.
- `created_at` — timestamp.

### `playlists`

- `id` — UUID.
- `owner_id` — UUID, references `profiles`.
- `title` — text.
- `description` — nullable text.
- `visibility` — controlled value.
- `created_at` — timestamp.
- `updated_at` — timestamp.

### `playlist_members`

- `playlist_id` — UUID.
- `user_id` — UUID.
- `role` — owner or editor.
- `joined_at` — timestamp.

Use a unique constraint on `(playlist_id, user_id)`.

### `playlist_tracks`

- `id` — UUID.
- `playlist_id` — UUID.
- `provider` — text.
- `provider_track_id` — text.
- `title` — text.
- `artist_name` — text.
- `album_name` — nullable text.
- `artwork_url` — nullable text.
- `duration_seconds` — nullable integer.
- `position` — numeric or integer ordering field.
- `added_by` — UUID.
- `added_at` — timestamp.

Use an appropriate strategy to prevent duplicate track additions where intended, while allowing the same song to appear in different playlists.

### `playlist_invitations`

- `id` — UUID.
- `playlist_id` — UUID.
- `token_hash` — securely stored token hash.
- `created_by` — UUID.
- `role` — permitted invitation role.
- `expires_at` — timestamp.
- `accepted_at` — nullable timestamp.
- `created_at` — timestamp.

Invitation tokens must be generated securely, stored as hashes, and validated before membership changes.

### Database Requirements

- Use UUID identifiers.
- Add foreign keys and useful indexes.
- Use timestamps consistently.
- Create versioned SQL migrations.
- Enable RLS on exposed tables.
- Enforce permissions in database policies or trusted database functions, not only in frontend code.
- Validate invitation acceptance and membership changes securely.
- Avoid exposing private data through broad table policies.

This schema is an initial proposal. Validate the final schema and authorization model before applying migrations to a production project.

---

## 11. Security and Privacy

- Use Supabase Auth rather than custom password storage.
- Enable RLS on every exposed table containing user or playlist data.
- Owners can manage their playlists and membership.
- Editors can modify tracks only in playlists where they have editor permissions.
- Invitation tokens must be unguessable, expire, and be single-use where appropriate.
- Do not allow arbitrary users to grant themselves playlist membership.
- Validate all database mutations.
- Use the Supabase publishable/anon client key only with correctly configured RLS.
- Never expose Supabase service-role keys or provider secrets in the frontend.
- Avoid logging session tokens or invitation tokens.
- Protect against duplicate submissions and unauthorized membership changes.

---

## 12. UI Components

Suggested reusable components:

```text
src/
├── app/
│   ├── router.tsx
│   └── providers.tsx
├── components/
│   ├── layout/
│   │   ├── AppSidebar.tsx
│   │   ├── MobileNavigation.tsx
│   │   └── AppShell.tsx
│   ├── music/
│   │   ├── TrackRow.tsx
│   │   ├── TrackCard.tsx
│   │   ├── TrackArtwork.tsx
│   │   ├── SearchBar.tsx
│   │   └── MusicPlayer.tsx
│   ├── playlist/
│   │   ├── PlaylistCard.tsx
│   │   ├── PlaylistHeader.tsx
│   │   ├── PlaylistTrackList.tsx
│   │   ├── CollaboratorList.tsx
│   │   └── InviteDialog.tsx
│   └── ui/
│       ├── Button.tsx
│       ├── Dialog.tsx
│       ├── Skeleton.tsx
│       ├── EmptyState.tsx
│       └── Toast.tsx
├── features/
│   ├── auth/
│   ├── explore/
│   ├── library/
│   ├── playlists/
│   └── player/
├── lib/
│   ├── supabase.ts
│   └── utils.ts
├── services/
│   ├── music/
│   │   ├── types.ts
│   │   ├── jamendo.ts
│   │   └── index.ts
│   ├── playlists.ts
│   └── invitations.ts
├── hooks/
├── types/
├── pages/
├── styles/
└── main.tsx
```

This is a suggested structure, not a requirement to create every file immediately. Start with the smallest structure that supports the current phase.

---

## 13. Implementation Tasks and Phases

### Phase 0 — Repository Inspection and Planning

- [ ] Inspect the existing repository and installed dependencies.
- [ ] Identify existing conventions and project structure.
- [ ] Confirm the package manager and available scripts.
- [ ] Identify existing environment variables without printing secrets.
- [ ] Document implementation gaps.
- [ ] Confirm the implementation plan before making destructive changes.

**Acceptance criteria:** Existing project state is understood and the implementation plan is documented.

### Phase 1 — Foundation

- [ ] Configure React, Vite, and TypeScript.
- [ ] Configure Tailwind CSS according to the installed version.
- [ ] Set up React Router.
- [ ] Establish design tokens and typography.
- [ ] Create the shared application shell.
- [ ] Create reusable UI primitives.
- [ ] Configure linting and type checking.
- [ ] Verify the development server and production build.

**Acceptance criteria:** Application runs successfully, navigation works, and the visual foundation is consistent.

### Phase 2 — Design Implementation

- [ ] Build Home.
- [ ] Build Explore.
- [ ] Build Your Library.
- [ ] Build playlist detail layout.
- [ ] Build the persistent music player shell.
- [ ] Build responsive navigation.
- [ ] Add loading, empty, and error states.
- [ ] Verify desktop and mobile layouts.

**Acceptance criteria:** Core pages are navigable and visually complete using mock data. No database integration is required yet.

### Phase 3 — Jamendo Integration

- [ ] Implement the Jamendo provider adapter.
- [ ] Configure the public Client ID safely.
- [ ] Normalize track metadata.
- [ ] Implement search and pagination.
- [ ] Implement supported playback.
- [ ] Handle unavailable tracks and API errors.
- [ ] Verify artwork and audio behavior.
- [ ] Document catalog and licensing limitations.

**Acceptance criteria:** Users can search the actual catalog, view results, and play a verified sample where permitted.

### Phase 4 — Supabase Foundation

- [ ] Create the Supabase project configuration.
- [ ] Add versioned database migrations.
- [ ] Create profiles, playlists, playlist members, playlist tracks, and invitations tables.
- [ ] Configure RLS policies.
- [ ] Configure authentication.
- [ ] Create typed database access helpers.
- [ ] Test unauthorized access and ownership rules.

**Acceptance criteria:** Authentication and database operations work under verified authorization policies.

### Phase 5 — Playlist Management

- [ ] Create playlists.
- [ ] Rename and delete playlists.
- [ ] Add tracks to playlists.
- [ ] Remove tracks.
- [ ] Reorder tracks.
- [ ] Display track attribution.
- [ ] Connect the library and playlist pages to real data.
- [ ] Add optimistic UI only where rollback behavior is implemented.

**Acceptance criteria:** Playlist CRUD operations persist correctly and unauthorized mutations are rejected.

### Phase 6 — Collaboration and Realtime

- [ ] Implement secure invitation generation.
- [ ] Implement invitation acceptance.
- [ ] Add collaborator roles.
- [ ] Configure Realtime subscriptions.
- [ ] Synchronize playlist updates.
- [ ] Handle duplicate events and reconnection.
- [ ] Test simultaneous edits.
- [ ] Verify membership revocation and invitation expiration.

**Acceptance criteria:** Two authorized users can edit the same playlist and see changes without refreshing.

### Phase 7 — Quality and Deployment

- [ ] Test authentication flows.
- [ ] Test playlist permissions.
- [ ] Test provider failures.
- [ ] Test mobile layouts.
- [ ] Verify accessibility and keyboard navigation.
- [ ] Run type checking, linting, and production builds.
- [ ] Configure production environment variables.
- [ ] Deploy to Vercel.
- [ ] Test the deployed application.
- [ ] Document setup and deployment.

**Acceptance criteria:** Production deployment works, no secrets are exposed, and critical workflows pass testing.

---

## 14. Quality Requirements

### Performance

- Avoid unnecessary dependencies.
- Lazy-load nonessential routes when appropriate.
- Debounce search input.
- Avoid repeated requests for identical queries.
- Use lightweight artwork loading and sensible image fallbacks.
- Avoid heavy 3D rendering and continuous animations.

### Accessibility

- Use semantic HTML.
- Provide accessible labels for icon-only controls.
- Support keyboard navigation.
- Preserve sufficient text contrast.
- Respect reduced-motion settings.
- Provide visible focus states.

### Reliability

- Handle network failures without crashing the application.
- Preserve user input when safe to do so.
- Display understandable error messages.
- Avoid duplicate track additions caused by repeated submissions.
- Recover cleanly from realtime disconnections.

---

## 15. Testing Strategy

### Unit Tests

- Jamendo response normalization.
- Search input handling.
- Track metadata validation.
- Playlist ordering logic.
- Invitation token validation.
- Permission-related helper logic.

### Integration Tests

- Authentication and protected routes.
- Playlist creation and updates.
- Track addition and removal.
- Invitation acceptance.
- Realtime event handling.
- Music provider error handling.

### Manual Acceptance Tests

- Search for a real Jamendo track.
- Play a permitted sample.
- Create a playlist.
- Add and remove a track.
- Invite a second account.
- Edit the playlist from two browser sessions.
- Verify realtime updates.
- Attempt unauthorized access.
- Test mobile navigation.
- Verify that the music provider can be accessed from Indonesia and test with the collaborator in Russia.

Do not mark a test as passing unless it has actually been executed and its result observed.

---

## 16. Risks and Constraints

### Music Catalog Limitations

Jamendo focuses on independent music. It does not guarantee the availability of popular commercial releases.

**Mitigation:** Keep the provider abstraction independent and evaluate additional providers when necessary.

### Regional Availability

Music services and individual tracks may be unavailable in certain countries.

**Mitigation:** Test playback from both countries and provide clear unavailable-track states.

### Licensing

API access does not automatically grant unrestricted rights to stream, download, redistribute, or monetize music.

**Mitigation:** Follow Jamendo API terms, verify applicable track licensing, and confirm commercial requirements before monetization.

### API Limits

Requests may be restricted by quota, rate limits, or provider policy.

**Mitigation:** Debounce search, handle errors, and avoid unnecessary requests.

### Security

Incorrect RLS policies or invitation validation could expose private playlists.

**Mitigation:** Validate permissions at the database or trusted server layer and test negative authorization cases.

### Scope Creep

Adding too many features early may delay the core collaborative workflow.

**Mitigation:** Complete the phases sequentially and defer nonessential features.

---

## 17. Definition of Done

A feature is considered complete only when:

- Its intended behavior is implemented.
- Loading, empty, and error states are handled where applicable.
- Relevant access permissions are enforced.
- Type checking and relevant tests pass.
- The interface works on supported screen sizes.
- No credentials are exposed.
- Documentation is updated where necessary.
- Its acceptance criteria are verified.
- The implementation status reflects actual results.

Do not claim that a feature is complete merely because its UI exists.

---

## 18. AI Agent Operating Instructions

The AI agent implementing ORBIM must follow these instructions throughout development.

1. Read this PRD before making implementation decisions.
2. Inspect the existing repository before changing files.
3. Preserve existing working functionality unless a change is necessary and approved.
4. Do not rebuild the entire application when an incremental change is sufficient.
5. Work phase by phase in the order defined in Section 13.
6. Before starting a phase, summarize its objectives, dependencies, and expected files.
7. Implement only the current phase unless explicitly instructed otherwise.
8. Use real provider data for provider integration; do not leave mock results as the final implementation.
9. Never fabricate API responses, credentials, successful tests, or deployment results.
10. Never expose API secrets or Supabase service-role credentials.
11. Use database migrations and verify RLS policies before enabling collaborative editing.
12. Do not invent undocumented Jamendo API capabilities.
13. If a requirement cannot be verified, state the uncertainty and propose a test.
14. Run the relevant checks after implementation.
15. Report completed tasks, changed files, test results, limitations, and the exact next step.
16. Update the project task checklist only after verifying the relevant work.
17. Do not skip ahead to later phases without approval.
18. Ask for user input only when a missing decision blocks safe or correct implementation.

### Required Phase Report

After each phase, provide:

- Phase name and status.
- Summary of implemented behavior.
- Files created or changed.
- Commands and checks executed.
- Actual test results.
- Known issues or incomplete requirements.
- Recommended next phase.

---

## 19. Initial Execution Instruction

**Start with Phase 0 only.**

Inspect the existing repository, identify the current stack and package manager, review existing documentation, and report the implementation plan.

Do not immediately generate the entire application.

Do not overwrite existing project files before understanding their contents.

After reporting Phase 0 findings, wait for approval before implementing Phase 1.

---

## 20. Final Product Definition

ORBIM succeeds as an initial release when two authorized users can independently access the application, search supported music, create a shared playlist, add and remove tracks, see who contributed each track, and receive playlist updates in real time.

The initial product should prioritize a coherent design, dependable collaboration, and a replaceable music provider architecture over a large number of secondary features.

**ORBIM — Different Worlds. One Soundtrack.**