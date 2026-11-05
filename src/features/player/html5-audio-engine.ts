import type { MusicTrack } from '../../types/music.ts'
import { resolveStoragePublicUrl } from '../../services/audio/audio-storage.ts'
import type { PlaybackEngine, PlaybackEngineEvents } from './playback-engine.ts'

function redactUrl(url: string | null | undefined): string {
  if (!url) return 'none'
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
    const parsed = new URL(url, origin)
    const sensitive = ['token', 'signature', 'sig', 'key', 'apikey', 'api_key', 'secret', 'auth', 'access_token']
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (sensitive.some((s) => key.toLowerCase().includes(s))) {
        parsed.searchParams.set(key, '[REDACTED]')
      }
    }
    return parsed.toString()
  } catch {
    return '[INVALID_URL]'
  }
}

/**
 * HTML5 `<audio>` playback engine.
 *
 * Behavior is extracted from PlayerProvider: source swap + rewind, event mapping,
 * error detail formatting, cleanup on dispose. It knows nothing about ORBIM's queue,
 * player state or demo mode — PlayerProvider keeps owning all of that.
 *
 * Sourcing safety: `load` accepts only a track carrying a concrete audio URL.
 * `selectTrackPlayback` (called by PlayerProvider before any load) is the gate
 * that keeps metadata-only tracks — including Spotify records — from reaching
 * this engine, so no fabricated URL can ever be played.
 */
export class Html5AudioEngine implements PlaybackEngine {
  static readonly id = 'html5-audio' as const
  readonly id = 'html5-audio'

  private audio: HTMLAudioElement
  private events: PlaybackEngineEvents
  private listeners: Array<[string, EventListenerOrEventListenerObject]> = []
  private disposed = false
  private isSwitchingSource = false
  private hasPlayedCurrentSource = false
  private currentTrackId: string | null = null
  private loadedUrl: string | null = null
  private playPromise: Promise<void> | null = null

  constructor(options: { audio?: HTMLAudioElement; events: PlaybackEngineEvents }) {
    this.audio = options.audio ?? new Audio()
    this.audio.preload = 'metadata'
    this.events = options.events

    const attach = (type: string, handler: (event: Event) => void) => {
      this.audio.addEventListener(type, handler)
      this.listeners.push([type, handler])
    }

    attach('loadstart', () => {
      this.logDiagnostic('loadstart')
    })
    attach('loadedmetadata', () => {
      this.logDiagnostic('loadedmetadata')
    })
    attach('loadeddata', () => {
      this.logDiagnostic('loadeddata')
    })
    attach('canplay', () => {
      this.logDiagnostic('canplay')
    })
    attach('timeupdate', () => {
      if (!this.audio.paused && !Number.isNaN(this.audio.currentTime)) {
        this.events.onTime(Math.floor(this.audio.currentTime))
      }
    })
    attach('waiting', () => {
      this.logDiagnostic('waiting')
      this.events.onWaiting()
    })
    attach('play', () => {
      this.logDiagnostic('play')
    })
    attach('playing', () => {
      this.isSwitchingSource = false
      this.hasPlayedCurrentSource = true
      this.logDiagnostic('playing')
      this.events.onPlaying()
    })
    attach('pause', () => {
      this.logDiagnostic('pause')
      if (this.isSwitchingSource || this.playPromise !== null || !this.hasPlayedCurrentSource) {
        return
      }
      this.events.onPause()
    })
    attach('ended', () => {
      this.logDiagnostic('ended')
      this.events.onEnded()
    })
    attach('error', () => {
      this.isSwitchingSource = false
      this.logDiagnostic('error')
      this.audioErrorOccurred()
    })

    this.audio.volume = 1
  }

  private logDiagnostic(event: string, extra?: Record<string, unknown>): void {
    if (typeof console === 'undefined' || !console.debug) return
    const err = this.audio.error
    console.debug(`[Html5AudioEngine:${event}]`, {
      timestamp: new Date().toISOString(),
      trackId: this.currentTrackId ?? 'none',
      loadedUrl: redactUrl(this.loadedUrl),
      currentSrc: redactUrl(this.audio.currentSrc || this.audio.src),
      paused: this.audio.paused,
      readyState: this.audio.readyState ?? 0,
      networkState: this.audio.networkState ?? 0,
      duration: this.audio.duration,
      currentTime: this.audio.currentTime,
      error: err ? { code: err.code, message: err.message } : null,
      ...extra,
    })
  }

