import { useState, useEffect, useMemo, useRef } from 'react'
import { useFeed } from '../hooks/useFeed.js'
import { findNearest } from '../hooks/utils.js'
import PlaybackBar from '../components/PlaybackBar.jsx'
import MapView from '../components/Map.jsx'
import { API_BASE_URL } from '../config.js'
import { Mic, MicOff, AlertTriangle } from 'lucide-react'

const API = API_BASE_URL
const CHAT_STORAGE_KEY = 'SKYGRID_CHAT_HISTORY'
const SUGGESTIONS = ['Optimize route', 'Check congestion', 'Signal retiming plan', 'Create public alert']
const LOCAL_FACILITIES = [
  { id: 'hosp_001', name: 'Civil Hospital (Sector 12)', type: 'hospital', lat: 23.226, lng: 72.645 },
  { id: 'hosp_002', name: 'Aashka Hospital (Sargasan)', type: 'hospital', lat: 23.190, lng: 72.605 },
  { id: 'hosp_003', name: 'Apollo Hospital (Bhat)', type: 'hospital', lat: 23.102, lng: 72.628 },
  { id: 'fire_001', name: 'Gandhinagar Fire Station (Sector 17)', type: 'fire_station', lat: 23.232, lng: 72.650 },
  { id: 'fire_002', name: 'Fire Station (Sector 25)', type: 'fire_station', lat: 23.245, lng: 72.637 },
]

// ── Debug Panel ──────────────────────────────────────────────────────────────
const LOG_COLORS = {
  '[ORIGIN]': '#60a5fa',
  '[DEST]': '#60a5fa',
  '[GRAPH]': '#a78bfa',
  '[ROUTE]': '#34d399',
  '[LLM]': '#fbbf24',
  '[RESULT]': '#f9fafb',
  '[RUN]': '#94a3b8',
}
function logColor(line) {
  for (const [tag, color] of Object.entries(LOG_COLORS)) {
    if (line.startsWith(tag)) return color
  }
  return '#94a3b8'
}

