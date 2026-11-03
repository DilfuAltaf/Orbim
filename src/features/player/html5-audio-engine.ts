import type { MusicTrack } from '../../types/music.ts'
import { resolveStoragePublicUrl } from '../../services/audio/audio-storage.ts'
import type { PlaybackEngine, PlaybackEngineEvents } from './playback-engine.ts'

/**
 * HTML5 `<audio>` playback engine.
 *
 * Behavior is extracted verbatim from PlayerProvider's previous inline audio
 * handling: source swap + rewind, event mapping, error detail formatting,
 * cleanup on dispose. It knows nothing about ORBIM's queue, player state or
 * demo mode — PlayerProvider keeps owning all of that.
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

    attach('timeupdate', () => {
      if (!this.audio.paused && !Number.isNaN(this.audio.currentTime)) {
        this.events.onTime(Math.floor(this.audio.currentTime))
      }
    })
    attach('waiting', () => {
      this.events.onWaiting()
    })
    attach('playing', () => {
      this.isSwitchingSource = false
      this.events.onPlaying()
    })
    attach('canplay', () => {
      this.isSwitchingSource = false
    })
    attach('loadeddata', () => {
      this.isSwitchingSource = false
    })
    attach('pause', () => {
      if (this.isSwitchingSource || this.playPromise !== null) {
        return
      }
      this.events.onPause()
    })
    attach('ended', () => {
      this.events.onEnded()
    })
    attach('error', () => {
      this.isSwitchingSource = false
      this.audioErrorOccurred()
    })

    this.audio.volume = 1
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
    return this.audio.paused
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

    this.loadedUrl = sourceUrl
    this.isSwitchingSource = true
    this.playPromise = null
    this.audio.src = sourceUrl
    this.audio.currentTime = 0
    setTimeout(() => {
      this.isSwitchingSource = false
    }, 300)
  }

  clear(): void {
    this.loadedUrl = null
    this.playPromise = null
    if (!this.hasSource()) return

    this.audio.pause()
    this.audio.removeAttribute('src')
    this.audio.load()
  }

  play(): Promise<void> {
    if (!this.hasSource()) {
      // Mirrors native media element behavior: play() without a usable source
      // rejects instead of crashing the caller.
      return Promise.reject(new Error('Html5AudioEngine: no audio source loaded.'))
    }

    if (!this.audio.paused) {
      return Promise.resolve()
    }

    if (this.playPromise) {
      return this.playPromise
    }

    const promise = this.audio.play()
    if (!promise || typeof promise.then !== 'function') {
      this.playPromise = null
      return Promise.resolve()
    }

    this.playPromise = promise
      .then(() => {
        this.playPromise = null
      })
      .catch((err: unknown) => {
        this.playPromise = null
        if (
          (err instanceof DOMException && err.name === 'AbortError') ||
          (err instanceof Error && err.name === 'AbortError')
        ) {
          // Playback request was interrupted by a new play/pause; safe to ignore.
          return
        }
        throw err
      })

    return this.playPromise
  }

  pause(): void {
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
