import { BrowserRouter, Routes, Route, NavLink, Navigate, Link, useLocation } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import Dashboard from './pages/Dashboard.jsx'
import Incidents from './pages/Incidents.jsx'
import Alerts    from './pages/Alerts.jsx'
import Insights  from './pages/Insights.jsx'
import Radio     from './pages/Radio.jsx'
import LandingPage from './pages/LandingPage.jsx'
import { API_BASE_URL } from './config.js'
import Navbar from './components/Navbar.jsx'

function playbackClock(ts) {
  if (!ts) return '--:--:--'
  const timePart = String(ts).split(' ')[1] || ''
  return timePart.slice(0, 8) || '--:--:--'
}



function ProtectedRoute({ children }) {
  const [ready, setReady] = useState(false)
  const [authed, setAuthed] = useState(false)
  const location = useLocation()

  useEffect(() => {
    let cancelled = false
    const checkSession = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/me`, { credentials: 'include' })
        const data = await response.json().catch(() => ({}))
        if (!cancelled) {
          setAuthed(Boolean(response.ok && data?.user))
        }
      } catch {
        if (!cancelled) setAuthed(false)
      } finally {
        if (!cancelled) setReady(true)
      }
    }

    setReady(false)
    setAuthed(false)
    void checkSession()
    return () => { cancelled = true }
  }, [location.pathname])

  if (!ready) {
    return <div className="min-h-screen bg-slate-50" />
  }

  if (!authed) {
    return <Navigate to="/" replace />
  }

  return children
}



function AppShell() {
  const [feedActive, setFeedActive] = useState(false)
  const [playbackTs, setPlaybackTs] = useState('')
  const location = useLocation()
  const isLanding = location.pathname === '/'

  useEffect(() => {
    let mounted = true
    let failCount = 0
    let healthId = null

    const onPlaybackTs = (e) => {
      if (!mounted) return
      setPlaybackTs(e.detail || '')
      setFeedActive(true)
    }

    const onAuthFailed = () => {
      localStorage.removeItem('MARGDARSHAK_USER')
      window.location.href = '/?kicked=true'
    }

    window.addEventListener('playback-ts', onPlaybackTs)
    window.addEventListener('auth-failed', onAuthFailed)

    const checkHealth = async () => {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 1200)
      try {
        await fetch(`${API_BASE_URL}/health`, { signal: controller.signal, credentials: 'include' })
        clearTimeout(timeoutId)
        failCount = 0
        if (mounted) setFeedActive(true)
      } catch {
        clearTimeout(timeoutId)
        failCount += 1
        if (mounted) setFeedActive(false)
        // If backend is down, stop aggressive polling to avoid timeout spam.
        if (failCount >= 4 && healthId) {
          clearInterval(healthId)
          healthId = null
        }
      }
    }

    void checkHealth()
    healthId = setInterval(checkHealth, 8000)

    return () => {
      mounted = false
      window.removeEventListener('playback-ts', onPlaybackTs)
      window.removeEventListener('auth-failed', onAuthFailed)
      if (healthId) clearInterval(healthId)
    }
  }, [])

  return (
    <>
      {!isLanding && <Navbar feedActive={feedActive} playbackTs={playbackTs} />}
      <Routes>
        <Route path="/"          element={<LandingPage />} />
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/incidents" element={<ProtectedRoute><Incidents /></ProtectedRoute>} />
        <Route path="/alerts"    element={<ProtectedRoute><Alerts /></ProtectedRoute>} />
        <Route path="/insights"  element={<ProtectedRoute><Insights /></ProtectedRoute>} />
        <Route path="/radio"     element={<ProtectedRoute><Radio /></ProtectedRoute>} />
        <Route path="*"          element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppShell />
    </BrowserRouter>
  )
}