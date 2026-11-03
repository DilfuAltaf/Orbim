import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { SpotifyWebPlaybackEngine } from '../src/features/player/spotify-engine.ts'
import type { SpotifyEngineStatus } from '../src/features/player/spotify-engine.ts'
import {
  _resetSpotifySdkLoaderForTesting,
  loadSpotifySdk,
  SPOTIFY_SDK_URL,
} from '../src/features/player/spotify-sdk-loader.ts'
import type {
  SpotifySdkEventPayloadMap,
  SpotifySdkPlaybackEvent,
  SpotifySdkPlayer,
  SpotifySdkWebPlaybackState,
} from '../src/features/player/spotify-sdk-loader.ts'
import {
  hasValidSpotifyTrackId,
  selectTrackPlayback,
} from '../src/features/player/playback-engine.ts'
import { Html5AudioEngine } from '../src/features/player/html5-audio-engine.ts'
import type { MusicTrack } from '../src/types/music.ts'

/**
 * Spotify Web Playback SDK engine tests (P2).
 *
 * The SDK, its player and the Web API are all mocked: no live Spotify
 * credentials, network traffic or real playback is involved. The tests lock
 * engine lifecycle, scope/error states, uri construction from provider track
 * ids and the fact that Spotify tracks never fabricate audio URLs or fall
 * back to simulated playback.
 */

const TRACK_ID = '3n3Ppam7vgaVa1iaRUc9Lp'
const TRACK_URI = `spotify:track:${TRACK_ID}`

type Listener = (payload: never) => void

interface FakeScriptElement {
  id: string
  src: string
  async: boolean
  onerror: (() => void) | null
}

let createdScripts: FakeScriptElement[]
let fakeWindow: {
  Spotify?: unknown
  onSpotifyWebPlaybackSDKReady?: (() => void) | undefined
}

function installBrowserGlobals(): void {
  createdScripts = []
  fakeWindow = {
    Spotify: undefined,
    onSpotifyWebPlaybackSDKReady: undefined,
  }
  globalThis.window = fakeWindow as unknown as Window & typeof globalThis
  globalThis.document = {
    getElementById: (id: string) =>
      (createdScripts as unknown as Array<{ id: string }>).find((script) => script.id === id) ??
      null,
    createElement: (): FakeScriptElement => ({ id: '', src: '', async: false, onerror: null }),
    head: {
      appendChild: (script: FakeScriptElement) => {
        createdScripts.push(script)
      },
    },
  } as unknown as Document
}

function uninstallBrowserGlobals(): void {
  globalThis.window = undefined as unknown as Window & typeof globalThis
  globalThis.document = undefined as unknown as Document
}

describe('Spotify SDK script loader', () => {
  it('rejects cleanly outside a browser environment', async () => {
    _resetSpotifySdkLoaderForTesting()
    uninstallBrowserGlobals()

    await assert.rejects(async () => loadSpotifySdk(), /requires a browser environment/)
  })

  it('loads the official SDK script exactly once and caches the namespace', async () => {
    _resetSpotifySdkLoaderForTesting()
    installBrowserGlobals()
    const fakeSdk = { Player: function FakeSdkPlayer() {} }

    const first = loadSpotifySdk()
    assert.equal(createdScripts.length, 1, 'exactly one script tag is appended')
    assert.equal(createdScripts[0].src, SPOTIFY_SDK_URL)
    assert.equal(createdScripts[0].async, true)

    const second = loadSpotifySdk()
    assert.equal(createdScripts.length, 1, 'concurrent calls must not duplicate the tag')

    fakeWindow.Spotify = fakeSdk
    fakeWindow.onSpotifyWebPlaybackSDKReady?.()

    const [resolvedFirst, resolvedSecond] = await Promise.all([first, second])
    assert.equal(resolvedFirst, fakeSdk)
    assert.equal(resolvedSecond, fakeSdk)

    const cached = await loadSpotifySdk()
    assert.equal(cached, fakeSdk, 'an already loaded SDK is reused')
    assert.equal(createdScripts.length, 1)
  })

  it('preserves an unrelated pre-existing ready callback', async () => {
    _resetSpotifySdkLoaderForTesting()
    installBrowserGlobals()
    const unrelatedCalls: number[] = []
    const fakeSdk = { Player: function FakeSdkPlayer() {} }
    fakeWindow.onSpotifyWebPlaybackSDKReady = () => {
      unrelatedCalls.push(1)
    }

    const pending = loadSpotifySdk()
    fakeWindow.Spotify = fakeSdk
    fakeWindow.onSpotifyWebPlaybackSDKReady?.()

    await pending
    assert.deepEqual(unrelatedCalls, [1], 'third-party ready callback is preserved and invoked')
  })

  it('rejects when the script fails and allows a later retry', async () => {
    _resetSpotifySdkLoaderForTesting()
    installBrowserGlobals()

    const failing = loadSpotifySdk()
    const script = createdScripts[0]
    script.onerror?.()
    await assert.rejects(async () => failing, /Failed to load the Spotify Web Playback SDK/)

    // The loader cache was cleared: a later call retries instead of returning
    // the stale rejection. The existing tag is reused (not re-appended).
    const retry = loadSpotifySdk()
    assert.equal(createdScripts.length, 1)

    fakeWindow.Spotify = { Player: function FakeSdkPlayer() {} }
    fakeWindow.onSpotifyWebPlaybackSDKReady?.()
    await retry
  })
})

