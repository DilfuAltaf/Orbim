import type { MusicTrack } from '../../types/music.ts'
import type { PlaybackEngine, PlaybackEngineEvents } from './playback-engine.ts'
import { hasValidSpotifyTrackId } from './playback-engine.ts'
import { loadSpotifySdk } from './spotify-sdk-loader.ts'
import type {
  SpotifySdkEventPayloadMap,
  SpotifySdkGlobal,
  SpotifySdkPlaybackEvent,
  SpotifySdkPlayer,
} from './spotify-sdk-loader.ts'
import { SPOTIFY_API_BASE_URL } from '../../services/spotify/config.ts'

/**
 * Spotify Web Playback SDK engine.
 *
 * Plays Spotify tracks inside ORBIM via the user's own Spotify session through
 * the official SDK loaded from `https://sdk.scdn.co/spotify-player.js`:
 * - Track identity is derived strictly from the track id (`spotify:track:<id>`);
 *   no audio URL is ever manufactured.
 * - Pause/resume/seek/volume use SDK-local controls. Loading a specific track
 *   onto our SDK device requires the Web API `POST /v1/me/player/play`
 *   endpoint, which needs the `user-modify-playback-state` scope.
 * - Access tokens are obtained through the injected token provider and are
 *   only ever passed to the SDK's getOAuthToken callback or the Web API
 *   Authorization header — they are never stored or logged here.
 *
 * The engine knows nothing about ORBIM's queue — PlayerProvider keeps owning
 * it. Lifecycle is React-Strict-Mode-safe: construction is cheap and does no
 * SDK work; the real connect happens lazily inside the first play request
 * (activated through a user gesture), and dispose detaches listeners and
 * disconnects the player.
 */

export type SpotifyEngineStatusKind =
  | 'idle'
  | 'connecting'
  | 'device-ready'
  | 'device-not-ready'
  | 'reconnect-required'
  | 'premium-required'
  | 'auth-error'
  | 'error'

export interface SpotifyEngineStatus {
  kind: SpotifyEngineStatusKind
  /** Concise, user-facing message. Never contains tokens or raw payloads. */
  message: string | null
}

export interface SpotifyEngineOptions {
  events: PlaybackEngineEvents
  onStatus: (status: SpotifyEngineStatus) => void
  /** Resolves a fresh access token, or null when no usable session exists. */
  getToken: () => Promise<string | null>
  /** Device name shown inside the user's Spotify clients. */
  playerName?: string
  /** Injectable for tests; defaults to global fetch. */
  fetchFn?: typeof fetch
  /** Injectable for tests; defaults to `new sdk.Player(...)`. */
  createPlayer?: (
    sdk: SpotifySdkGlobal,
    options: {
      name: string
      volume: number
      getOAuthToken: (callback: (token: string) => void) => void
    },
  ) => SpotifySdkPlayer
  /** Injectable for tests: device-ready timeout (ms), default 10 000. */
  deviceReadyTimeoutMs?: number
  /** Injectable for tests: position-poll interval (ms), default 1 000. */
  positionPollIntervalMs?: number
}

export interface SpotifySdkPlayerConstructorOptions {
  name: string
  volume: number
  getOAuthToken: (callback: (token: string) => void) => void
}

const DEFAULT_DEVICE_READY_TIMEOUT_MS = 10_000
const DEFAULT_POSITION_POLL_INTERVAL_MS = 1000
const END_DETECTION_TOLERANCE_MS = 1000

export class SpotifyWebPlaybackEngine implements PlaybackEngine {
  static readonly id = 'spotify-sdk' as const
  readonly id = 'spotify-sdk'

  private readonly events: PlaybackEngineEvents
  private readonly onStatus: (status: SpotifyEngineStatus) => void
  private readonly getToken: () => Promise<string | null>
  private readonly fetchFn: typeof fetch
  private readonly createPlayerOption: SpotifyEngineOptions['createPlayer']
  private readonly playerName: string

  private player: SpotifySdkPlayer | null = null
  private sdkPromise: Promise<SpotifySdkGlobal> | null = null
  private deviceId: string | null = null
  private initialized = false

  private readonly deviceReadyTimeoutMs: number
  private readonly positionPollIntervalMs: number

  private currentUri: string | null = null
  private positionMs = 0
  private durationMs = 0
  private paused = true
  private endedFlag = false
  private sawPlaybackForUri = false

  private pendingVolume = 1
  private statePollInterval: ReturnType<typeof setInterval> | null = null
  private deviceWaiters: Array<{ resolve: () => void; reject: (error: Error) => void }> = []
  private playChain: Promise<void> = Promise.resolve()
  private disposed = false

