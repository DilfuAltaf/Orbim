import { FileText, Info, Loader2, ShieldAlert, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'

import { TrackArtwork } from '@/components/music/TrackArtwork'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { formatDuration } from '@/lib/format'
import { fetchTrackLyrics } from '@/services/lyrics/lyrics-service'
import type { MusicTrack } from '@/types/music'

type LyricsDialogProps = {
  track: MusicTrack | null
  open: boolean
  onClose: () => void
}

/**
 * Dialog displaying song metadata and official lyrics status.
 */
export function LyricsDialog({ track, open, onClose }: LyricsDialogProps) {
  const [fetchedData, setFetchedData] = useState<{
    trackId: string
    lyrics: string
    source: string
  } | null>(null)
  const [failedTrackId, setFailedTrackId] = useState<string | null>(null)

  const trackKey = track ? (track.id || track.providerTrackId || track.title) : ''
  const trackLyrics = track?.lyrics?.trim() || null
  const currentFetched = trackKey && fetchedData?.trackId === trackKey ? fetchedData : null
  const effectiveLyrics = trackLyrics || currentFetched?.lyrics || null
  const lyricsSource = track?.lyricsSource || currentFetched?.source || null
  const isFailed = Boolean(trackKey && failedTrackId === trackKey)
  const isLoading = Boolean(open && track && !trackLyrics && !currentFetched && !isFailed)

  useEffect(() => {
    if (!open || !track || track.lyrics?.trim()) {
      return
    }

    const currentId = track.id || track.providerTrackId || track.title
    let isMounted = true

    fetchTrackLyrics(track)
      .then((res) => {
        if (!isMounted) return
        if (res?.raw) {
          setFetchedData({
            trackId: currentId,
            lyrics: res.raw,
            source: res.source,
          })
        } else {
          setFailedTrackId(currentId)
        }
      })
      .catch(() => {
        if (!isMounted) return
        setFailedTrackId(currentId)
      })

    return () => {
      isMounted = false
    }
  }, [open, track])

  if (!track) return null

  const hasFullLyrics = Boolean(effectiveLyrics && effectiveLyrics.length > 0)
  const isLicensedFull = hasFullLyrics
  const hasPartialLyrics = Boolean(
    (track.lyricsStatus === 'partial' || track.lyricsSnippet) &&
    (track.lyricsSnippet?.trim() || track.lyrics?.trim()),
  )
  const partialContent = track.lyricsSnippet?.trim() || track.lyrics?.trim()

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Lyrics & Licensing Status"
      description={`Lyrics and licensing details for “${track.title || 'Untitled'}”.`}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-4">
        {/* Track header summary with safe partial data rendering */}
        <div className="flex items-center gap-3 rounded-lg border border-border bg-surface/50 p-3">
          <TrackArtwork track={track} className="size-14 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1">
            <h4 className="truncate text-sm font-semibold text-foreground">
              {track.title || 'Untitled Track'}
            </h4>
            <p className="truncate text-xs text-muted">
              {track.artistName || 'Unknown Artist'}
            </p>
            {track.albumName ? (
              <p className="truncate text-[11px] text-muted">{track.albumName}</p>
            ) : null}
            <div className="mt-1 flex items-center gap-2">
              <span className="text-[11px] text-muted">
                {track.durationSeconds > 0 ? formatDuration(track.durationSeconds) : 'Unknown duration'}
              </span>
              <span className="text-border">·</span>
              <span className="text-[11px] text-muted capitalize">
                Source: {track.provider === 'orbim' ? 'ORBIM Database' : 'Manual / Import'}
              </span>
            </div>
          </div>
        </div>

        {/* Loading state */}
        {isLoading ? (
          <div className="flex h-36 flex-col items-center justify-center gap-2 rounded-lg border border-border bg-surface/50 text-muted">
            <Loader2 className="size-5 animate-spin text-accent" />
            <span className="text-xs">Loading lyrics from catalog...</span>
          </div>
        ) : isLicensedFull ? (
          <div className="max-h-60 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-surface p-4 font-sans text-xs leading-relaxed text-foreground">
            {effectiveLyrics}
            <p className="mt-4 border-t border-border pt-2 text-[11px] text-muted">
              Lyrics source: {track.lyricsSource || lyricsSource || 'Spotify & Web Lyrics Catalog'}
            </p>
          </div>
        ) : hasPartialLyrics ? (
          /* Safe partial lyrics display */
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 shrink-0" />
                <span className="font-medium">Partial Lyrics / Snippet</span>
              </div>
              <Badge tone="neutral" className="text-[10px] bg-accent/20 border-accent/40">
                Safe Display
              </Badge>
            </div>

            <div className="rounded-lg border border-border bg-surface/70 p-3.5">
              <blockquote className="whitespace-pre-wrap font-sans text-xs italic leading-relaxed text-foreground">
                “{partialContent}”
              </blockquote>
              {track.lyricsSource ? (
                <p className="mt-3 text-[11px] text-muted">
                  Note / Source: {track.lyricsSource}
                </p>
              ) : null}
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-border bg-elevated/40 p-2.5 text-[11px] text-muted">
              <Info className="size-3.5 shrink-0 text-muted mt-0.5" />
              <p className="leading-relaxed">
                The snippet above is <strong>partial data displayed safely</strong>. Full copyrighted lyrics require official licensing from copyright owners.
              </p>
            </div>
          </div>
        ) : (
          /* When no lyrics are available */
          <div className="space-y-3">
            <div className="flex items-start gap-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs">
              <ShieldAlert className="size-4 shrink-0 text-amber-400 mt-0.5" />
              <div className="space-y-1 text-amber-200">
                <p className="font-medium text-amber-300">Status: Lyrics Not Available</p>
                <p className="text-[11px] leading-relaxed opacity-90">
                  Full lyrics for this track are not yet available in the ORBIM system.
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-elevated/40 p-3 text-xs text-muted space-y-2">
              <div className="flex items-center gap-2 font-medium text-foreground">
                <FileText className="size-3.5 text-accent" />
                <span>Official Lyrics Integration</span>
              </div>
              <p className="text-[11px] leading-relaxed">
                ORBIM respects musicians and songwriters copyright:
              </p>
              <ul className="list-disc pl-4 space-y-1 text-[11px] leading-relaxed">
                <li>We <strong>do not perform illegal scraping</strong> of external lyrics websites.</li>
                <li>We <strong>do not copy copyrighted lyrics</strong> without authorization.</li>
                <li>Future lyrics expansion uses licensed API partners (such as <em>Musixmatch</em>, <em>LyricFind</em>, or Creative Commons catalogs).</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}
