import { useEffect, useId, useRef, useState } from 'react'
import './AuthModal.css'
import { api, AuthUser } from '../services/api'

type AuthModalMode = 'login' | 'signup'
type ForgotPasswordStep = 'email' | 'code' | null

export default function AuthModal({
  open,
  mode,
  onClose,
  onSuccess,
  onModeChange,
}: {
  open: boolean
  mode: AuthModalMode
  onClose: () => void
  onSuccess: (user: AuthUser) => void
  onModeChange?: (newMode: AuthModalMode) => void
}) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [forgotPasswordStep, setForgotPasswordStep] = useState<ForgotPasswordStep>(null)
  const [resetCode, setResetCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  useEffect(() => {
    if (!open) {
      // Clear everything when modal closes
      setSuccessMessage(null)
      return
    }
    setUsername('')
    setEmail('')
    setPassword('')
    setForgotPasswordStep(null)
    setResetCode('')
    setNewPassword('')
    setSubmitting(false)
    setError(null)
    // Don't clear successMessage here - let it persist when switching modes
    // It will be cleared when modal closes or explicitly set to null
    // focus after render
    setTimeout(() => {
      if (forgotPasswordStep === 'email') {
        const el = dialogRef.current?.querySelector<HTMLInputElement>('input[name="email"]')
        el?.focus()
      } else if (forgotPasswordStep === 'code') {
        const el = dialogRef.current?.querySelector<HTMLInputElement>('input[name="code"]')
        el?.focus()
      } else {
        const el = dialogRef.current?.querySelector<HTMLInputElement>('input[name="username"]')
        el?.focus()
      }
    }, 0)
  }, [open, mode, forgotPasswordStep])

  if (!open) return null

  const getTitle = () => {
    if (forgotPasswordStep === 'email') return 'Forgot Password'
    if (forgotPasswordStep === 'code') return 'Reset Password'
    return mode === 'login' ? 'Log in' : 'Sign up'
  }

  const title = getTitle()

  return (
    <div
      className="auth-modal-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="auth-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef}>
        <button className="auth-modal-close" type="button" aria-label="Close" onClick={onClose}>
          ×
        </button>

        <h2 id={titleId} className="auth-modal-title">
          {title}
        </h2>

        {forgotPasswordStep === null ? (
          <form
            className="auth-modal-form"
            onSubmit={async (e) => {
              e.preventDefault()
              if (submitting) return
              setError(null)
              setSubmitting(true)
              try {
                const u = username.trim()
                const p = password.trim()
                
                // Basic validation
                if (!u) {
                  setError('Username is required')
                  setSubmitting(false)
                  return
                }
                if (!p) {
                  setError('Password is required')
                  setSubmitting(false)
                  return
                }
                
                if (mode === 'login') {
                  const user = await api.auth.login(u, p)
                  setSuccessMessage(null)
                  onSuccess(user)
                  onClose()
                } else {
                  const e = email.trim()
                  if (!e) {
                    setError('Email is required')
                    setSubmitting(false)
                    return
                  }
                  await api.auth.signup(u, e, p)
                  // After successful signup, show success message and switch to login mode
                  setSuccessMessage('Account created successfully! Please log in.')
                  setUsername('')
                  setPassword('')
                  setEmail('')
                  setError(null)
                  // Switch to login mode after a brief delay
                  setTimeout(() => {
                    if (onModeChange) {
                      onModeChange('login')
                    }
                    // Keep success message visible in login form
                  }, 1500)
                }
              } catch (err) {
                const errorMessage = err instanceof Error ? err.message : 'Authentication failed'
                // Show the actual error message from the API
                setError(errorMessage)
                console.error('Login error:', err)
              } finally {
                setSubmitting(false)
              }
            }}
          >
            <label className="auth-modal-label">
              Username
              <input
                className="auth-modal-input"
                name="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={submitting}
              />
            </label>

            <label className="auth-modal-label" style={{ display: mode === 'signup' ? 'grid' : 'none' }}>
              Email
              <input
                className="auth-modal-input"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                required={mode === 'signup'}
              />
            </label>

            <label className="auth-modal-label">
              Password
              <input
                className="auth-modal-input"
                name="password"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
              />
            </label>

            {error && (
              <div className="error-message" role="alert" style={{ marginBottom: 10, fontSize: '12px', lineHeight: '1.4', width: '100%', padding: '8px 12px' }}>
                <strong>Error:</strong> {error}
              </div>
            )}

            {successMessage && (
              <div role="alert" style={{ marginBottom: 10, fontSize: '12px', lineHeight: '1.4', width: '100%', padding: '8px 12px', background: '#d4edda', color: '#155724', borderRadius: '4px' }}>
                {successMessage}
              </div>
            )}

            {mode === 'login' && (
              <button
                type="button"
                onClick={() => setForgotPasswordStep('email')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#0066cc',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  fontSize: '14px',
                  padding: '8px 0',
                  marginTop: '-8px',
                  marginBottom: '8px',
                }}
              >
                Forgot password?
              </button>
            )}

            <button className="auth-modal-submit" type="submit">
              {submitting ? 'Please wait...' : 'Continue'}
            </button>
          </form>
        ) : forgotPasswordStep === 'email' ? (
          <form
            className="auth-modal-form"
            onSubmit={async (e) => {
              e.preventDefault()
              if (submitting) return
              setError(null)
              setSuccessMessage(null)
              setSubmitting(true)
              try {
                const e = email.trim()
                if (!e) {
                  setError('Email is required')
                  return
                }
                await api.auth.forgotPassword(e)
                setSuccessMessage('If the email exists, a reset code has been sent. Please check your email.')
                setForgotPasswordStep('code')
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to send reset code')
              } finally {
                setSubmitting(false)
              }
            }}
          >
            {error && (
              <div className="error-message" role="alert" style={{ marginBottom: 10 }}>
                <strong>Error:</strong> {error}
              </div>
            )}
            <p style={{ marginBottom: 16, fontSize: '14px', color: '#666' }}>
              Enter your email address and we'll send you a reset code.
            </p>
            <label className="auth-modal-label">
              Email
              <input
                className="auth-modal-input"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
              />
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={() => {
                  setForgotPasswordStep(null)
                  setEmail('')
                  setError(null)
                  setSuccessMessage(null)
                }}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: '#f0f0f0',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Back
              </button>
              <button className="auth-modal-submit" type="submit" style={{ flex: 1 }}>
                {submitting ? 'Sending...' : 'Send Code'}
              </button>
            </div>
          </form>
        ) : (
          <form
            className="auth-modal-form"
            onSubmit={async (e) => {
              e.preventDefault()
              if (submitting) return
              setError(null)
              setSubmitting(true)
              try {
                const e = email.trim()
                const code = resetCode.trim()
                const newP = newPassword.trim()
                if (!e || !code || !newP) {
                  setError('All fields are required')
                  return
                }
                if (code.length !== 6 || !/^\d{6}$/.test(code)) {
                  setError('Code must be 6 digits')
                  return
                }
                if (newP.length < 6) {
                  setError('invalid password')
                  return
                }
                await api.auth.resetPassword(e, code, newP)
                setSuccessMessage('Password reset successfully! You can now log in.')
                setTimeout(() => {
                  onClose()
                  setForgotPasswordStep(null)
                  setEmail('')
                  setResetCode('')
                  setNewPassword('')
                }, 2000)
              } catch (err) {
                const errorMessage = err instanceof Error ? err.message : 'Failed to reset password'
                // Normalize password-related errors
                if (errorMessage.toLowerCase().includes('password')) {
                  setError('invalid password')
                } else {
                  setError(errorMessage)
                }
              } finally {
                setSubmitting(false)
              }
            }}
          >
            {error && (
              <div className="error-message" role="alert" style={{ marginBottom: 10 }}>
                <strong>Error:</strong> {error}
              </div>
            )}
            {successMessage && (
              <div style={{ marginBottom: 10, padding: '10px', background: '#d4edda', color: '#155724', borderRadius: '4px' }}>
                {successMessage}
              </div>
            )}
            <p style={{ marginBottom: 16, fontSize: '14px', color: '#666' }}>
              Enter the 6-digit code sent to your email and your new password.
            </p>
            <label className="auth-modal-label">
              Email
              <input
                className="auth-modal-input"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
              />
            </label>
            <label className="auth-modal-label">
              Reset Code
              <input
                className="auth-modal-input"
                name="code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={resetCode}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, '').slice(0, 6)
                  setResetCode(value)
                }}
                disabled={submitting}
              />
            </label>
            <label className="auth-modal-label">
              New Password
              <input
                className="auth-modal-input"
                name="new_password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={submitting}
              />
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={() => {
                  setForgotPasswordStep('email')
                  setResetCode('')
                  setNewPassword('')
                  setError(null)
                }}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: '#f0f0f0',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Back
              </button>
              <button className="auth-modal-submit" type="submit" style={{ flex: 1 }}>
                {submitting ? 'Resetting...' : 'Reset Password'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}


