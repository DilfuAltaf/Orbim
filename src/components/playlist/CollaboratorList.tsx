import { UserMinus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { initialsOf } from '@/lib/format'
import type { Collaborator } from '@/types/music'

type CollaboratorListProps = {
  collaborators: Collaborator[]
  className?: string
  /** `stack` renders overlapping avatars; `detailed` adds names, locations and roles. */
  variant?: 'stack' | 'detailed'
  max?: number
  onKickCollaborator?: (collaborator: Collaborator) => void
  currentUserId?: string | null
}

const roleLabel: Record<Collaborator['role'], string> = {
  owner: 'Owner',
  editor: 'Editor',
}

export function CollaboratorList({
  collaborators,
  className,
  variant = 'stack',
  max = 4,
  onKickCollaborator,
  currentUserId,
}: CollaboratorListProps) {
  const visible = collaborators.slice(0, max)
  const overflow = collaborators.length - visible.length

  if (variant === 'stack') {
    return (
      <div className={cn('flex items-center', className)}>
        <div className="flex -space-x-2">
          {visible.map((collaborator) => (
            <span
              key={collaborator.id}
              title={`${collaborator.displayName} · ${collaborator.location} · ${roleLabel[collaborator.role]}`}
              className={cn(
                'flex size-7 items-center justify-center rounded-full border-2 border-surface text-[10px] font-semibold',
                collaborator.role === 'owner'
                  ? 'bg-accent/20 text-accent'
                  : 'bg-accent-secondary/20 text-accent-secondary',
              )}
            >
              <span aria-hidden="true">{initialsOf(collaborator.displayName)}</span>
              <span className="sr-only">
                {collaborator.displayName}, {roleLabel[collaborator.role].toLowerCase()}
              </span>
            </span>
          ))}
        </div>
        {overflow > 0 ? (
          <span className="ml-2 text-[11px] text-muted">+{overflow} more</span>
        ) : null}
      </div>
    )
  }

  return (
    <ul className={cn('space-y-3', className)}>
      {collaborators.map((collaborator) => (
        <li key={collaborator.id} className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
              collaborator.role === 'owner'
                ? 'bg-accent/15 text-accent'
                : 'bg-accent-secondary/15 text-accent-secondary',
            )}
          >
            {initialsOf(collaborator.displayName)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              {collaborator.displayName}
            </p>
            <p className="truncate text-[11px] text-muted">{collaborator.location}</p>
          </div>
          <span
            className={cn(
              'shrink-0 text-[10px] font-semibold tracking-[0.12em] uppercase',
              collaborator.role === 'owner' ? 'text-accent/80' : 'text-muted',
            )}
          >
            {roleLabel[collaborator.role]}
          </span>
          {onKickCollaborator && collaborator.role !== 'owner' && collaborator.id !== currentUserId ? (
            <button
              type="button"
              onClick={() => onKickCollaborator(collaborator)}
              title={`Keluarkan ${collaborator.displayName} dari kolaborator`}
              aria-label={`Keluarkan ${collaborator.displayName} dari kolaborator`}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-red-500/10 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 cursor-pointer"
            >
              <UserMinus className="size-3.5" />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
