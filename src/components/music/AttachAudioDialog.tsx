import {
  AlertCircle,
  CheckCircle2,
  FileAudio,
  Loader2,
  Sparkles,
  Upload,
  Volume2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { TrackArtwork } from '@/components/music/TrackArtwork'
import { useAuth } from '@/features/auth/auth-context'
import { useToast } from '@/features/feedback/toast-context'
import { formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  attachAudioToTrack,
  validateUploadAudioFile,
} from '@/services/audio/track-audio-upload'
import type { MusicTrack } from '@/types/music'

export interface AttachAudioDialogProps {
  open: boolean
  onClose: () => void
  playlistId: string
  track: MusicTrack | null
  onSuccess?: (trackId: string, playbackUrl: string) => void
}

export function AttachAudioDialog({
  open,
  onClose,
  playlistId,
  track,
  onSuccess,
}: AttachAudioDialogProps) {
  const { user, isAdmin } = useAuth()
  const { notify } = useToast()

  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const audioPreviewUrl = useMemo(() => {
    if (!audioFile || typeof window === 'undefined') return null
    try {
      return URL.createObjectURL(audioFile)
    } catch {
      return null
    }
  }, [audioFile])

  useEffect(() => {
    return () => {
      if (audioPreviewUrl) {
        URL.revokeObjectURL(audioPreviewUrl)
      }
    }
  }, [audioPreviewUrl])

  function resetState() {
    setAudioFile(null)
    setFileError(null)
    setSubmitError(null)
    setIsSubmitting(false)
  }

  function handleClose() {
    if (isSubmitting) return
    resetState()
    onClose()
  }

  function handleFileSelected(file: File) {
    setFileError(null)
    setSubmitError(null)

    const validation = validateUploadAudioFile(file, file.name)
    if (!validation.valid) {
      setFileError(validation.error || 'Invalid audio file format.')
      setAudioFile(null)
      return
    }

    setAudioFile(file)
  }

  // Check if selected file name corresponds with track title
  const isTitleMatching = Boolean(
    track &&
      audioFile &&
      audioFile.name
        .toLowerCase()
        .replace(/[^a-z0-9]/gi, '')
        .includes(track.title.toLowerCase().replace(/[^a-z0-9]/gi, '')),
  )

  async function handleSubmit() {
    setSubmitError(null)

    if (!track) return

    if (!audioFile) {
      setSubmitError('Please select an audio file before uploading.')
      return
    }

    if (!playlistId) {
      setSubmitError('Invalid playlist ID.')
      return
    }

    if (!isAdmin) {
      setSubmitError('Only administrator accounts (dilfualtaf07@gmail.com) can upload audio.')
      return
    }

    const trackIdToUpdate = track.id || track.providerTrackId
    if (!trackIdToUpdate) {
      setSubmitError('Track ID not found.')
      return
    }

    setIsSubmitting(true)

    try {
      const result = await attachAudioToTrack({
        playlistId,
        trackId: trackIdToUpdate,
        track,
        audioFile,
        fileName: audioFile.name,
      })

      if (!result.success || result.error) {
        setSubmitError(result.error?.message || 'Failed to upload audio to Supabase.')
        setIsSubmitting(false)
        return
      }

      notify({
        title: 'Audio Uploaded Successfully!',
        description: `Audio file for "${track.title}" has been uploaded and activated.`,
        tone: 'success',
      })

      if (result.playbackUrl && onSuccess) {
        onSuccess(trackIdToUpdate, result.playbackUrl)
      }

      handleClose()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setSubmitError(`Error occurred: ${msg}`)
      setIsSubmitting(false)
    }
  }

  if (!track) return null

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Attach Audio to Track"
      description="Upload an audio file directly to Supabase Storage to enable playback for this track."
      className="max-w-md"
    >
      <div className="space-y-5">
        {/* Track Details Card */}
        <div className="flex items-center gap-3.5 rounded-lg border border-border bg-surface/50 p-3">
          <TrackArtwork track={track} className="size-14 rounded-md shadow-xs" />
          <div className="min-w-0 flex-1">
            <h4 className="truncate text-sm font-semibold text-foreground">{track.title}</h4>
            <p className="truncate text-xs text-muted">{track.artistName}</p>
            {track.albumName ? (
              <p className="truncate text-[11px] text-muted">{track.albumName}</p>
            ) : null}
            <div className="mt-1.5 flex items-center gap-2">
              <Badge tone={track.isPlayable ? 'accent' : 'neutral'} className="text-[10px]">
                {track.isPlayable ? 'Audio ready' : 'No audio'}
              </Badge>
              {track.durationSeconds > 0 ? (
                <span className="text-[11px] tabular-nums text-muted">
                  {formatDuration(track.durationSeconds)}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {/* Admin Authority Banner */}
        {!isAdmin ? (
          <div className="flex items-start gap-2.5 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            <AlertCircle className="size-4 shrink-0 text-amber-400" />
            <div>
              <p className="font-semibold text-amber-300">Restricted Access (Admin Only)</p>
              <p className="mt-0.5 text-amber-200/90 leading-relaxed">
                Only administrator accounts (<span className="font-mono text-white">dilfualtaf07@gmail.com</span>) have permission to upload audio files to the database.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted">
            <Badge tone="accent" className="text-[10px]">
              Admin
            </Badge>
            <span>Signed in as <strong className="text-foreground">{user?.email}</strong></span>
          </div>
        )}

        {/* File Dropzone & Selector */}
        <div>
          <label className="block text-xs font-medium text-foreground">
            Select Local Audio File
          </label>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const files = e.dataTransfer.files
              if (files && files.length > 0) {
                handleFileSelected(files[0])
              }
            }}
            className={cn(
              'mt-2 flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition-colors',
              fileError
                ? 'border-rose-500/50 bg-rose-500/5'
                : audioFile
                  ? 'border-emerald-500/50 bg-emerald-500/5'
                  : 'border-border/80 bg-surface/30 hover:border-accent/50 hover:bg-surface/60',
            )}
          >
            <input
              type="file"
              id="attach-audio-file-input"
              accept=".mp3,.wav,.ogg,.opus,.m4a,.aac,.flac"
              disabled={isSubmitting}
              onChange={(e) => {
                const files = e.target.files
                if (files && files.length > 0) {
                  handleFileSelected(files[0])
                }
              }}
              className="sr-only"
            />

            {audioFile ? (
              <div className="flex flex-col items-center gap-2">
                <div className="rounded-full bg-emerald-500/20 p-2.5 text-emerald-400">
                  <CheckCircle2 className="size-6" />
                </div>
                <div className="max-w-xs">
                  <p className="truncate text-xs font-medium text-foreground">{audioFile.name}</p>
                  <p className="text-[11px] text-muted">
                    {(audioFile.size / (1024 * 1024)).toFixed(2)} MB
                  </p>
                </div>

                {isTitleMatching ? (
                  <div className="mt-1 flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
                    <Sparkles className="size-3" />
                    <span>Matches song title!</span>
                  </div>
                ) : null}

                {audioPreviewUrl && (
                  <div className="mt-2 w-full pt-2 border-t border-border/50 text-left">
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted mb-1">
                      <Volume2 className="size-3 text-accent" />
                      <span>Audio Preview:</span>
                    </div>
                    <audio controls src={audioPreviewUrl} className="w-full h-8 rounded-md" />
                  </div>
                )}

                <label
                  htmlFor="attach-audio-file-input"
                  className="mt-2 cursor-pointer text-xs font-semibold text-accent hover:underline"
                >
                  Choose a different file
                </label>
              </div>
            ) : (
              <label
                htmlFor="attach-audio-file-input"
                className="flex cursor-pointer flex-col items-center gap-2"
              >
                <div className="rounded-full bg-elevated/70 p-3 text-muted">
                  <FileAudio className="size-6 text-foreground" />
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs font-medium text-foreground">
                    Click to select audio file or drag here
                  </p>
                  <p className="text-[11px] text-muted">
                    Supported formats: MP3, WAV, OGG, FLAC, M4A, AAC (Max 50 MB)
                  </p>
                </div>
              </label>
            )}
          </div>

          {fileError ? (
            <p className="mt-1.5 flex items-center gap-1 text-xs text-rose-400">
              <AlertCircle className="size-3.5 shrink-0" />
              <span>{fileError}</span>
            </p>
          ) : null}
        </div>

        {/* Submit Error */}
        {submitError ? (
          <div className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
            <AlertCircle className="size-4 shrink-0 text-rose-400" />
            <span>{submitError}</span>
          </div>
        ) : null}

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <Button
            type="button"
            variant="ghost"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>

          <Button
            type="button"
            variant="primary"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="gap-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                <span>Uploading to Supabase...</span>
              </>
            ) : (
              <>
                <Upload className="size-4" />
                <span>Upload Audio to Supabase</span>
              </>
            )}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
