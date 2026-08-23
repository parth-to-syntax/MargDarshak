import { useState, useEffect, useRef, useCallback } from 'react'
import { API_BASE_URL } from '../config.js'

const API = API_BASE_URL
const WATCH_ROADS = [
  'GH Road',
  'CH Road',
  'Road 3',
  'KH Road',
  'G Road',
  'Ka Road',
  'Gandhinagar Bypass Road',
  'Road 2',
]

function speedColor(speed, freeFlow) {
  const ratio = freeFlow > 0 ? speed / freeFlow : 1
  if (ratio >= 0.85) return '#00AA00'
  if (ratio >= 0.65) return '#7DC900'
  if (ratio >= 0.45) return '#FFA500'
  if (ratio >= 0.25) return '#FF4500'
  return '#CC0000'
}

const fetchJsonWithTimeout = async (url, timeoutMs) => {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal, credentials: 'include' })
    clearTimeout(id)
    return await res.json()
  } catch (err) {
    clearTimeout(id)
    throw err
  }
}

export function useFeed() {
  const [isLoaded, setIsLoaded] = useState(false)
  const [segments, setSegments] = useState([])
  const [roadFeed, setRoadFeed] = useState([])
  const [incident, setIncident] = useState(null)
  const [incidentLog, setIncidentLog] = useState([])
  const [currentTs, setCurrentTs] = useState('')
  const [metrics, setMetrics] = useState({
    total_vehicles: 0,
    avg_speed: 0,
    network_health: 100,
    incident_count: 0,
    congestion_count: 0,
  })

  const pollingRef = useRef(false)

  const pollIncidents = useCallback(async () => {
    try {
      const data = await fetchJsonWithTimeout(`${API}/incidents`, 4500)
      if (Array.isArray(data.active) || Array.isArray(data.resolved)) {
        const fullLog = [...(data.active || []), ...(data.resolved || [])]
        setIncidentLog(fullLog)
        
        // Use first active incident as primary context
        setIncident((data.active || [])[0] || null)
      }
    } catch (e) {
      console.warn('Incident sync failed:', e)
    }
  }, [])

  const acknowledgeIncident = useCallback(async (incidentId) => {
    try {
      await fetch(`${API}/incident/acknowledge/${incidentId}`, { method: 'POST', credentials: 'include' })
      pollIncidents()
    } catch (err) {
      console.warn('Backend acknowledgment failed:', err)
    }
  }, [pollIncidents])

  const resolveIncident = useCallback(async (incidentId) => {
    try {
      await fetch(`${API}/incident/resolve/${incidentId}`, { method: 'POST', credentials: 'include' })
      pollIncidents()
    } catch (err) {
      console.warn('Backend resolution failed:', err)
    }
  }, [pollIncidents])

  const applyMappedSegments = useCallback((mappedSegments, ts, maybeMetrics) => {
    setSegments(mappedSegments)
    setCurrentTs(ts || '')
    setIsLoaded(true)
    window.dispatchEvent(new CustomEvent('playback-ts', { detail: ts || '' }))

    const nextMetrics = maybeMetrics || (() => {
      const totalVehicles = mappedSegments.reduce((sum, segment) => sum + Number(segment.vehicle_count || 0), 0)
      const avgSpeed = mappedSegments.length
        ? Number((mappedSegments.reduce((sum, segment) => sum + Number(segment.speed || 0), 0) / mappedSegments.length).toFixed(1))
        : 0
      const avgFreeFlow = mappedSegments.length
        ? mappedSegments.reduce((sum, segment) => sum + Number(segment.free_flow || segment.free_flow_speed || 0), 0) / mappedSegments.length
        : 1
      const incidentCount = mappedSegments.filter((segment) => segment.incident_type === 'ACCIDENT' || segment.incident_type === 'ROAD_CLOSED').length
      const congestionCount = mappedSegments.filter((segment) => segment.incident_type === 'CONGESTION').length
      return {
        total_vehicles: Math.round(totalVehicles),
        avg_speed: avgSpeed,
        network_health: avgFreeFlow > 0 ? Math.round((avgSpeed / avgFreeFlow) * 100) : 100,
        incident_count: incidentCount,
        congestion_count: congestionCount,
      }
    })()
    setMetrics(nextMetrics)

    const feed = WATCH_ROADS.map((roadName) => {
      const matches = mappedSegments.filter((segment) => segment.street_name === roadName)
      if (!matches.length) return null
      const avg = Math.round(matches.reduce((sum, segment) => sum + Number(segment.speed || 0), 0) / matches.length)
      const ff = Number(matches[0].free_flow || matches[0].free_flow_speed || 1)
      const incidentType = matches.find((segment) => segment.incident_type === 'ACCIDENT' || segment.incident_type === 'ROAD_CLOSED')?.incident_type
        || (matches.find((segment) => segment.incident_type === 'CONGESTION') ? 'CONGESTION' : 'CLEAR')
      return { name: roadName, speed: avg, freeFlow: ff, color: speedColor(avg, ff), inc: incidentType }
    }).filter(Boolean)
    setRoadFeed(feed)
  }, [])

  const pollApiFeed = useCallback(async () => {
    if (pollingRef.current) return
    pollingRef.current = true
    try {
      const data = await fetchJsonWithTimeout(`${API}/feed`, 5000)
      const mapped = (data.segments || []).map((segment) => ({
        ...segment,
        seg_start_lat: segment.s1lat,
        seg_start_lng: segment.s1lng,
        seg_end_lat: segment.s2lat,
        seg_end_lng: segment.s2lng,
      }))
      applyMappedSegments(mapped, data.timestamp, data.metrics)
    } catch (error) {
      console.warn('Feed polling unavailable:', error)
    } finally {
      pollingRef.current = false
    }
  }, [applyMappedSegments])

  // Periodic polling for sync
  useEffect(() => {
    void pollApiFeed()
    void pollIncidents()

    const feedTimer = setInterval(pollApiFeed, 2000)
    const incidentsTimer = setInterval(pollIncidents, 2000)

    return () => {
      clearInterval(feedTimer)
      clearInterval(incidentsTimer)
    }
  }, [pollApiFeed, pollIncidents])

  // Expose callbacks for global window actions
  if (typeof window !== 'undefined') {
    window.useFeedAcknowledge = acknowledgeIncident
    window.useFeedResolve = resolveIncident
    window.useFeedPollIncidents = pollIncidents
  }

  return {
    isLoaded,
    dataSource: 'api',
    isPlaying: false,
    setIsPlaying: () => {},
    playSpeed: 1000,
    setPlaySpeed: () => {},
    frameIdx: 0,
    totalFrames: 1,
    goToFrame: () => {},
    resetPlayback: () => {},
    acknowledgeIncident,
    resolveIncident,
    currentFrame: segments,
    roadFeed,
    incident,
    incidentLog,
    currentTs,
    incidentCount: metrics.incident_count || 0,
    congestedCount: metrics.congestion_count || 0,
    avgSpeed: metrics.avg_speed || 0,
    networkHealth: metrics.network_health || 100,
  }
}
