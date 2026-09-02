import { useState, useEffect } from 'react'
import { NavLink, Link } from 'react-router-dom'
import ProfileSettings from './ProfileSettings.jsx'

export default function Navbar({ feedActive }) {
  const [systemTime, setSystemTime] = useState(() =>
    new Date().toLocaleTimeString('en-US', { hour12: false })
  )

  useEffect(() => {
    const interval = setInterval(() => {
      setSystemTime(new Date().toLocaleTimeString('en-US', { hour12: false }))
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  return (
    <nav className="navbar relative z-[9000] overflow-visible">
      <div className="nav-brand cursor-default">
        <svg width="24" height="24" viewBox="0 0 18 18" fill="none">
          <circle cx="9" cy="9" r="8" stroke="#0ea5e9" strokeWidth="1.5"/>
          <path d="M5 9h8M9 5v8" stroke="#0ea5e9" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        MargDarshak
        <span className="city">| Gandhinagar</span>
      </div>

      <div className="nav-links">
        <NavLink to="/dashboard" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          DASHBOARD
        </NavLink>
        <NavLink to="/incidents" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          INCIDENTS
        </NavLink>
        <NavLink to="/alerts" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          ALERTS
        </NavLink>
        <NavLink to="/insights" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          INSIGHTS
        </NavLink>
        <NavLink to="/radio" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          RADIO
        </NavLink>
      </div>

      <div className="nav-right relative z-[9001] overflow-visible">
        <span style={{ display:'flex', alignItems:'center', gap:6 }}>
          <span className={`dot ${feedActive ? 'dot-green' : 'dot-red'}`}></span>
          {feedActive ? 'FEED ACTIVE' : 'FEED OFFLINE'}
        </span>
        <span className="nav-clock mono">{systemTime}</span>
        <ProfileSettings />
      </div>
    </nav>
  )
}