function DebugPanel({ incidentId, enabled = true }) {
  const [log, setLog] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => {
    if (!enabled || !open || !incidentId) { setLog([]); return }
    setLoading(true)
    const fetch_ = async () => {
      try {
        const res = await fetch(`${API}/debug/log?incident_id=${incidentId}`, { credentials: 'include' })
        const data = await res.json()
        setLog(data.log || [])
      } catch { }
      setLoading(false)
    }
    fetch_()
    const id = setInterval(fetch_, 8000)
    return () => clearInterval(id)
  }, [enabled, open, incidentId])

  useEffect(() => {
    if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior: 'smooth' })
  }, [log])

  return (
    <div style={{ borderTop: open ? '1px solid var(--border)' : 'none', flexShrink: 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', background: 'var(--surface)', border: 'none',
          color: open ? '#34d399' : 'var(--muted)', fontFamily: 'var(--mono)',
          fontSize: 11, padding: '6px 16px', textAlign: 'left',
          cursor: 'pointer', letterSpacing: 1,
          borderBottom: open ? '1px solid var(--border)' : 'none',
        }}
      >
        {open ? '▼' : '▶'} ROUTING PROCESS LOG
        {incidentId && <span style={{ marginLeft: 8, color: '#60a5fa' }}>{incidentId}</span>}
        {loading && <span style={{ marginLeft: 8, color: '#fbbf24' }}>⟳ fetching...</span>}
        {!open && log.length > 0 && <span style={{ marginLeft: 8, color: '#34d399' }}>{log.length} lines</span>}
      </button>
      <div style={{
        background: '#f8fbff', fontFamily: 'var(--mono)', fontSize: 11,
        lineHeight: 1.7, padding: open ? '10px 16px' : '0 16px',
        maxHeight: open ? 280 : 0,
        overflowY: open ? 'auto' : 'hidden',
        color: '#64748b',
        transition: 'max-height 0.25s ease, padding 0.2s ease',
      }}>
        {log.length === 0 ? (
          <div style={{ color: '#475569' }}>
            {incidentId
              ? '⟳ Waiting for analysis to complete...'
              : 'No active incident. Trigger an incident to see routing logs.'}
          </div>
        ) : (
          log.map((line, i) => (
            <div key={i} style={{ color: logColor(line), whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {line}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

function SpeedDot({ color }) {
  return <span className="dot" style={{ background: color, flexShrink: 0 }}></span>
}

function SeverityBars({ speed, freeFlow }) {
  const ratio = freeFlow > 0 ? speed / freeFlow : 1
  const filled = ratio >= 0.75 ? 0 : ratio >= 0.5 ? 1 : ratio >= 0.25 ? 2 : 3
  return (
    <div className="speed-bars">
      {[0, 1, 2].map(i => (
        <div key={i} className={`speed-bar ${i < filled ? 'filled' : ''}`}></div>
      ))}
    </div>
  )
}

function IncidentCard({ inc, onAck, nearestHospital, nearestFireStation }) {
  if (!inc) return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-md">
      <div className="text-lg font-semibold text-slate-800">Incident Status</div>
      <div style={{ color: 'var(--green)', fontFamily: 'var(--mono)', fontSize: 13, marginTop: 8 }}>
        <span className="dot dot-green" style={{ marginRight: 6 }}></span>
        NO ACTIVE INCIDENT
      </div>
      <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 6 }}>Monitoring live feed...</div>
    </div>
  )

  const isConstruction = inc.type === 'ROAD_CLOSED'
  const hash = Array.from(inc.id || '').reduce((sum, char) => sum + char.charCodeAt(0), 0)
  const friendlyName = isConstruction ? 'Construction' : (hash % 2 === 0 ? 'Car Crash' : 'Truck Crash')

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-md transition-all duration-200 hover:shadow-lg">
      <div className="badge badge-red" style={{ fontSize: 10 }}>INCIDENT ACTIVE</div>
      <div className="mt-2 text-xl font-bold text-red-700">{friendlyName}</div>
      <div className="mt-1 text-base font-medium text-slate-800">{inc.location}</div>
      <div className="inc-time mono" style={{ marginTop: 2 }}>{inc.time}</div>
      <SeverityBars speed={inc.speed} freeFlow={60} />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, margin: '8px 0 4px' }}>
        <span className="inc-speed" style={{ fontSize: 34 }}>{inc.speed}</span>
        <span className="inc-speed-unit">km/h</span>
      </div>

      {/* Facilities Distances */}
      <div style={{ marginTop: 12, padding: '8px 10px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {nearestHospital && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
            <span style={{ color: '#22c55e' }}>✚</span>
            <span style={{ color: '#475569' }}>{nearestHospital.name.split(' (')[0]}</span>
            <span style={{ marginLeft: 'auto', fontWeight: 'bold', color: '#22c55e' }}>{nearestHospital.distance.toFixed(1)} km</span>
          </div>
        )}
        {nearestFireStation && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
            <span style={{ color: '#f97316' }}>🔥</span>
            <span style={{ color: '#475569' }}>{nearestFireStation.name.split(' (')[0]}</span>
            <span style={{ marginLeft: 'auto', fontWeight: 'bold', color: '#f97316' }}>{nearestFireStation.distance.toFixed(1)} km</span>
          </div>
        )}
      </div>

      <button className="mt-3 w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-md transition hover:scale-105 hover:bg-blue-700" onClick={() => onAck(inc.id)}>
        ACKNOWLEDGE
      </button>
    </div>
  )
}