  private locationHref(): string | null {
    if (typeof window === 'undefined') return null
    return window.location.href
  }

  private audioErrorOccurred(): void {
    if (!this.audio.src || this.audio.src === this.locationHref()) return

    const audioError = this.audio.error
    if (audioError?.code === 1) return // MEDIA_ERR_ABORTED: transient interruption, not a stream failure

    const detail = audioError
      ? `Code ${audioError.code}: ${audioError.message || 'Stream error'}`
      : 'Network or decoding error'

    this.events.onError(detail)
  }

  getDuration(): number {
    const duration = this.audio.duration
    return Number.isFinite(duration) ? duration : 0
  }

  getTime(): number {
    const time = this.audio.currentTime
    return Number.isNaN(time) ? 0 : time
  }

  isPaused(): boolean {
    return this.audio.paused && this.playPromise === null
  }

  isEnded(): boolean {
    return this.audio.ended
  }

  hasSource(): boolean {
    return Boolean(this.audio.src) && this.audio.src !== this.locationHref()
  }

  currentSource(): string | null {
    return this.hasSource() ? (this.loadedUrl || this.audio.src) : null
  }

  load(track: MusicTrack): void {
    const sourceUrl =
      track.playbackUrl ||
      track.audioSourceUrl ||
      (track.storagePath ? resolveStoragePublicUrl(track.storagePath) : undefined)
    if (typeof sourceUrl !== 'string' || sourceUrl.trim().length === 0) {
      throw new Error('Refusing to load a track without a concrete audio URL.')
    }

    this.currentTrackId = track.id || track.providerTrackId
    this.loadedUrl = sourceUrl
    this.isSwitchingSource = true
    this.hasPlayedCurrentSource = false
    this.playPromise = null
    this.audio.src = sourceUrl
    this.audio.currentTime = 0
    this.logDiagnostic('load')
  }

  clear(): void {
    this.logDiagnostic('clear')
    this.loadedUrl = null
    this.currentTrackId = null
    this.hasPlayedCurrentSource = false
    this.isSwitchingSource = false
    this.playPromise = null
    if (!this.hasSource()) return

    this.audio.pause()
    this.audio.removeAttribute('src')
    this.audio.load()
  }

  play(): Promise<void> {
    if (!this.hasSource()) {
      return Promise.reject(new Error('Html5AudioEngine: no audio source loaded.'))
    }

    if (!this.audio.paused) {
      return Promise.resolve()
    }

    if (this.playPromise) {
      return this.playPromise
    }

    this.logDiagnostic('play_call')
    const promise = this.audio.play()
    if (!promise || typeof promise.then !== 'function') {
      this.playPromise = null
      return Promise.resolve()
    }

    this.playPromise = promise
      .then(() => {
        this.logDiagnostic('play_resolved')
        this.playPromise = null
      })
      .catch((err: unknown) => {
        this.logDiagnostic('play_rejected', {
          error: err instanceof Error ? err.message : String(err),
          name: err instanceof Error ? err.name : undefined,
        })
        this.playPromise = null
        if (
          (err instanceof DOMException && err.name === 'AbortError') ||
          (err instanceof Error && err.name === 'AbortError')
        ) {
          return
        }
        throw err
      })

    return this.playPromise
  }

  pause(): void {
    this.logDiagnostic('pause_call')
    this.isSwitchingSource = false
    if (this.playPromise) {
      this.playPromise
        .then(() => {
          if (!this.audio.paused) {
            this.audio.pause()
          }
        })
        .catch(() => {})
      return
    }

    if (!this.audio.paused) {
      this.audio.pause()
    }
  }

  seekTo(seconds: number): void {
    this.audio.currentTime = Math.max(0, seconds)
  }

  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) return

    const clamped = Math.min(Math.max(volume, 0), 1)
    this.audio.volume = clamped
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.loadedUrl = null
    this.currentTrackId = null
    this.hasPlayedCurrentSource = false
    this.isSwitchingSource = false
    this.playPromise = null

    for (const [type, handler] of this.listeners) {
      this.audio.removeEventListener(type, handler)
    }
    this.listeners = []

    this.audio.pause()
    this.audio.removeAttribute('src')
    this.audio.load()
  }
}
