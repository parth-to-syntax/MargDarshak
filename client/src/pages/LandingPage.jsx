import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Route, ShieldCheck, Siren } from 'lucide-react'
import { Button } from '../components/ui/button'
import { API_BASE_URL } from '../config.js'

export default function LandingPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ username: 'admin', password: 'admin123' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('kicked') === 'true') {
      setError("You've been logged out because your account was accessed from another location.")
    }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const response = await fetch(`${API_BASE_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(form),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Login failed')
      localStorage.setItem('MARGDARSHAK_USER', JSON.stringify(data.user))
      navigate('/dashboard')
    } catch (err) {
      setError(err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div 
      className="relative min-h-screen overflow-hidden text-slate-900 font-sans"
      style={{ 
        backgroundImage: "url('/map-bg.jpg')", 
        backgroundSize: 'cover', 
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed'
      }}
    >
      <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px]"></div>
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-8">
        <header className="flex items-center justify-between rounded-xl border border-gray-200 bg-white/90 px-5 py-4 shadow-md backdrop-blur-md sm:px-6">
          <div className="flex items-center gap-3 text-3xl font-bold tracking-tight text-blue-600">
            <svg width="36" height="36" viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="9" r="8" stroke="#0ea5e9" strokeWidth="1.5"/>
              <path d="M5 9h8M9 5v8" stroke="#0ea5e9" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            MargDarshak
          </div>
          <div className="text-sm font-medium text-slate-500">Secure operations access</div>
        </header>

        <section className="relative grid flex-1 items-center gap-10 py-12 lg:grid-cols-[1.0fr_0.9fr] lg:py-16">
          <div className="max-w-2xl rounded-2xl border border-gray-200 bg-white/80 p-8 shadow-xl backdrop-blur">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-600">Login</p>
            <h1 className="mt-4 text-4xl font-semibold leading-tight text-slate-900">Access the traffic command workspace.</h1>
            <p className="mt-4 text-lg text-slate-600">Use your secure officer or admin account to manage simulation playback, incidents, and alerts.</p>

            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Username</label>
                <input
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 shadow-sm outline-none ring-0"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Password</label>
                <input
                  type="password"
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 shadow-sm outline-none ring-0"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </div>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              <Button type="submit" className="w-full bg-blue-600 text-white hover:bg-blue-700" disabled={loading}>
                {loading ? 'Signing in...' : 'Sign In'}
              </Button>
            </form>

            <div className="mt-6 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-700">
              Demo accounts: admin / admin123, officer / officer123
            </div>
          </div>

          <div className="hidden lg:block">
            <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white p-5 shadow-md">
              <div className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-600">Live Operations Preview</div>
              <div className="space-y-3">
                <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-md">
                  <div className="text-sm text-slate-600">Incident Detection</div>
                  <div className="mt-1 text-xl font-semibold text-slate-900">Shared simulation state</div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-md">
                  <div className="text-sm text-slate-600">User Access</div>
                  <div className="mt-1 text-xl font-semibold text-slate-900">Admin and officer roles</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 sm:grid-cols-2">
          <article className="overflow-hidden rounded-xl border border-gray-200 bg-white p-5 shadow-md">
            <div className="p-5">
              <ShieldCheck className="h-6 w-6 text-blue-600" />
              <h2 className="mt-3 text-2xl font-semibold text-slate-900">Incident Intelligence</h2>
              <p className="mt-2 text-base leading-relaxed text-slate-600">AI narratives and action plans generated from live simulation context.</p>
            </div>
          </article>

          <article className="overflow-hidden rounded-xl border border-gray-200 bg-white p-5 shadow-md">
            <div className="p-5">
              <Siren className="h-6 w-6 text-blue-600" />
              <h2 className="mt-3 text-2xl font-semibold text-slate-900">Role-Based Access</h2>
              <p className="mt-2 text-base leading-relaxed text-slate-600">Admin controls user creation while officers focus on incidents and responses.</p>
            </div>
          </article>
        </section>
      </div>
    </div>
  )
}