interface FakeSpotifyPlayerOptions {
  name: string
  volume: number
  getOAuthToken: (callback: (token: string) => void) => void
}

class FakeSpotifyPlayer implements SpotifySdkPlayer {
  readonly calls: string[] = []
  options: FakeSpotifyPlayerOptions
  connectResult: boolean
  emitReadyOnConnect: boolean
  deviceId: string
  state: SpotifySdkWebPlaybackState | null = null
  disconnected = false
  volumeApplied: number[] = []
  seekAppliedMs: number[] = []

  private listeners = new Map<SpotifySdkPlaybackEvent, Listener[]>()

  constructor(
    options: FakeSpotifyPlayerOptions,
    behavior: { connectResult?: boolean; emitReadyOnConnect?: boolean; deviceId?: string } = {},
  ) {
    this.options = options
    this.connectResult = behavior.connectResult ?? true
    this.emitReadyOnConnect = behavior.emitReadyOnConnect ?? true
    this.deviceId = behavior.deviceId ?? 'orbim-device-1'
  }

  async connect(): Promise<boolean> {
    this.calls.push('connect')
    if (this.emitReadyOnConnect) {
      await Promise.resolve()
      this.emit('ready', { device_id: this.deviceId } as SpotifySdkEventPayloadMap['ready'])
    }
    return this.connectResult
  }

  disconnect(): void {
    this.disconnected = true
    this.calls.push('disconnect')
  }

  addListener(event: SpotifySdkPlaybackEvent, listener: Listener): boolean {
    const list = this.listeners.get(event) ?? []
    list.push(listener)
    this.listeners.set(event, list)
    return true
  }

  removeListener(event: SpotifySdkPlaybackEvent): boolean {
    this.listeners.set(event, [])
    return true
  }

  pause(): Promise<void> {
    this.calls.push('pause')
    return Promise.resolve()
  }

  resume(): Promise<void> {
    this.calls.push('resume')
    return Promise.resolve()
  }

  seek(positionMs: number): Promise<void> {
    this.calls.push(`seek:${positionMs}`)
    this.seekAppliedMs.push(positionMs)
    return Promise.resolve()
  }

  setVolume(volume: number): Promise<void> {
    this.calls.push(`volume:${volume}`)
    this.volumeApplied.push(volume)
    return Promise.resolve()
  }

  activateElement(): HTMLElement | undefined {
    this.calls.push('activateElement')
    return undefined
  }

  getCurrentState(): SpotifySdkWebPlaybackState | null {
    return this.state
  }

  emit(event: SpotifySdkPlaybackEvent, payload: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) {
      ;(listener as (typed: unknown) => void)(payload)
    }
  }

  listenerCount(event: SpotifySdkPlaybackEvent): number {
    return (this.listeners.get(event) ?? []).length
  }
}

function makeSpotifyTrack(overrides: Partial<MusicTrack> = {}): MusicTrack {
  return {
    provider: 'spotify',
    providerTrackId: TRACK_ID,
    title: 'Spotify Fixture',
    artistName: 'Fixture Artist',
    albumName: 'Fixture Album',
    durationSeconds: 180,
    genre: 'Test',
    moods: [],
    isPlayable: false,
    ...overrides,
  } as MusicTrack
}

