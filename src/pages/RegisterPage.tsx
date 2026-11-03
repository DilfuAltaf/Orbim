import { useState, type FormEvent } from 'react'
import { AlertCircle } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import { useAuth } from '@/features/auth/auth-context'
import { useToast } from '@/features/feedback/toast-context'
import { buttonVariants } from '@/lib/styles'

export function RegisterPage() {
  const { signUp, isConfigured } = useAuth()
  const { notify } = useToast()
  const navigate = useNavigate()

  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)

    const cleanName = displayName.trim()
    if (cleanName.length < 2 || cleanName.length > 50) {
      setFormError('Display name must be between 2 and 50 characters.')
      return
    }

    if (!email.trim() || !password) {
      setFormError('Please provide your email address and a password.')
      return
    }

    if (password.length < 6) {
      setFormError('Password must be at least 6 characters.')
      return
    }

    setIsSubmitting(true)
    const { error } = await signUp(email, password, cleanName)
    setIsSubmitting(false)

    if (error) {
      setFormError(error.message)
      notify({
        tone: 'info',
        title: 'Registration failed',
        description: error.message,
      })
      return
    }

    notify({
      tone: 'success',
      title: 'Welcome to Orbim!',
      description: 'Your account has been created.',
    })
    navigate('/explore', { replace: true })
  }

  return (
    <div className="rounded-card border border-border bg-surface/60 p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Create your account</h1>
        <Badge tone={isConfigured ? 'accent' : 'neutral'} className="py-0.5">
          {isConfigured ? 'Supabase Auth' : 'Demo Mode'}
        </Badge>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">
        An account lets you save playlists, add tracks to your collection, and invite collaborators.
      </p>

      {formError ? (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400"
        >
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <p className="leading-relaxed">{formError}</p>
        </div>
      ) : null}

      <form className="mt-5 space-y-4" onSubmit={handleSubmit} noValidate>
        <TextField
          id="register-name"
          label="Display name"
          autoComplete="nickname"
          placeholder="How collaborators see you"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
          disabled={isSubmitting}
        />
        <TextField
          id="register-email"
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={isSubmitting}
        />
        <TextField
          id="register-password"
          label="Password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 6 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          disabled={isSubmitting}
        />

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>

      <div className="mt-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[10px] font-semibold tracking-[0.14em] text-muted uppercase">
          or
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <Link
        to="/explore"
        className={buttonVariants({ variant: 'secondary', className: 'mt-4 w-full' })}
      >
        Browse the demo catalog
      </Link>

      <p className="mt-5 border-t border-border pt-4 text-sm text-muted">
        Already have an account?{' '}
        <Link
          to="/login"
          className="rounded font-medium text-accent underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:outline-none"
        >
          Sign in
        </Link>
      </p>
    </div>
  )
}
