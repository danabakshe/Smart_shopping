import { useEffect, useState } from 'react'
import PriceSearch from './components/PriceSearch'
import BackgroundTiles from './components/BackgroundTiles'
import AuthModal from './components/AuthModal'
import { api, AuthUser } from './services/api'
import './App.css'

function App() {
  const [authOpen, setAuthOpen] = useState<null | 'login' | 'signup'>(null)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loadingUser, setLoadingUser] = useState(true)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const me = await api.auth.me()
        if (cancelled) return
        setUser(me.user)
      } catch {
        if (cancelled) return
        setUser(null)
      } finally {
        if (cancelled) return
        setLoadingUser(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="App">
      <header>
        <div className="user-bar" aria-label="User">
          {loadingUser ? (
            <span style={{ opacity: 0.8 }}>Loading...</span>
          ) : user ? (
            <div className="user-chip">
              <span className="user-chip-name">{user.username}</span>
              <span className="user-chip-sep">|</span>
              <button
                className="auth-btn"
                type="button"
                onClick={async () => {
                  try {
                    await api.auth.logout()
                  } catch (err) {
                    // Log error but still clear user state
                    console.error('Logout error:', err)
                  } finally {
                    // Always clear user state, even if API call failed
                    setUser(null)
                  }
                }}
              >
                Log out
              </button>
            </div>
          ) : null}
        </div>

        {!loadingUser && !user && (
          <div className="auth-buttons" aria-label="Authentication">
            <button className="auth-btn" type="button" onClick={() => setAuthOpen('login')}>
              Log in
            </button>
            <button className="auth-btn auth-btn-primary" type="button" onClick={() => setAuthOpen('signup')}>
              Sign up
            </button>
          </div>
        )}
        <h1>Smart Shopping</h1>
        <p>Compare prices across countries</p>
      </header>
      <div className="page-white">
        <BackgroundTiles />
        <main>
          <PriceSearch user={user} />
        </main>
      </div>

      <AuthModal
        open={authOpen !== null}
        mode={authOpen ?? 'login'}
        onClose={() => setAuthOpen(null)}
        onSuccess={(u) => setUser(u)}
        onModeChange={(newMode) => setAuthOpen(newMode)}
      />
    </div>
  )
}

export default App