function sdkState(
  overrides: Partial<SpotifySdkWebPlaybackState> = {},
): SpotifySdkWebPlaybackState {
  return {
    context: { uri: null },
    disallows: {},
    position: 0,
    duration: 180_000,
    paused: true,
    repeat_mode: 0,
    shuffle: false,
    track_window: {
      current_track: { id: TRACK_ID, uri: TRACK_URI, name: 'Fixture' },
      previous_tracks: [],
      next_tracks: [],
    },
    ...overrides,
  }
}

interface HarnessEvents {
  time: number[]
  waiting: number
  playing: number
  paused: number
  ended: number
  errors: string[]
}

interface FetchCall {
  url: string
  init: RequestInit | null
}

interface Harness {
  engine: SpotifyWebPlaybackEngine
  statuses: SpotifyEngineStatus[]
  events: HarnessEvents
  players: FakeSpotifyPlayer[]
  tokenRequests: number
  fetchCalls: FetchCall[]
  setResponseStatus: (status: number) => void
  failNetwork: (shouldFail: boolean) => void
  dispose: () => void
}

function createHarness(
  overrides: {
    getToken?: () => Promise<string | null>
    connectResult?: boolean
    emitReadyOnConnect?: boolean
  } = {},
): Harness {
  installBrowserGlobals()
  _resetSpotifySdkLoaderForTesting()
  // The engine resolves the SDK through the loader's cache path; provide an
  // already loaded namespace so no script loading is involved here.
  fakeWindow.Spotify = { Player: function FakeSdkPlayer() {} }

  const statuses: SpotifyEngineStatus[] = []
  const events: HarnessEvents = {
    time: [],
    waiting: 0,
    playing: 0,
    paused: 0,
    ended: 0,
    errors: [],
  }
  const players: FakeSpotifyPlayer[] = []
  let tokenRequests = 0
  const fetchCalls: FetchCall[] = []
  let responseStatus = 204
  let failNetwork = false

  const defaultGetToken = async (): Promise<string | null> => {
    tokenRequests += 1
    return 'orbim-access-token-fake'
  }

  const engine = new SpotifyWebPlaybackEngine({
    getToken:
      overrides.getToken ??
      (() => defaultGetToken()),
    fetchFn: (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (failNetwork) {
        throw new TypeError('Simulated network failure')
      }
      fetchCalls.push({ url: String(url), init: init ?? null })
      return { status: responseStatus, ok: responseStatus < 400 } as unknown as Response
    }) as unknown as typeof fetch,
    deviceReadyTimeoutMs: 50,
    positionPollIntervalMs: 50_000,
    playerName: 'ORBIM Test Player',
    events: {
      onTime: (seconds) => {
        events.time.push(seconds)
      },
      onWaiting: () => {
        events.waiting += 1
      },
      onPlaying: () => {
        events.playing += 1
      },
      onPause: () => {
        events.paused += 1
      },
      onEnded: () => {
        events.ended += 1
      },
      onError: (detail) => {
        events.errors.push(detail)
      },
    },
    onStatus: (status) => {
      statuses.push(status)
    },
    createPlayer: (_sdk, options) => {
      const player = new FakeSpotifyPlayer(options, {
        connectResult: overrides.connectResult,
        emitReadyOnConnect: overrides.emitReadyOnConnect,
      })
      players.push(player)
      return player
    },
  })

  return {
    engine,
    statuses,
    events,
    players,
    get tokenRequests() {
      return tokenRequests
    },
    fetchCalls,
    setResponseStatus(status: number) {
      responseStatus = status
    },
    failNetwork(shouldFail: boolean) {
      failNetwork = shouldFail
    },
    dispose() {
      engine.dispose()
      uninstallBrowserGlobals()
    },
  }
}