function RoadFeed({ segments }) {
  const byRoad = {}
  for (const s of segments) {
    if (!s.street_name) continue
    if (!byRoad[s.street_name] || s.speed < byRoad[s.street_name].speed) {
      byRoad[s.street_name] = s
    }
  }

  const roads = Object.keys(byRoad)
    .map(name => {
      const seg = byRoad[name]
      const ff = Number(seg.free_flow || seg.free_flow_speed || 1)
      const ratio = ff > 0 ? seg.speed / ff : 1
      return { name, seg, ratio }
    })
    .sort((a, b) => a.seg.speed - b.seg.speed)
    .slice(0, 10)

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-md transition-all duration-200 hover:shadow-lg">
      <div className="text-lg font-semibold text-slate-800">Top 10 Slowest Roads</div>
      <div className="mt-1 text-sm text-slate-500">Live congestion ranking</div>
      <div className="mt-2 transition-all duration-300">
        {roads.map(({ name, seg }) => {
          const speed = Number(seg.speed || 0)
          const color = speed < 20 ? '#ef4444' : speed <= 40 ? '#f97316' : '#22c55e'
          return (
            <div key={name} className="road-row" style={{ padding: '10px 0', borderBottom: '1px solid #e5e7eb' }}>
              <SpeedDot color={color} />
              <span className="road-name text-slate-900" style={{ textAlign: 'left' }}>{name}</span>
              <span className="road-speed" style={{ color, minWidth: 84, textAlign: 'right' }}>
                {speed} km/h
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DiversionList({ diversions }) {
  if (!diversions || diversions.length === 0) return null
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-md">
      <div className="text-lg font-semibold text-slate-800">Active Diversions</div>
      <div className="mt-3 space-y-2">
        {diversions.map((d, i) => (
          <div key={i} className="flex items-start gap-2 rounded-lg border border-pink-100 bg-pink-50 px-3 py-2 text-sm font-medium text-pink-700">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, marginTop: 2 }}>
              <path d="M2 7h8M7 4l3 3-3 3" stroke="#db2777" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span>{d}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function LeafletMap({ segments, diversion_coords }) {
  const mapRef = useRef(null)
  const mapObj = useRef(null)
  const linesRef = useRef([])
  const divRef = useRef(null)
  const incRef = useRef(null)

  useEffect(() => {
    if (mapObj.current) return
    const L = window.L
    const map = L.map(mapRef.current, {
      center: [23.215, 72.645],
      zoom: 14,
      zoomControl: false,
    })
    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      { attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 19 }
    ).addTo(map)
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    mapObj.current = map
  }, [])

  useEffect(() => {
    const L = window.L
    if (!L || !mapObj.current || !segments.length) return
    const map = mapObj.current

    // Remove old lines
    linesRef.current.forEach(l => map.removeLayer(l))
    linesRef.current = []
    if (incRef.current) { map.removeLayer(incRef.current); incRef.current = null }
    if (divRef.current) { map.removeLayer(divRef.current); divRef.current = null }

    for (const s of segments) {
      if (!s.seg_start_lat || !s.seg_start_lng || !s.seg_end_lat || !s.seg_end_lng) continue;
      const w = s.incident_type === 'ACCIDENT' ? 8 : s.incident_type === 'ROAD_CLOSED' ? 7 : 3
      const line = L.polyline(
        [[s.seg_start_lat, s.seg_start_lng], [s.seg_end_lat, s.seg_end_lng]],
        { color: s.color, weight: w, opacity: 0.9 }
      )
        .bindTooltip(
          `<b>${s.street_name}</b><br>${s.speed} km/h / ${s.free_flow} ff<br>${s.incident_type} sev${s.severity}`,
          { sticky: true }
        )
        .addTo(map)
      linesRef.current.push(line)

      if (s.incident_type === 'ACCIDENT' || s.incident_type === 'ROAD_CLOSED') {
        incRef.current = L.circleMarker([s.lat, s.lng], {
          radius: 12, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.9, weight: 2
        }).bindPopup(`<b>${s.incident_type}</b><br>${s.street_name}<br>${s.speed} km/h`).addTo(map)
      }
    }

    if (diversion_coords && diversion_coords.length > 1) {
      divRef.current = L.polyline(diversion_coords, {
        color: '#ec4899', weight: 4, opacity: 0.85,
        dashArray: '8 5', dashOffset: '0'
      }).bindTooltip('Suggested diversion').addTo(map)
    }
  }, [segments, diversion_coords])

  return <div id="map" ref={mapRef} style={{ width: '100%', height: '100%' }}></div>
}

function InsightsBar({ insights }) {
  const toBullets = (text = '') => {
    if (!text) return []
    return text
      .split(/\.|\||\n/)
      .map(s => s.trim())
      .filter(Boolean)
      .slice(0, 3)
  }

  if (!insights) return null

  const signalBullets = toBullets(insights.signal)
  const diversionBullets = toBullets(insights.diversion)
  const narrativeBullets = toBullets(insights.narrative)

  return (
    <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-3">
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-md">
        <div className="text-lg font-semibold text-slate-800">Signal Retiming</div>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-base text-slate-600">
          {signalBullets.map((item, idx) => <li key={`signal-${idx}`}>{item}</li>)}
        </ul>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-md">
        <div className="text-lg font-semibold text-slate-800">Diversion Plan</div>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-base text-slate-600">
          {diversionBullets.map((item, idx) => <li key={`diversion-${idx}`}>{item}</li>)}
        </ul>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-md">
        <div className="text-lg font-semibold text-slate-800">Incident Narrative</div>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-base text-slate-600">
          {narrativeBullets.map((item, idx) => <li key={`narrative-${idx}`}>{item}</li>)}
        </ul>
      </div>
    </div>
  )
}

function StatusBar({ metrics, tsIndex }) {
  return (
    <div className="status-bar">
      <div className="status-item">
        AI RESPONSE <span className="status-val" style={{ marginLeft: 4 }}>8.4s</span>
      </div>
      <div className="status-item">
        MANUAL BASELINE <span className="status-val" style={{ marginLeft: 4 }}>~4 min</span>
      </div>
      <div className="status-item">
        EST. SAVED <span className="status-val" style={{ color: 'var(--green)', marginLeft: 4 }}>2m 35s</span>
      </div>
      <div style={{ flex: 1 }}></div>
      <div className="status-item">
        AVG SPEED <span className="status-val" style={{ marginLeft: 4 }}>{metrics.avg_speed} km/h</span>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const {
    dataSource,
    currentFrame, roadFeed, incident, incidentLog,
    incidentCount, congestedCount, avgSpeed, networkHealth,
    currentTs, frameIdx, totalFrames, isPlaying, setIsPlaying,
    playSpeed, setPlaySpeed, goToFrame, resetPlayback, acknowledgeIncident, resolveIncident,
  } = useFeed()

  const [insights, setInsights] = useState(null)
  const [diversionCoords, setDiversionCoords] = useState([])
  const [resolveTarget, setResolveTarget] = useState(null)
  const [systemLogs, setSystemLogs] = useState([])
  const [showDetailsId, setShowDetailsId] = useState(null)

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const res = await fetch(`${API}/incident/logs`, { credentials: 'include' })
        const data = await res.json()
        setSystemLogs(data.logs || [])
      } catch {}
    }
    fetchLogs()
    const id = setInterval(fetchLogs, 3000)
    return () => clearInterval(id)
  }, [])
  const [messages, setMessages] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) || '[]')
    } catch {
      return []
    }
  })
  const [chatInput, setChatInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [isCopilotOpen, setIsCopilotOpen] = useState(false)
  const [facilities, setFacilities] = useState([])
  const [isListening, setIsListening] = useState(false)
  const [pendingSegment, setPendingSegment] = useState(null)
  const [incidentType, setIncidentType] = useState('ACCIDENT')
  const messagesEndRef = useRef(null)

  // Support multiple incidents
  const [selectedIncidentId, setSelectedIncidentId] = useState(null)
  const incidents = useMemo(() => {
    if (!incidentLog) return []
    const active = incidentLog.filter((inc) => inc.status === 'ACTIVE')
    const unique = []
    const seen = new Set()
    for (const inc of active) {
      if (!seen.has(inc.id)) {
        seen.add(inc.id)
        unique.push(inc)
      }
    }
    return unique
  }, [incidentLog])
  const activeIncident = useMemo(() => {
    if (selectedIncidentId) return incidentLog.find((inc) => inc.id === selectedIncidentId)
    return incidents[0] || null
  }, [incidents, selectedIncidentId, incidentLog])
  const manualIncidentTarget = useMemo(() => {
    const candidates = (currentFrame || []).filter((segment) => segment && segment.seg_id)
    if (!candidates.length) return null
    return [...candidates].sort((left, right) => Number(left.speed || 0) - Number(right.speed || 0))[0] || candidates[0]
  }, [currentFrame])
  const nearestHospital = useMemo(
    () => findNearest(activeIncident, facilities, 'hospital'),
    [activeIncident, facilities]
  )
  const nearestFireStation = useMemo(
    () => findNearest(activeIncident, facilities, 'fire_station'),
    [activeIncident, facilities]
  )

  useEffect(() => {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages))
  }, [messages])

  useEffect(() => {
    if (!isCopilotOpen) return
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping, isCopilotOpen])

  useEffect(() => {
    if (dataSource === 'csv') {
      setFacilities(LOCAL_FACILITIES)
      return
    }

    const controller = new AbortController()
    const id = setTimeout(() => controller.abort(), 2500)

    fetch(`${API}/facilities`, { signal: controller.signal, credentials: 'include' })
      .then(r => r.json())
      .then(setFacilities)
      .catch(() => setFacilities(LOCAL_FACILITIES))

    return () => {
      clearTimeout(id)
      controller.abort()
    }
  }, [dataSource])

  useEffect(() => {
    if (!incident) { setInsights(null); setDiversionCoords([]); return }

    // Set hardcoded fallback immediately (will be overwritten if backend has real AI data)
    if (dataSource === 'csv') {
      const road = incident.location || 'affected corridor'
      const nearestHospitalName = nearestHospital?.name || 'nearest hospital'
      const nearestFireName = nearestFireStation?.name || 'nearest fire station'

      setInsights({
        signal: `Prioritize green phase toward ${road} approaches by +20s. Hold cross-street amber for 3s to flush backlog safely.`,
        diversion: `Primary: divert around ${road} toward ${nearestHospitalName}. | Secondary: keep emergency lane open toward ${nearestFireName}.`,
        narrative: `${incident.type} on ${road}. Local fallback guidance active in CSV mode. Dispatch closest responders and monitor queue spillback.`,
        vms: `INCIDENT NEAR ${road.toUpperCase()} USE ALTERNATE CORRIDORS`,
        radio: `Incident reported on ${road}; responders route via nearest clear corridor.`,
        social: `Traffic alert on ${road}. Diversions active, expect delays. #GandhinagarTraffic`,
      })

      const baseLat = incident.lat || incident.seg_start_lat || incident.seg_end_lat
      const baseLng = incident.lng || incident.seg_start_lng || incident.seg_end_lng
      const coords = []
      if (incident.seg_start_lat && incident.seg_start_lng) {
        coords.push([incident.seg_start_lat, incident.seg_start_lng])
      }
      if (baseLat && baseLng) {
        coords.push([baseLat, baseLng])
      }
      if (incident.seg_end_lat && incident.seg_end_lng) {
        coords.push([incident.seg_end_lat, incident.seg_end_lng])
      }
      if (nearestHospital?.lat && nearestHospital?.lng) {
        coords.push([nearestHospital.lat, nearestHospital.lng])
      }
      if (nearestFireStation?.lat && nearestFireStation?.lng) {
        coords.push([nearestFireStation.lat, nearestFireStation.lng])
      }
      setDiversionCoords(coords)
      // Don't return — fall through to try real AI insights from the backend
    }

    // Always try to fetch real AI insights from backend (works in both API and CSV modes)
    const fetchInsights = async () => {
      try {
        const res = await fetch(`${API}/insights/${incident.id}`, { credentials: 'include' })
        const data = await res.json()
        // Only overwrite if backend returned actual content
        if (data.signal_retiming || data.diversion || data.narrative) {
          setInsights({
            signal: data.signal_retiming,
            diversion: data.diversion,
            narrative: data.narrative,
            vms: data.alerts?.vms,
            radio: data.alerts?.radio,
            social: data.alerts?.social,
          })
        }
        if (data.diversion_coords?.length) {
          setDiversionCoords(data.diversion_coords)
        }
      } catch (e) { }
    }
    fetchInsights()
    const id = setInterval(fetchInsights, 5000)
    return () => clearInterval(id)
  }, [dataSource, incident, nearestHospital, nearestFireStation])

  function formatTime(ts) {
    if (!ts) return '--:--'
    const dt = new Date(ts)
    if (Number.isNaN(dt.getTime())) return '--:--'
    return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  async function requestAiReply(prompt) {
    setIsTyping(true)
    try {
      const res = await fetch(`${API}/chat`, {
        credentials: 'include',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: prompt }),
      })
      const data = await res.json()
      setMessages(prev => [...prev, { role: 'ai', text: data.reply || 'No response', ts: Date.now() }])
    } catch {
      setMessages(prev => [...prev, { role: 'ai', text: 'Co-pilot unavailable.', ts: Date.now() }])
    } finally {
      setIsTyping(false)
    }
  }

  function handleSegmentClick(seg) {
    if (seg) {
      setPendingSegment(seg)
      setIncidentType('ACCIDENT')
    }
  }

  async function confirmTriggerIncident(seg) {
    if (!seg) return
    try {
      const startLat = Number(seg.seg_start_lat || 0)
      const endLat = Number(seg.seg_end_lat || 0)
      const startLng = Number(seg.seg_start_lng || 0)
      const endLng = Number(seg.seg_end_lng || 0)
      const latVal = seg.lat !== undefined ? Number(seg.lat) : ((startLat + endLat) / 2)
      const lngVal = seg.lng !== undefined ? Number(seg.lng) : ((startLng + endLng) / 2)

      const response = await fetch(`${API}/incident/trigger`, {
        credentials: 'include',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seg_id: seg.seg_id,
          lat: latVal,
          lng: lngVal,
          street_name: seg.street_name || 'Unnamed Road',
          seg_start_lat: startLat,
          seg_start_lng: startLng,
          seg_end_lat: endLat,
          seg_end_lng: endLng,
          incident_type: incidentType,
        })
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.detail || `Failed to create incident (${response.status})`)
      }

      setSelectedIncidentId(null)
      if (typeof window !== 'undefined' && window.useFeedPollIncidents) {
        window.useFeedPollIncidents()
      }
    } catch (e) {
      console.error('Failed to trigger manual incident:', e)
    }
  }

  async function sendMessage() {
    if (!chatInput.trim() || isTyping) return
    if (isListening) setIsListening(false) // toggle off on send
    const prompt = chatInput.trim()
    const userMsg = { role: 'user', text: prompt, ts: Date.now() }
    setMessages(prev => [...prev, userMsg])
    setChatInput('')
    await requestAiReply(prompt)
  }

  function toggleVoice() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      alert("Browser STT not supported.")
      return
    }

    if (isListening) {
      setIsListening(false)
      return
    }

    const rec = new SpeechRecognition()
    rec.continuous = false
    rec.lang = 'en-US'
    rec.onstart = () => setIsListening(true)
    rec.onend = () => setIsListening(false)
    rec.onresult = (e) => {
      const trans = e.results[0][0].transcript
      if (trans) setChatInput(p => p ? p + ' ' + trans : trans)
    }
    rec.start()
  }

  async function sendSuggestion(suggestion) {
    setChatInput(suggestion)
    const userMsg = { role: 'user', text: suggestion, ts: Date.now() }
    setMessages(prev => [...prev, userMsg])
    await requestAiReply(suggestion)
  }

  function clearChat() {
    setMessages([])
    localStorage.removeItem(CHAT_STORAGE_KEY)
  }

  // Use the LLM diversion text (split on " | " or newlines) for the sidebar chips.
  // Falls back to empty so the DiversionList shows nothing rather than hardcoded strings.
  const diversions = (() => {
    if (!incident || !insights?.diversion) return []
    // The LLM often separates alternatives with " | " or new lines
    const parts = insights.diversion
      .split(/\s*[|\n]\s*/)
      .map(s => s.trim())
      .filter(s => s.length > 4)
    return parts.length > 0 ? parts.slice(0, 3) : [insights.diversion]
  })()

  return (
    <div className='ai-page'>
      <div className='relative z-10 dashboard-layout' style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 58px)', padding: 16, gap: 12, overflow: 'hidden' }}>
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div className='sidebar' style={{ gap: 12, overflowY: 'auto' }}>

            {/* Compact Incident Cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', letterSpacing: 0.5 }}>ACTIVE INCIDENTS</div>
              {incidents.length === 0 ? (
                <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm text-center">
                  <div style={{ color: '#22c55e', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600 }}>
                    <span className="dot dot-green" style={{ marginRight: 6 }}></span>
                    NO ACTIVE INCIDENTS
                  </div>
                  <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 4 }}>Monitoring Gandhinagar live feed...</div>
                </div>
              ) : (
                incidents.map((inc) => {
                  const isSelected = selectedIncidentId === inc.id || (!selectedIncidentId && incidents[0]?.id === inc.id)
                  const isConstruction = inc.type === 'ROAD_CLOSED'
                  const hash = Array.from(inc.id || '').reduce((sum, char) => sum + char.charCodeAt(0), 0)
                  const friendlyName = isConstruction ? 'ROAD CLOSED' : (hash % 2 === 0 ? 'CAR CRASH' : 'TRUCK CRASH')
                  const severityText = inc.severity >= 3 ? 'High' : inc.severity === 2 ? 'Medium' : 'Low'
                  const borderColors = inc.severity >= 3 ? '#ef4444' : inc.severity === 2 ? '#f97316' : '#22c55e'
                  const bgColors = inc.severity >= 3 ? '#fef2f2' : inc.severity === 2 ? '#fff7ed' : '#f0fdf4'

                  return (
                    <div
                      key={inc.id}
                      onClick={() => setSelectedIncidentId(inc.id)}
                      style={{
                        padding: 12,
                        borderRadius: 10,
                        border: isSelected ? '3px solid ' + borderColors : '1px solid ' + borderColors,
                        background: bgColors,
                        cursor: 'pointer',
                        boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: borderColors }}>
                          {friendlyName}
                        </span>
                        <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: '#fee2e2', color: '#991b1b' }}>
                          ACTIVE
                        </span>
                      </div>
                      
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginTop: 4 }}>{inc.location}</div>
                      
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748b', marginTop: 6 }}>
                        <span>Severity: <strong>{severityText}</strong></span>
                        <span>Speed: <strong>{inc.speed} km/h</strong></span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748b', marginTop: 2 }}>
                        <span>Time: <strong>{inc.time}</strong></span>
                        <span>ID: <strong>{inc.id}</strong></span>
                      </div>

                      {isSelected && (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #cbd5e1', display: 'flex', gap: 6 }}>
                          <button
                            style={{
                              flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 600, borderRadius: 6,
                              background: '#2563eb', color: '#ffffff',
                              border: 'none', cursor: 'pointer'
                            }}
                            onClick={(e) => {
                              e.stopPropagation()
                              setShowDetailsId(inc.id)
                            }}
                          >
                            INTEL
                          </button>
                          <button
                            style={{
                              flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 600, borderRadius: 6,
                              background: '#dc2626', color: '#ffffff',
                              border: 'none', cursor: 'pointer'
                            }}
                            onClick={(e) => {
                              e.stopPropagation()
                              setResolveTarget(inc.id)
                            }}
                          >
                            RESOLVE
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>

            {/* System Logs / Timeline */}
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm" style={{ display: 'flex', flexDirection: 'column', minHeight: 180, maxHeight: 220 }}>
              <div className="text-sm font-bold text-slate-800">System Logs</div>
              <div className="mt-1 text-xs text-slate-500">Persistent incident lifecycle history</div>
              <div className="mt-2 space-y-1.5 overflow-y-auto flex-1 text-xs text-slate-600 font-mono" style={{ borderTop: '1px solid #f1f5f9', paddingTop: 8 }}>
                {systemLogs.length === 0 ? (
                  <div style={{ color: '#94a3b8', fontStyle: 'italic' }}>No logs recorded.</div>
                ) : (
                  systemLogs.map((log, index) => (
                    <div key={index} style={{ display: 'flex', gap: 8, paddingBottom: 4, borderBottom: '1px solid #f8fafc' }}>
                      <span style={{ color: '#94a3b8' }}>{log.timestamp}</span>
                      <span style={{ fontWeight: 600, color: '#334155' }}>{log.message}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <RoadFeed segments={currentFrame || []} />
            <DiversionList diversions={diversions} />
          </div>

          <div className='main-area' style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
            <div className='map-container rounded-xl border border-gray-200 bg-white shadow-md' style={{ flex: 1, position: 'relative', overflow: 'hidden', minHeight: 0 }}>
              <MapView
                segments={currentFrame || []}
                incident={activeIncident}
                incidents={incidents}
                onSegmentClick={handleSegmentClick}
                facilities={facilities}
              />
              {!isCopilotOpen && (
                <button className='copilot-btn rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:scale-105 hover:bg-blue-700' onClick={() => setIsCopilotOpen(true)}>Open AI CoPilot</button>
              )}

              <aside className={`chat-side-panel ${isCopilotOpen ? 'open' : 'closed'}`}>
                <div className='chat-head'>
                  <div>
                    <div className='chat-title'>SkyGrid CoPilot</div>
                    <div className='chat-subtitle'>Actionable route, signal, and alert guidance</div>
                  </div>
                  <div className='chat-actions'>
                    <button className='chat-action-btn' onClick={clearChat}>Clear Chat</button>
                    <button className='chat-action-btn' onClick={() => setIsCopilotOpen(v => !v)}>
                      {isCopilotOpen ? 'Close' : 'Open'}
                    </button>
                  </div>
                </div>

                <div className='chat-suggestions'>
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      className='chat-chip'
                      onClick={() => sendSuggestion(s)}
                      disabled={isTyping}
                    >
                      {s}
                    </button>
                  ))}
                </div>

                <div className='chat-message-scroll'>
                  {messages.length === 0 && (
                    <div className='copilot-placeholder'>Click an incident on map or pick a suggestion to start.</div>
                  )}
                  {messages.map((m, i) => (
                    <div key={i} className={`chat-row ${m.role === 'user' ? 'right' : 'left'}`}>
                      <div className={`chat-bubble ${m.role === 'user' ? 'user' : 'ai'}`}>
                        <div>{m.text}</div>
                        <div className='chat-time'>{formatTime(m.ts)}</div>
                      </div>
                    </div>
                  ))}
                  {isTyping && (
                    <div className='chat-row left'>
                      <div className='chat-bubble ai typing-bubble'>
                        <span className='typing-dot' />
                        <span className='typing-dot' />
                        <span className='typing-dot' />
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                <div className='chat-input-sticky'>
                  <input
                    className='copilot-input'
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder='Ask for routes, signal plan, or alerts...'
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        sendMessage()
                      }
                    }}
                  />
                  <button
                    className={`chat-voice-btn ${isListening ? 'listening' : ''}`}
                    onClick={toggleVoice}
                    title="Voice Input"
                  >
                    {isListening ? <MicOff size={18} /> : <Mic size={18} />}
                  </button>
                  <button className='chat-send-btn' onClick={sendMessage} disabled={!chatInput.trim() || isTyping}>Send</button>
                </div>
              </aside>
            </div>
            </div>
          </div>

        <div className='rounded-xl border border-gray-200 bg-white shadow-sm'>
          <PlaybackBar
            frameIdx={frameIdx}
            totalFrames={totalFrames}
            currentTs={currentTs}
            isPlaying={isPlaying}
            setIsPlaying={setIsPlaying}
            playSpeed={playSpeed}
            setPlaySpeed={setPlaySpeed}
            goToFrame={goToFrame}
            resetPlayback={resetPlayback}
            incidentCount={incidentCount}
            congestedCount={congestedCount}
            avgSpeed={avgSpeed}
            networkHealth={networkHealth}
          />
        </div>
      </div>
      {pendingSegment && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center gap-3 text-red-600">
              <AlertTriangle size={24} className="animate-pulse" />
              <h3 className="text-xl font-bold text-slate-900">Trigger Incident?</h3>
            </div>
            <p className="mt-3 text-sm text-slate-600">
              You are about to report a traffic incident on:
            </p>
            <div className="mt-2 rounded-lg bg-slate-50 p-3 border border-slate-100">
              <div className="text-sm font-semibold text-slate-800">{pendingSegment.street_name || 'Unnamed Segment'}</div>
              <div className="text-xs text-slate-500 mt-0.5">Segment ID: {pendingSegment.seg_id}</div>
              <div className="text-xs text-slate-500">Live Speed: {pendingSegment.speed} km/h</div>
            </div>
            
            <div className="mt-4">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">Incident Type</label>
              <select
                value={incidentType}
                onChange={(e) => setIncidentType(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                <option value="ACCIDENT">🚗 Accident / Car Crash</option>
                <option value="ROAD_CLOSED">🚧 Road Closed / Construction</option>
              </select>
            </div>

            <p className="mt-4 text-xs text-slate-500">
              This will pause playback and calculate AI response guidance for the command center.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                onClick={() => setPendingSegment(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-red-700 hover:scale-105 active:scale-95 transition-all"
                onClick={async () => {
                  const seg = pendingSegment
                  setPendingSegment(null)
                  await confirmTriggerIncident(seg)
                }}
              >
                Confirm Report
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resolve Confirmation Modal */}
      {resolveTarget && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999, padding: 16
        }}>
          <div style={{
            background: '#ffffff', padding: 24, borderRadius: 12,
            maxWidth: 400, width: '100%', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)'
          }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>Confirm Resolution</h3>
            <p style={{ fontSize: 13, color: '#475569', marginTop: 8 }}>
              Are you sure you want to resolve incident <strong>{resolveTarget}</strong>? This action will remove its active status and clear its diversion route from the dashboard.
            </p>
            <div style={{ display: 'flex', gap: 12, marginTop: 20, justifyContent: 'flex-end' }}>
              <button
                style={{
                  padding: '8px 16px', borderRadius: 8, border: '1px solid #cbd5e1',
                  background: '#ffffff', color: '#334155', fontSize: 13, fontWeight: 600, cursor: 'pointer'
                }}
                onClick={() => setResolveTarget(null)}
              >
                Cancel
              </button>
              <button
                style={{
                  padding: '8px 16px', borderRadius: 8, border: 'none',
                  background: '#dc2626', color: '#ffffff', fontSize: 13, fontWeight: 600, cursor: 'pointer'
                }}
                onClick={() => {
                  resolveIncident(resolveTarget)
                  setResolveTarget(null)
                  setSelectedIncidentId(null)
                }}
              >
                Confirm Resolve
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Details / Intel Modal */}
      {showDetailsId && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999, padding: 24
        }}>
          <div style={{
            background: '#ffffff', borderRadius: 16, maxWidth: 900, width: '100%',
            maxHeight: '90vh', display: 'flex', flexDirection: 'column',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', overflow: 'hidden'
          }}>
            {/* Modal Header */}
            <div style={{
              padding: '18px 24px', background: '#0f172a', color: '#ffffff',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center'
            }}>
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 700 }}>Incident Intelligence Brief</h3>
                <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                  Real-time diagnostics and response plans for <strong>{showDetailsId}</strong>
                </p>
              </div>
              <button
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 24, cursor: 'pointer' }}
                onClick={() => setShowDetailsId(null)}
              >
                &times;
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: 24, overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  AI Response Plans
                </h4>
                <div style={{ marginTop: 8 }}>
                  <InsightsBar insights={insights} />
                </div>
              </div>

              <div>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  A* Routing Process Logs
                </h4>
                <div style={{ marginTop: 8, border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
                  <DebugPanel incidentId={showDetailsId} enabled={dataSource === 'api'} />
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div style={{ padding: '16px 24px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', background: '#f8fafc' }}>
              <button
                style={{
                  padding: '8px 20px', borderRadius: 8, border: '1px solid #cbd5e1',
                  background: '#ffffff', color: '#334155', fontSize: 13, fontWeight: 600, cursor: 'pointer'
                }}
                onClick={() => setShowDetailsId(null)}
              >
                Close intel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
