import { useState, type FormEvent } from 'react'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import { site } from '@/config/site'
import { useAuth } from '@/features/auth/auth-context'
import { useToast } from '@/features/feedback/toast-context'
import { buttonVariants } from '@/lib/styles'

export function LoginPage() {
  const { signIn, isConfigured, user } = useAuth()
  const { notify } = useToast()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const destination = (location.state as { from?: string } | undefined)?.from || '/library'

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)

    if (!email.trim() || !password) {
      setFormError('Please enter your email and password.')
      return
    }

    setIsSubmitting(true)
    const { error } = await signIn(email, password)
    setIsSubmitting(false)

    if (error) {
      setFormError(error.message)
      notify({
        tone: 'info',
        title: 'Sign in failed',
        description: error.message,
      })
      return
    }

    notify({
      tone: 'success',
      title: 'Welcome back!',
      description: 'You have signed in successfully.',
    })

    navigate(destination, { replace: true })
  }

  return (
    <div className="rounded-card border border-border bg-surface/60 p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
        <Badge tone={isConfigured ? 'accent' : 'neutral'} className="py-0.5">
          {isConfigured ? 'Supabase Auth' : 'Demo Mode'}
        </Badge>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">
        Sign in to reach your personal playlists and collaborate on shared ones.
      </p>

      {user ? (
        <div className="mt-4 flex items-center gap-2.5 rounded-lg border border-accent/30 bg-accent/10 p-3 text-xs text-foreground">
          <CheckCircle2 aria-hidden="true" className="size-4 shrink-0 text-accent" />
          <p>
            You are currently signed in as <span className="font-medium">{user.email}</span>.
          </p>
        </div>
      ) : null}

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
          id="login-email"
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
          id="login-password"
          label="Password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          disabled={isSubmitting}
        />

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Signing in…' : 'Sign in'}
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
        className={buttonVariants({
          variant: 'secondary',
          className: 'mt-4 w-full',
        })}
      >
        Continue to the demo catalog
      </Link>

      <p className="mt-5 border-t border-border pt-4 text-sm text-muted">
        New to {site.name}?{' '}
        <Link
          to="/register"
          className="rounded font-medium text-accent underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:outline-none"
        >
          Create an account
        </Link>
      </p>
    </div>
  )
}