describe('SpotifyWebPlaybackEngine: track identity & loading', () => {
  it('builds the Spotify URI strictly from the provider track id', () => {
    const harness = createHarness()
    try {
      const track = makeSpotifyTrack()
      assert.equal(hasValidSpotifyTrackId(track), true)
      assert.equal(selectTrackPlayback(track), 'spotify-sdk', 'valid id selects the SDK engine')

      harness.engine.load(track)

      assert.equal(harness.engine.currentSource(), TRACK_URI)
      assert.equal(harness.engine.hasSource(), true)
      assert.equal(harness.engine.getDuration(), 180, 'metadata duration is provisional')
      assert.equal(harness.engine.isPaused(), true)
      assert.equal(harness.fetchCalls.length, 0, 'loading alone never talks to the Web API')
    } finally {
      harness.dispose()
    }
  })

  it('refuses missing or malformed Spotify track ids', () => {
    const harness = createHarness()
    try {
      assert.throws(() => harness.engine.load(makeSpotifyTrack({ providerTrackId: '' })), /malformed/)
      assert.throws(() => harness.engine.load(makeSpotifyTrack({ providerTrackId: 'too-short' })), /malformed/)
      assert.throws(
        () => harness.engine.load(makeSpotifyTrack({ providerTrackId: 'invalid-id-with-symbols!$#!!' })),
        /malformed/,
      )
      assert.throws(
        () => harness.engine.load(makeSpotifyTrack({ provider: 'demo', providerTrackId: TRACK_ID })),
        /non-Spotify/,
      )
      assert.equal(harness.engine.hasSource(), false, 'nothing was loaded')
      assert.equal(harness.engine.currentSource(), null)

      assert.equal(hasValidSpotifyTrackId(makeSpotifyTrack({ providerTrackId: 'b'.repeat(21) })), false)
      assert.equal(hasValidSpotifyTrackId(makeSpotifyTrack({ providerTrackId: TRACK_ID })), true)
    } finally {
      harness.dispose()
    }
  })

  it('never fabricates an audio URL for Spotify tracks', () => {
    const harness = createHarness()
    try {
      const fakeAudio = {
        src: '',
        addEventListener: () => {},
        removeEventListener: () => {},
        pause: () => {},
        removeAttribute: () => {},
        load: () => {},
      } as unknown as HTMLAudioElement

      const html5 = new Html5AudioEngine({
        audio: fakeAudio,
        events: {
          onTime: () => {},
          onWaiting: () => {},
          onPlaying: () => {},
          onPause: () => {},
          onEnded: () => {},
          onError: () => {},
        },
      })

      assert.throws(
        () => html5.load(makeSpotifyTrack()),
        /without a concrete audio URL/,
        'metadata-only Spotify tracks still cannot enter the HTML5 engine',
      )
      assert.equal(fakeAudio.src, '', 'no audio URL was manufactured')

      // And selection never maps a metadata-only Spotify track to the demo timer.
      assert.notEqual(selectTrackPlayback(makeSpotifyTrack()), 'timer-fallback')
      assert.notEqual(selectTrackPlayback(makeSpotifyTrack()), 'html5-audio')
      html5.dispose()
    } finally {
      harness.dispose()
    }
  })
})

