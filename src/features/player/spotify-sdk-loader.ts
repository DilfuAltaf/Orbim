/**
 * Singleton loader for the official Spotify Web Playback SDK script.
 *
 * Guarantees:
 * - The script tag is created at most once, even under concurrent calls or
 *   React Strict Mode double-mounts (a resolved module-level promise caches
 *   the load result).
 * - An existing unrelated `window.onSpotifyWebPlaybackSDKReady` callback is
 *   preserved and invoked after ours.
 * - If the script fails to load, the global promise is cleared so a later
 *   initialization can retry, and no player state was touched.
 *
 * The SDK itself must never be instantiated here — engine code owns that.
 */

export const SPOTIFY_SDK_URL = 'https://sdk.scdn.co/spotify-player.js'
const SPOTIFY_SDK_SCRIPT_ID = 'orbim-spotify-web-playback-sdk'

/**
 * Minimal accurate local declarations for the parts of the Web Playback SDK
 * the Spotify engine actually uses. Only shapes documented by Spotify are
 * declared — no invented capability.
 */
export interface SpotifySdkWebPlaybackState {
  context: { uri: string | null; metadata?: unknown } | null
  disallows?: { pausing?: boolean; seeking?: boolean }
  position: number
  duration: number
  paused: boolean
  repeat_mode: number
  shuffle: boolean
  track_window: {
    current_track: SdkTrack
    previous_tracks: SdkTrack[]
    next_tracks: SdkTrack[]
  }
}

export interface SdkTrack {
  id: string | null
  uri: string
  name: string
}

export interface SpotifySdkErrorEvent {
  message: string
}

export interface SpotifySdkReadyEvent {
  device_id: string
}

export interface SpotifySdkNotReadyEvent {
  device_id: string
}

/** Official SDK events mapped to their documented payload shapes. */
export interface SpotifySdkEventPayloadMap {
  ready: SpotifySdkReadyEvent
  not_ready: SpotifySdkNotReadyEvent
  player_state_changed: SpotifySdkWebPlaybackState
  initialization_error: SpotifySdkErrorEvent
  authentication_error: SpotifySdkErrorEvent
  account_error: SpotifySdkErrorEvent
  playback_error: SpotifySdkErrorEvent
  autoplay_blocked: SpotifySdkErrorEvent
}

export type SpotifySdkPlaybackEvent = keyof SpotifySdkEventPayloadMap

export interface SpotifySdkPlayer {
  connect(): Promise<boolean>
  disconnect(): void
  addListener<T extends SpotifySdkPlaybackEvent>(
    event: T,
    listener: (payload: SpotifySdkEventPayloadMap[T]) => void,
  ): boolean
  removeListener<T extends SpotifySdkPlaybackEvent>(
    event: T,
    listener?: (payload: SpotifySdkEventPayloadMap[T]) => void,
  ): boolean
  pause(): Promise<void>
  resume(): Promise<void>
  seek(positionMs: number): Promise<void>
  setVolume(volume: number): Promise<void>
  activateElement(): HTMLElement | undefined
  getCurrentState(): SpotifySdkWebPlaybackState | null
}

export interface SpotifySdkGlobal {
  Player: new (options: {
    name: string
    getOAuthToken: (callback: (token: string) => void) => void
    volume?: number
  }) => SpotifySdkPlayer
}

interface SpotifyWindow extends Window {
  Spotify?: SpotifySdkGlobal
  onSpotifyWebPlaybackSDKReady?: (() => void) | undefined
}

let sdkLoadPromise: Promise<SpotifySdkGlobal> | null = null

/**
 * Clears the module-level load cache (for testing only).
 */
export function _resetSpotifySdkLoaderForTesting(): void {
  sdkLoadPromise = null
}

function getSpotifyWindow(): SpotifyWindow | null {
  if (typeof window === 'undefined') return null
  return window as SpotifyWindow
}

/**
 * Loads (or returns the already loaded) Spotify Web Playback SDK global.
 * Resolves with the SDK namespace once the script is ready.
 */
export function loadSpotifySdk(): Promise<SpotifySdkGlobal> {
  if (sdkLoadPromise) return sdkLoadPromise

  const spotifyWindow = getSpotifyWindow()
  if (!spotifyWindow) {
    return Promise.reject(new Error('Spotify SDK requires a browser environment.'))
  }

  if (spotifyWindow.Spotify) {
    sdkLoadPromise = Promise.resolve(spotifyWindow.Spotify)
    return sdkLoadPromise
  }

  const loadPromise = createSdkLoadPromise(spotifyWindow)
  // On failure clear the cache so a later initialization can retry.
  sdkLoadPromise = loadPromise.catch((error: unknown) => {
    sdkLoadPromise = null
    throw error
  })

  return sdkLoadPromise
}

function createSdkLoadPromise(spotifyWindow: SpotifyWindow): Promise<SpotifySdkGlobal> {
  return new Promise<SpotifySdkGlobal>((resolve, reject) => {
    const documentRef = typeof document === 'undefined' ? null : document
    if (!documentRef) {
      reject(new Error('Spotify SDK requires a browser document.'))
      return
    }

    const previousReadyCallback = spotifyWindow.onSpotifyWebPlaybackSDKReady

    spotifyWindow.onSpotifyWebPlaybackSDKReady = () => {
      // Preserve an unrelated pre-existing callback instead of overwriting it.
      if (typeof previousReadyCallback === 'function') {
        try {
          previousReadyCallback()
        } catch {
          // A third-party callback failure must not break SDK loading.
        }
      }
      if (spotifyWindow.Spotify) {
        resolve(spotifyWindow.Spotify)
      } else {
        reject(new Error('Spotify SDK loaded but the global namespace is missing.'))
      }
    }

    const existingScript = documentRef.getElementById(SPOTIFY_SDK_SCRIPT_ID)
    const script = (existingScript ?? documentRef.createElement('script')) as HTMLScriptElement

    script.onerror = () => {
      reject(new Error('Failed to load the Spotify Web Playback SDK script.'))
    }

    if (!existingScript) {
      script.id = SPOTIFY_SDK_SCRIPT_ID
      script.src = SPOTIFY_SDK_URL
      script.async = true
      documentRef.head.appendChild(script)
    }
    // When the tag already exists we rely on its onSpotifyWebPlaybackSDKReady
    // hook resolving the shared promise.
  })
}