  private static readonly SDK_EVENTS: SpotifySdkPlaybackEvent[] = [
    'ready',
    'not_ready',
    'player_state_changed',
    'initialization_error',
    'authentication_error',
    'account_error',
    'playback_error',
    'autoplay_blocked',
  ]

  constructor(options: SpotifyEngineOptions) {
    this.events = options.events
    this.onStatus = options.onStatus
    this.getToken = options.getToken
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis)
    this.createPlayerOption = options.createPlayer
    this.playerName = options.playerName ?? 'ORBIM Web Player'
    this.deviceReadyTimeoutMs = options.deviceReadyTimeoutMs ?? DEFAULT_DEVICE_READY_TIMEOUT_MS
    this.positionPollIntervalMs =
      options.positionPollIntervalMs ?? DEFAULT_POSITION_POLL_INTERVAL_MS
  }

  // -- Contract ------------------------------------------------------------

  getDuration(): number {
    const seconds = this.durationMs / 1000
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  }

  getTime(): number {
    const seconds = Math.floor(this.positionMs / 1000)
    return seconds > 0 ? seconds : 0
  }

  isPaused(): boolean {
    return this.paused
  }

  isEnded(): boolean {
    return this.endedFlag
  }

  hasSource(): boolean {
    return this.currentUri !== null
  }

  currentSource(): string | null {
    return this.currentUri
  }

  load(track: MusicTrack): void {
    if (track.provider !== 'spotify') {
      throw new Error('SpotifyWebPlaybackEngine refuses to load non-Spotify tracks.')
    }

    if (!hasValidSpotifyTrackId(track)) {
      throw new Error('SpotifyWebPlaybackEngine refuses a missing or malformed Spotify track id.')
    }

    if (this.disposed) {
      throw new Error('SpotifyWebPlaybackEngine has been disposed.')
    }

    this.currentUri = `spotify:track:${track.providerTrackId}`
    // Provisional duration from catalog metadata; the SDK state refines it.
    this.durationMs = track.durationSeconds > 0 ? Math.round(track.durationSeconds * 1000) : 0
    this.positionMs = 0
    this.paused = true
    this.endedFlag = false
    this.sawPlaybackForUri = false
  }

  clear(): void {
    if (this.player && !this.paused) {
      try {
        void this.player.pause()
      } catch {
        // Disconnection during clear is fine; the device keeps its own state.
      }
    }

    this.currentUri = null
    this.positionMs = 0
    this.durationMs = 0
    this.paused = true
    this.endedFlag = false
    this.sawPlaybackForUri = false
  }

  play(): Promise<void> {
    if (this.disposed) {
      return Promise.reject(new Error('SpotifyWebPlaybackEngine has been disposed.'))
    }

    if (!this.currentUri) {
      return Promise.reject(new Error('SpotifyWebPlaybackEngine: no track loaded.'))
    }

    // Serialize play requests so rapid toggles/track switches cannot race.
    const request = this.playChain.then(() => this.startPlayback())
    this.playChain = request.catch(() => undefined)

    return request
  }

  pause(): void {
    this.paused = true
    this.positionMs = this.player?.getCurrentState()?.position ?? 0

    if (this.player) {
      try {
        void this.player.pause()
      } catch {
        // Best effort: the SDK reports connection errors through its events.
      }
    }
  }

  seekTo(seconds: number): void {
    const targetMs = Math.max(0, Math.round(seconds * 1000))
    this.positionMs = targetMs

    // Seeking away from the end revokes the ended latch, mirroring HTML5.
    if (this.durationMs > 0 && targetMs < this.durationMs - END_DETECTION_TOLERANCE_MS) {
      this.endedFlag = false
    }

    if (this.player && this.deviceId) {
      try {
        void this.player.seek(targetMs)
      } catch {
        // Best effort; SDK errors arrive through playback_error events.
      }
    }
  }

  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) return

    const clamped = Math.min(Math.max(volume, 0), 1)
    this.pendingVolume = clamped

    try {
      void this.player?.setVolume(clamped)
    } catch {
      // A not-yet-connected player stores the value and applies it on connect.
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true

    if (this.statePollInterval) {
      clearInterval(this.statePollInterval)
      this.statePollInterval = null
    }

    for (const waiter of this.deviceWaiters) {
      waiter.reject(new Error('SpotifyWebPlaybackEngine has been disposed.'))
    }
    this.deviceWaiters = []

    if (this.player) {
      for (const event of SpotifyWebPlaybackEngine.SDK_EVENTS) {
        try {
          // Listener callbacks are bound arrow functions created in
          // registerSdkListeners; removeListener with no listener clears all.
          this.player.removeListener(event)
        } catch {
          // Ignore — the player may already be unusable.
        }
      }
      try {
        this.player.disconnect()
      } catch {
        // Ignore.
      }
      this.player = null
    }

    this.initialized = false
    this.deviceId = null
    this.currentUri = null
  }

  // -- Lifecycle -----------------------------------------------------------

  private publishStatus(kind: SpotifyEngineStatusKind, message: string | null = null): void {
    if (this.disposed) return
    this.onStatus({ kind, message })
  }

  private failWith(message: string): Error {
    this.publishStatus('error', message)
    return new Error(message)
  }

  private createSdkPlayer(sdk: SpotifySdkGlobal): SpotifySdkPlayer {
    const playerOptions: SpotifySdkPlayerConstructorOptions = {
      name: this.playerName,
      volume: this.pendingVolume,
      getOAuthToken: (callback: (token: string) => void) => {
        this.getToken()
          .then((token) => {
            if (token) {
              callback(token)
            } else {
              this.handleSessionUnavailable()
            }
          })
          .catch(() => {
            this.handleSessionUnavailable()
          })
      },
    }

    if (this.createPlayerOption) {
      return this.createPlayerOption(sdk, playerOptions)
    }

    return new sdk.Player(playerOptions)
  }

  private handleSessionUnavailable(): void {
    const message =
      'Spotify session is no longer valid. Reconnect Spotify from Settings to resume playback.'
    this.publishStatus('auth-error', message)
    this.events.onError(message)
  }

  private async ensureConnected(): Promise<void> {
    if (this.disposed) {
      throw new Error('SpotifyWebPlaybackEngine has been disposed.')
    }

    if (this.initialized && this.player) return

    this.publishStatus('connecting')

    const sdk = this.sdkPromise ?? loadSpotifySdk()
    this.sdkPromise = sdk

    const sdkGlobal = await sdk
    if (this.disposed) return

    if (!this.player) {
      this.player = this.createSdkPlayer(sdkGlobal)
      this.registerSdkListeners(this.player)
    }

    const connected = await this.player.connect()
    if (this.disposed) return

    if (!connected) {
      throw this.failWith('Could not connect the Spotify playback device. Try again shortly.')
    }

    this.initialized = true
  }

  private registerSdkListeners(player: SpotifySdkPlayer): void {
    player.addListener('ready', (payload) => {
      this.deviceId = payload.device_id
      this.publishStatus('device-ready')
      this.resolveDeviceWaiters()
    })

    player.addListener('not_ready', () => {
      this.deviceId = null
      this.publishStatus(
        'device-not-ready',
        'The Spotify playback device went offline. Try again shortly.',
      )
    })

    player.addListener('player_state_changed', (state) => {
      this.handlePlayerStateChanged(state)
    })

    player.addListener('initialization_error', (payload) => {
      this.initialized = false
      this.player = null
      this.publishStatus('error', `Spotify SDK failed to initialize. (${payload.message})`)
      this.events.onError(`Spotify SDK failed to initialize. (${payload.message})`)
    })

    player.addListener('authentication_error', (payload) => {
      this.publishStatus('auth-error', 'Spotify rejected the session. Reconnect Spotify from Settings.')
      this.events.onError(`Spotify rejected the session. (${payload.message})`)
    })

    player.addListener('account_error', () => {
      const message = 'In-app Spotify playback requires a Spotify Premium account.'
      this.publishStatus('premium-required', message)
      this.events.onError(message)
    })

    player.addListener('playback_error', (payload) => {
      this.events.onError(`Spotify could not play this track. (${payload.message})`)
    })

    player.addListener('autoplay_blocked', () => {
      const message = 'The browser blocked automatic playback. Press play again.'
      this.publishStatus('error', message)
      this.events.onError(message)
    })
  }

  private resolveDeviceWaiters(): void {
    for (const waiter of this.deviceWaiters) {
      waiter.resolve()
    }
    this.deviceWaiters = []
  }

  private async waitForDeviceReady(): Promise<void> {
    if (this.deviceId) return
    if (this.disposed) {
      throw new Error('SpotifyWebPlaybackEngine has been disposed.')
    }

    await new Promise<void>((resolve, reject) => {
      const waiter = { resolve, reject }
      this.deviceWaiters.push(waiter)

      setTimeout(() => {
        const index = this.deviceWaiters.indexOf(waiter)
        if (index >= 0) {
          this.deviceWaiters.splice(index, 1)
          reject(
            new Error(
              'The Spotify playback device is not ready yet. Try again in a few seconds.',
            ),
          )
          this.publishStatus(
            'device-not-ready',
            'The Spotify playback device is not ready yet. Try again in a few seconds.',
          )
        }
      }, this.deviceReadyTimeoutMs)
    })
  }

  private async startPlayback(): Promise<void> {
    const uri = this.currentUri
    if (!uri) {
      throw new Error('SpotifyWebPlaybackEngine: no track loaded.')
    }

    await this.ensureConnected()
    if (this.disposed) return

    await this.waitForDeviceReady()
    if (this.disposed) return

    // Respect browser autoplay rules by activating the element inside the
    // user-gesture-initiated task where the browser allows it (Safari).
    try {
      this.player?.activateElement()
    } catch {
      // Chrome-based browsers return undefined; activation is optional there.
    }

    const state = this.player?.getCurrentState() ?? null
    const currentDeviceTrack = state?.track_window?.current_track?.uri ?? null

    if (state && state.paused && currentDeviceTrack === uri && state.position > 0) {
      // Local control: the device already has this track paused mid-play.
      await this.player?.resume()
      this.positionMs = state.position
      this.startPositionPolling()
      return
    }

    await this.playTrackOnDevice(uri)
    this.startPositionPolling()
  }

  private async playTrackOnDevice(uri: string): Promise<void> {
    let token: string | null
    try {
      token = await this.getToken()
    } catch {
      // Refresh failure, revoked session, missing client id — all surface as
      // an unusable Spotify session prompting reconnection.
      throw this.handleSessionUnavailableError()
    }
    if (this.disposed) return

    if (!token) {
      throw this.handleSessionUnavailableError()
    }

    const device = this.deviceId
    if (!device) {
      throw this.failWith(
        'The Spotify playback device is not ready yet. Try again in a few seconds.',
      )
    }

    let response: Response
    try {
      response = await this.fetchFn(
        `${SPOTIFY_API_BASE_URL}/me/player/play?device_id=${encodeURIComponent(device)}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            uris: [uri],
            position_ms: Math.max(0, this.positionMs),
          }),
        },
      )
    } catch {
      throw this.failWith('Could not reach Spotify to start playback. Check your connection.')
    }

    if (response.status === 200 || response.status === 204) return

    if (response.status === 401) {
      throw this.handleSessionUnavailableError()
    }

    if (response.status === 403) {
      throw this.failWith(
        'Spotify refused playback. Premium account and granted playback permissions are required.',
      )
    }

    if (response.status === 404) {
      throw this.failWith('Spotify device is no longer available. Try again shortly.')
    }

    if (response.status === 429) {
      throw this.failWith('Spotify rate limit reached. Try again in a moment.')
    }

    throw this.failWith(`Spotify playback request failed (HTTP ${response.status}).`)
  }

  private handleSessionUnavailableError(): Error {
    const message =
      'Spotify session is no longer valid. Reconnect Spotify from Settings to resume playback.'
    this.publishStatus('auth-error', message)
    return new Error(message)
  }

  private startPositionPolling(): void {
    if (this.statePollInterval || this.disposed) return

    this.statePollInterval = setInterval(() => {
      if (this.disposed || this.paused) {
        this.stopPositionPolling()
        return
      }

      try {
        const state = this.player?.getCurrentState() ?? null
        if (!state) return

        this.positionMs = state.position
        if (state.duration > 0) {
          this.durationMs = state.duration
        }

        if (!state.paused) {
          this.events.onTime(Math.floor(state.position / 1000))
        } else {
          this.stopPositionPolling()
        }
      } catch {
        // The device may disconnect mid-poll; SDK events handle that case.
      }
    }, this.positionPollIntervalMs)
  }

  private stopPositionPolling(): void {
    if (this.statePollInterval) {
      clearInterval(this.statePollInterval)
      this.statePollInterval = null
    }
  }

  private handlePlayerStateChanged(state: SpotifySdkEventPayloadMap['player_state_changed']): void {
    if (this.disposed) return

    this.positionMs = state.position
    this.paused = state.paused

    if (state.duration > 0) {
      this.durationMs = state.duration
    }

    const deviceTrackUri = state.track_window?.current_track?.uri ?? null
    const playingOurTrack = !deviceTrackUri || deviceTrackUri === this.currentUri

    if (!state.paused && playingOurTrack) {
      if (deviceTrackUri === this.currentUri) {
        this.sawPlaybackForUri = true
      }
      this.events.onPlaying()
      this.startPositionPolling()
      return
    }

    if (state.paused && playingOurTrack) {
      this.stopPositionPolling()

      if (!this.endedFlag && this.hasEnded(state)) {
        this.endedFlag = true
        this.events.onEnded()
        return
      }

      this.events.onPause()
    }
  }

  private hasEnded(state: SpotifySdkEventPayloadMap['player_state_changed']): boolean {
    if (!this.sawPlaybackForUri) return false
    if (this.durationMs <= 0) return false

    return state.position > 0 && state.position >= this.durationMs - END_DETECTION_TOLERANCE_MS
  }
}