describe('SpotifyWebPlaybackEngine: lifecycle & playback', () => {
  it('play() connects once, waits for the device and loads the track via the play endpoint', async () => {
    const harness = createHarness()
    try {
      harness.engine.load(makeSpotifyTrack())
      await harness.engine.play()

      assert.equal(harness.players.length, 1, 'exactly one player instance was created')
      const player = harness.players[0]
      assert.deepEqual(player.calls.filter((call) => call === 'connect'), ['connect'])

      assert.equal(harness.fetchCalls.length, 1)
      const call = harness.fetchCalls[0]
      assert.ok(call.url.includes('/me/player/play?device_id=orbim-device-1'))
      assert.equal(call.init?.method, 'PUT', 'start/resume playback uses the documented method')
      assert.equal(
        call.init?.headers && (call.init.headers as Record<string, string>)['Authorization'],
        'Bearer orbim-access-token-fake',
      )
      const body = JSON.parse(String(call.init?.body)) as { uris: string[]; position_ms: number }
      assert.deepEqual(body.uris, [TRACK_URI])
      assert.equal(body.position_ms, 0)

      const statusKinds = harness.statuses.map((status) => status.kind)
      assert.ok(statusKinds.includes('connecting'))
      assert.ok(statusKinds.includes('device-ready'))
    } finally {
      harness.dispose()
    }
  })

  it('stay-connected state reuses the initialized player instead of reconnecting', async () => {
    const harness = createHarness()
    try {
      harness.engine.load(makeSpotifyTrack())
      await harness.engine.play()
      harness.engine.seekTo(10)
      await harness.engine.play()

      const player = harness.players[0]
      assert.equal(player.calls.filter((call) => call === 'connect').length, 1)
      assert.equal(harness.fetchCalls.length, 2, 'each track load uses the play endpoint again')
    } finally {
      harness.dispose()
    }
  })

  it('token callback delivers a valid (possibly refreshed) token without logging it', async () => {
    const harness = createHarness()
    try {
      harness.engine.load(makeSpotifyTrack())
      await harness.engine.play()

      const player = harness.players[0]
      let received: string | null = null
      await new Promise<void>((resolve) => {
        player.options.getOAuthToken((token) => {
          received = token
          resolve()
        })
      })
      assert.equal(received, 'orbim-access-token-fake')
    } finally {
      harness.dispose()
    }
  })

  it('token callback failure surfaces an authentication status, not a token', async () => {
    const harness = createHarness({
      getToken: () => Promise.reject(new Error('Simulated refresh failure')),
    })
    try {
      harness.engine.load(makeSpotifyTrack())
      await assert.rejects(async () => harness.engine.play(), /no longer valid/)

      const player = harness.players[0]
      let cbCalled = false
      player.options.getOAuthToken(() => {
        cbCalled = true
      })
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 10)
      })
      assert.equal(cbCalled, false, 'the SDK callback is never invoked with an unusable token')
      assert.ok(
        harness.statuses.some(
          (status) =>
            status.kind === 'auth-error' && /Reconnect Spotify from Settings/.test(status.message ?? ''),
        ),
      )
      assert.ok(harness.events.errors.length >= 1)
      assert.ok(
        !JSON.stringify(harness.statuses).includes('Simulated refresh failure'),
        'raw error payloads are not exposed in statuses',
      )
    } finally {
      harness.dispose()
    }
  })

  it('ready/not_ready transitions track device availability', async () => {
    const harness = createHarness()
    try {
      harness.engine.load(makeSpotifyTrack())
      await harness.engine.play()

      const player = harness.players[0]
      player.deviceId = 'orbim-device-2'
      player.emit('not_ready', { device_id: 'orbim-device-1' })
      assert.ok(
        harness.statuses.some((status) => status.kind === 'device-not-ready'),
        'device offline is surfaced',
      )

      player.emit('ready', { device_id: 'orbim-device-2' })
      assert.ok(
        harness.statuses.some((status) => status.kind === 'device-ready'),
        'a later ready event is surfaced',
      )
    } finally {
      harness.dispose()
    }
  })

  it('device-not-ready times out play with an actionable message', async () => {
    const harness = createHarness({ emitReadyOnConnect: false })
    try {
      harness.engine.load(makeSpotifyTrack())
      await assert.rejects(async () => harness.engine.play(), /device is not ready yet/)
      assert.ok(harness.statuses.some((status) => status.kind === 'device-not-ready'))
      assert.equal(harness.fetchCalls.length, 0, 'no playback request without a device')
    } finally {
      harness.dispose()
    }
  })

  it('account_error marks the Premium requirement', async () => {
    const harness = createHarness()
    try {
      harness.engine.load(makeSpotifyTrack())
      await harness.engine.play()
      const player = harness.players[0]
      player.emit('account_error', { message: 'Premium required' })

      assert.ok(
        harness.statuses.some(
          (status) => status.kind === 'premium-required' && /Premium/.test(status.message ?? ''),
        ),
      )
      assert.ok(harness.events.errors.some((detail) => /Premium account/.test(detail)))
    } finally {
      harness.dispose()
    }
  })

  it('authentication, initialization and playback errors produce distinct states', async () => {
    const harness = createHarness()
    try {
      harness.engine.load(makeSpotifyTrack())
      await harness.engine.play()
      const player = harness.players[0]
      const statuses = harness.statuses
      const errors = () => harness.events.errors

      player.emit('authentication_error', { message: 'bad session' })
      assert.ok(statuses.some((status) => status.kind === 'auth-error'))
      assert.ok(errors().some((detail) => /Spotify rejected the session/.test(detail)))

      player.emit('initialization_error', { message: 'sdk init boom' })
      assert.ok(statuses.some((status) => status.kind === 'error' && /initialize/.test(status.message ?? '')))
      assert.ok(errors().some((detail) => /SDK failed to initialize/.test(detail)))

      player.emit('playback_error', { message: 'track missing' })
      assert.ok(errors().some((detail) => /Spotify could not play this track/.test(detail)))

      player.emit('autoplay_blocked', { message: 'blocked' })
      assert.ok(errors().some((detail) => /blocked automatic playback/.test(detail)))
    } finally {
      harness.dispose()
    }
  })

  it('play/pause/seek/volume route through SDK local controls', async () => {
    const harness = createHarness()
    try {
      harness.engine.setVolume(0.4)
      harness.engine.load(makeSpotifyTrack())
      await harness.engine.play()

      const player = harness.players[0]

      harness.engine.pause()
      assert.ok(player.calls.includes('pause'), 'pause uses the SDK local control')
      assert.equal(harness.engine.isPaused(), true)

      // Resuming a paused device-track uses the SDK resume control, not a new
      // Web API load.
      player.state = sdkState({ paused: true, position: 42_000 })
      await harness.engine.play()
      assert.ok(player.calls.includes('resume'), 'resume uses the SDK local control')
      assert.equal(harness.fetchCalls.length, 1, 'no second playback request')

      harness.engine.seekTo(30)
      assert.deepEqual(player.seekAppliedMs, [30_000])
      assert.equal(harness.engine.getTime(), 30, 'seek updates the synchronizable position')

      harness.engine.setVolume(0.9)
      assert.ok(player.volumeApplied.includes(0.9))
    } finally {
      harness.dispose()
    }
  })

  it('state changes synchronize playing/paused/time/duration', async () => {
    const harness = createHarness()
    try {
      harness.engine.load(makeSpotifyTrack())
      await harness.engine.play()

      const player = harness.players[0]
      player.emit('player_state_changed', sdkState({ paused: false, position: 1000, duration: 180_000 }))

      assert.equal(harness.events.playing, 1)
      assert.equal(harness.engine.isPaused(), false)
      assert.equal(harness.engine.getTime(), 1)
      assert.equal(harness.engine.getDuration(), 180)

      player.emit('player_state_changed', sdkState({ paused: true, position: 2000 }))
      assert.equal(harness.engine.isPaused(), true)
      assert.equal(harness.engine.getTime(), 2)
    } finally {
      harness.dispose()
    }
  })

  it('track end (paused near duration) advances the queue exactly once', async () => {
    const harness = createHarness()
    try {
      harness.engine.load(makeSpotifyTrack())
      await harness.engine.play()
      const player = harness.players[0]
      player.emit('player_state_changed', sdkState({ paused: false, position: 179_000 }))
      assert.equal(harness.events.playing, 1)

      player.emit('player_state_changed', sdkState({ paused: true, position: 179_900 }))
      assert.equal(harness.events.ended, 1)
      assert.equal(harness.engine.isEnded(), true)
      assert.equal(harness.engine.isPaused(), true)

      // A duplicate end-of-track state must not advance the queue twice.
      player.emit('player_state_changed', sdkState({ paused: true, position: 179_950 }))
      assert.equal(harness.events.ended, 1)
    } finally {
      harness.dispose()
    }
  })

  it('pausing without having played near the end does not fake an end event', async () => {
    const harness = createHarness()
    try {
      harness.engine.load(makeSpotifyTrack())
      await harness.engine.play()
      const player = harness.players[0]

      player.emit('player_state_changed', sdkState({ paused: true, position: 0 }))
      assert.equal(harness.events.ended, 0, 'a fresh loaded-but-unplayed track never reports ended')
      assert.ok(harness.events.paused >= 1)
      assert.equal(harness.engine.isEnded(), false)
    } finally {
      harness.dispose()
    }
  })

  it('switching tracks reloads the new URI and re-requests playback', async () => {
    const harness = createHarness()
    try {
      const firstTrack = makeSpotifyTrack()
      const secondTrack = makeSpotifyTrack({ providerTrackId: '4r63hUhfeJdcIOlcgDcKOg' })

      harness.engine.load(firstTrack)
      await harness.engine.play()
      const player = harness.players[0]

      harness.engine.load(secondTrack)
      assert.equal(harness.engine.currentSource(), 'spotify:track:4r63hUhfeJdcIOlcgDcKOg')
      assert.equal(harness.engine.isEnded(), false, 'switching revokes the ended latch')
      await harness.engine.play()

      const requests = harness.fetchCalls.map((call) => JSON.parse(String(call.init?.body)) as { uris: string[] })
      assert.deepEqual(requests, [
        { uris: [TRACK_URI], position_ms: 0 },
        { uris: ['spotify:track:4r63hUhfeJdcIOlcgDcKOg'], position_ms: 0 },
      ])

      // The new track must re-arm its own playback detection before ending.
      player.emit('player_state_changed', sdkState({ paused: true, position: 179_900 }))
      assert.equal(harness.events.ended, 0, 'old-track end state does not advance the new track')
    } finally {
      harness.dispose()
    }
  })

  it('Web API failures surface concise, actionable errors', async () => {
    // 403 — no permission / non-Premium.
    const forbiddenHarness = createHarness()
    try {
      forbiddenHarness.setResponseStatus(403)
      forbiddenHarness.engine.load(makeSpotifyTrack())
      await assert.rejects(async () => forbiddenHarness.engine.play(), /refused playback/)
      assert.ok(forbiddenHarness.statuses.some((status) => status.kind === 'error'))
    } finally {
      forbiddenHarness.dispose()
    }

    // 401 — exhausted/invalid session.
    const unauthorizedHarness = createHarness()
    try {
      unauthorizedHarness.setResponseStatus(401)
      unauthorizedHarness.engine.load(makeSpotifyTrack())
      await assert.rejects(async () => unauthorizedHarness.engine.play(), /no longer valid/)
      assert.ok(unauthorizedHarness.statuses.some((status) => status.kind === 'auth-error'))
    } finally {
      unauthorizedHarness.dispose()
    }

    // Network failure.
    const networkHarness = createHarness()
    try {
      networkHarness.failNetwork(true)
      networkHarness.engine.load(makeSpotifyTrack())
      await assert.rejects(async () => networkHarness.engine.play(), /Could not reach Spotify/)
      assert.ok(networkHarness.statuses.some((status) => status.kind === 'error'))
    } finally {
      networkHarness.dispose()
    }

    // Rate limiting.
    const rateHarness = createHarness()
    try {
      rateHarness.setResponseStatus(429)
      rateHarness.engine.load(makeSpotifyTrack())
      await assert.rejects(async () => rateHarness.engine.play(), /rate limit/i)
    } finally {
      rateHarness.dispose()
    }
  })

  it('play() without a loaded track rejects without any Web API call', async () => {
    const harness = createHarness()
    try {
      await assert.rejects(async () => harness.engine.play(), /no track loaded/)
      assert.equal(harness.fetchCalls.length, 0)
      assert.equal(harness.tokenRequests, 0, 'no token is requested for nothing to play')
    } finally {
      harness.dispose()
    }
  })

  it('dispose(): disconnects the device, detaches listeners and blocks further use', async () => {
    const harness = createHarness()
    try {
      harness.engine.load(makeSpotifyTrack())
      await harness.engine.play()

      const player = harness.players[0]
      harness.engine.dispose()

      assert.equal(player.disconnected, true)
      assert.equal(player.listenerCount('ready'), 0)
      assert.equal(player.listenerCount('player_state_changed'), 0)
      assert.equal(player.listenerCount('account_error'), 0)

      // Re-assignment after dispose is refused, later state events are inert.
      assert.throws(() => harness.engine.load(makeSpotifyTrack()), /disposed/)
      player.emit('player_state_changed', sdkState({ paused: false, position: 5_000 }))
      assert.equal(harness.events.playing, 0, 'no events after dispose')
      await assert.rejects(async () => harness.engine.play(), /disposed/)
    } finally {
      harness.dispose()
    }
  })

  it('remounts do not leave duplicate players connected', async () => {
    const firstHarness = createHarness()
    try {
      firstHarness.engine.load(makeSpotifyTrack())
      await firstHarness.engine.play()
      assert.equal(firstHarness.players.length, 1)

      const firstPlayer = firstHarness.players[0]
      firstHarness.engine.dispose()
      assert.equal(firstPlayer.disconnected, true)

      // React StrictMode remount creates a fresh provider engine instance.
      const secondHarness = createHarness()
      try {
        secondHarness.engine.load(makeSpotifyTrack())
        await secondHarness.engine.play()
        assert.equal(secondHarness.players.length, 1, 'a fresh mount owns exactly one player')
        assert.notEqual(secondHarness.players[0], firstPlayer)
        assert.equal(secondHarness.players[0].disconnected, false)
      } finally {
        secondHarness.dispose()
      }
    } finally {
      firstHarness.dispose()
    }
  })
})
