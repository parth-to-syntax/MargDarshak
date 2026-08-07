import { useState, useEffect, useRef, useCallback } from 'react'
import Papa from 'papaparse'
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const isAbortError = (error) => error?.name === 'AbortError'

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

const fireAndForgetControl = async (url) => {
  try {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 1200)
    await fetch(url, { signal: controller.signal, credentials: 'include' })
  } catch { }
}

export function useFeed() {
  const [isLoaded, setIsLoaded] = useState(false)
  const [mode, setMode] = useState('api')
  const [isPlaying, setIsPlaying] = useState(false)
  const [playSpeed, setPlaySpeed] = useState(800)
  const [frameIdx, setFrameIdx] = useState(0)
  const [totalFrames, setTotalFrames] = useState(0)
  const [segments, setSegments] = useState([])
  const [roadFeed, setRoadFeed] = useState([])
  const [incident, setIncident] = useState(null)
  const [incidentLog, setIncidentLog] = useState([])
  const [currentTs, setCurrentTs] = useState('')
  const [csvFrames, setCsvFrames] = useState([])
  const [metrics, setMetrics] = useState({
    total_vehicles: 0,
    avg_speed: 0,
    network_health: 100,
    incident_count: 0,
    congestion_count: 0,
  })

  const pollTimerRef = useRef(null)
  const csvTimerRef = useRef(null)
  const pollingRef = useRef(false)
  const controlQueueRef = useRef(Promise.resolve())
  const failuresRef = useRef(0)
  const incidentLogRef = useRef([])
  const frameIdxRef = useRef(0)

  const pollIncidents = useCallback(async () => {
    if (mode !== 'api') return
    try {
      const data = await fetchJsonWithTimeout(`${API}/incidents`, 4500)
      if (Array.isArray(data.active) || Array.isArray(data.resolved)) {
        const fullLog = [...(data.active || []), ...(data.resolved || [])]
        incidentLogRef.current = fullLog
        setIncidentLog(fullLog)
        setIncident((data.active || [])[0] || null)
      }
    } catch { }
  }, [mode])

  const acknowledgeIncident = useCallback(async (incidentId) => {
    incidentLogRef.current = incidentLogRef.current.map((entry) =>
      entry.id === incidentId ? { ...entry, acknowledged_at: new Date().toISOString() } : entry
    )
    setIncidentLog([...incidentLogRef.current])

    if (mode === 'api') {
      try {
        await fetch(`${API}/incident/acknowledge/${incidentId}`, { method: 'POST', credentials: 'include' })
        pollIncidents()
      } catch (err) {
        console.warn('Backend acknowledgment failed:', err)
      }
    }
  }, [mode, pollIncidents])

  const resolveIncident = useCallback(async (incidentId) => {
    incidentLogRef.current = incidentLogRef.current.map((entry) =>
      entry.id === incidentId ? { ...entry, status: 'RESOLVED', resolved_at: new Date().toISOString(), diversion_route: null } : entry
    )
    setIncidentLog([...incidentLogRef.current])
    setIncident((prev) => (prev && prev.id === incidentId ? null : prev))
    setIsPlaying(true)

    if (mode === 'api') {
      try {
        await fetch(`${API}/incident/resolve/${incidentId}`, { method: 'POST', credentials: 'include' })
        pollIncidents()
      } catch (err) {
        console.warn('Backend resolution failed:', err)
      }
    }
  }, [mode, pollIncidents])

  const applyMappedSegments = useCallback((mappedSegments, ts, tsIndex, total, maybeMetrics) => {
    setSegments(mappedSegments)
    setFrameIdx(tsIndex)
    setTotalFrames(total)
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

    const active = mappedSegments.filter((segment) => segment.incident_type === 'ACCIDENT' || segment.incident_type === 'ROAD_CLOSED')
    const primary = active[0] || null

    if (primary) {
      const nextIncident = {
        id: primary.incident_id || `INC_${String(tsIndex + 1).padStart(3, '0')}`,
        seg_id: primary.seg_id,
        location: primary.street_name,
        time: String(ts || '').split(' ')[1]?.slice(0, 8) || '',
        speed: Number(primary.speed || 0),
        type: primary.incident_type,
        severity: Number(primary.severity || 1),
        lat: Number(primary.lat || 0),
        lng: Number(primary.lng || 0),
        seg_start_lat: Number(primary.seg_start_lat || 0),
        seg_start_lng: Number(primary.seg_start_lng || 0),
        seg_end_lat: Number(primary.seg_end_lat || 0),
        seg_end_lng: Number(primary.seg_end_lng || 0),
        status: 'ACTIVE',
      }
      setIncident(nextIncident)

      const key = `${nextIncident.seg_id}-${ts}`
      if (!incidentLogRef.current.find((entry) => entry.key === key)) {
        const item = {
          key,
          id: nextIncident.id,
          seg_id: nextIncident.seg_id,
          location: nextIncident.location,
          type: nextIncident.type,
          severity: nextIncident.severity,
          time: nextIncident.time,
          status: 'ACTIVE',
          lat: nextIncident.lat,
          lng: nextIncident.lng,
        }
        incidentLogRef.current = [item, ...incidentLogRef.current].slice(0, 40)
        setIncidentLog([...incidentLogRef.current])
      }
    } else {
      setIncident(null)
      if (incidentLogRef.current.some((entry) => entry.status === 'ACTIVE')) {
        incidentLogRef.current = incidentLogRef.current.map((entry) =>
          entry.status === 'ACTIVE' ? { ...entry, status: 'RESOLVED' } : entry
        )
        setIncidentLog([...incidentLogRef.current])
      }
    }
  }, [])

  const loadCsvFrames = useCallback(() => {
    if (csvFrames.length) return
    Papa.parse('/gandhinagar_traffic_feed.csv', {
      download: true,
      header: true,
      dynamicTyping: true,
      complete: (results) => {
        const rows = (results.data || []).filter((row) => row && row.seg_id)
        const grouped = {}
        for (const row of rows) {
          const ts = String(row.timestamp || '')
          if (!grouped[ts]) grouped[ts] = []
          grouped[ts].push(row)
        }

        const frames = Object.entries(grouped)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([ts, segs]) => ({
            ts,
            segs: segs.map((segment) => ({
              ...segment,
              speed: Number(segment.speed || 0),
              free_flow: Number(segment.free_flow_speed || segment.free_flow || 0),
              free_flow_speed: Number(segment.free_flow_speed || segment.free_flow || 0),
              severity: Number(segment.severity || 1),
              vehicle_count: Number(segment.vehicle_count || 0),
              lat: Number(segment.lat || 0),
              lng: Number(segment.lng || 0),
              s1lat: Number(segment.seg_start_lat || 0),
              s1lng: Number(segment.seg_start_lng || 0),
              s2lat: Number(segment.seg_end_lat || 0),
              s2lng: Number(segment.seg_end_lng || 0),
              color: speedColor(Number(segment.speed || 0), Number(segment.free_flow_speed || 1)),
            })),
          }))

        setCsvFrames(frames)
        setTotalFrames(frames.length || 0)
        if (frames.length > 0) {
          applyMappedSegments(
            frames[0].segs.map((segment) => ({
              ...segment,
              seg_start_lat: segment.s1lat,
              seg_start_lng: segment.s1lng,
              seg_end_lat: segment.s2lat,
              seg_end_lng: segment.s2lng,
            })),
            frames[0].ts,
            0,
            frames.length,
            undefined
          )
        }
      },
      error: () => {
        setIsLoaded(true)
      },
    })
  }, [applyMappedSegments, csvFrames.length])

  const switchToCsvMode = useCallback(() => {
    setMode('csv')
    setIsPlaying(true)
    loadCsvFrames()
  }, [loadCsvFrames])

  const pollApiFeed = useCallback(async ({ force = false } = {}) => {
    if (mode !== 'api') return
    if (pollingRef.current && !force) return
    if (pollingRef.current && force) {
      const started = Date.now()
      while (pollingRef.current && Date.now() - started < 1200) {
        await sleep(30)
      }
      if (pollingRef.current) return
    }

    pollingRef.current = true
    try {
      const data = await fetchJsonWithTimeout(`${API}/feed`, 5000)
      failuresRef.current = 0
      if (typeof data.tick_sleep_ms === 'number' && data.tick_sleep_ms > 0) {
        setPlaySpeed((prev) => (prev === data.tick_sleep_ms ? prev : data.tick_sleep_ms))
      }
      if (typeof data.playing === 'boolean') {
        setIsPlaying(data.playing)
      }

      const mapped = (data.segments || []).map((segment) => ({
        ...segment,
        seg_start_lat: segment.s1lat,
        seg_start_lng: segment.s1lng,
        seg_end_lat: segment.s2lat,
        seg_end_lng: segment.s2lng,
      }))

      applyMappedSegments(mapped, data.timestamp, data.ts_index, data.total, data.metrics)
    } catch (error) {
      failuresRef.current += 1
      if (failuresRef.current >= 30) {
        switchToCsvMode()
      }
      if (error?.name !== 'AbortError') {
        console.warn('Feed poll unavailable. Retrying or switching to CSV mode.')
      }
    } finally {
      pollingRef.current = false
    }
  }, [applyMappedSegments, mode, switchToCsvMode])

  useEffect(() => {
    frameIdxRef.current = frameIdx
  }, [frameIdx])

  const enqueueControl = useCallback((task) => {
    controlQueueRef.current = controlQueueRef.current
      .then(task)
      .catch((error) => {
        if (!isAbortError(error)) {
          console.error('Playback control failed:', error)
        }
      })
    return controlQueueRef.current
  }, [])

  // API polling mode.
  useEffect(() => {
    if (mode !== 'api' || !isPlaying) return undefined
    const pollIntervalMs = Math.max(600, playSpeed)
    pollApiFeed({ force: true })
    pollTimerRef.current = setInterval(() => {
      void pollApiFeed()
    }, pollIntervalMs)
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
  }, [mode, isPlaying, playSpeed, pollApiFeed])

  // CSV playback mode.
  useEffect(() => {
    if (mode !== 'csv' || !isPlaying || !csvFrames.length) return undefined
    csvTimerRef.current = setInterval(() => {
      const next = frameIdxRef.current + 1 >= csvFrames.length ? 0 : frameIdxRef.current + 1
      const frame = csvFrames[next]
      const mapped = frame.segs.map((segment) => ({
        ...segment,
        seg_start_lat: segment.s1lat,
        seg_start_lng: segment.s1lng,
        seg_end_lat: segment.s2lat,
        seg_end_lng: segment.s2lng,
      }))
      frameIdxRef.current = next
      setFrameIdx(next)
      applyMappedSegments(mapped, frame.ts, next, csvFrames.length, undefined)
    }, playSpeed)

    return () => {
      if (csvTimerRef.current) clearInterval(csvTimerRef.current)
    }
  }, [mode, isPlaying, playSpeed, csvFrames, applyMappedSegments])



  // Incident polling from backend only in API mode.
  useEffect(() => {
    if (mode !== 'api') return undefined
    void pollIncidents()
    const id = setInterval(pollIncidents, 3000)
    return () => clearInterval(id)
  }, [mode, pollIncidents])

  const setIsPlayingWrapped = useCallback(async (value) => {
    if (mode === 'csv') {
      setIsPlaying(Boolean(value))
      return
    }

    return enqueueControl(async () => {
      await fireAndForgetControl(`${API}/control?action=${value ? 'play' : 'pause'}`)
      setIsPlaying(Boolean(value))
      await pollApiFeed({ force: true })
    })
  }, [enqueueControl, mode, pollApiFeed])

  const setPlaySpeedWrapped = useCallback(async (ms) => {
    const speed = Math.max(120, Number(ms) || 800)
    setPlaySpeed(speed)

    if (mode === 'csv') return

    return enqueueControl(async () => {
      await fireAndForgetControl(`${API}/control?action=speed&speed_ms=${speed}`)
      if (!isPlaying) {
        await fireAndForgetControl(`${API}/control?action=play`)
        setIsPlaying(true)
      }
      await pollApiFeed({ force: true })
    })
  }, [enqueueControl, isPlaying, mode, pollApiFeed])

  const goToFrame = useCallback(async (index) => {
    const safe = Math.max(0, Math.min((totalFrames || 1) - 1, Number(index) || 0))

    if (mode === 'csv') {
      if (!csvFrames.length) return
      const frame = csvFrames[safe]
      const mapped = frame.segs.map((segment) => ({
        ...segment,
        seg_start_lat: segment.s1lat,
        seg_start_lng: segment.s1lng,
        seg_end_lat: segment.s2lat,
        seg_end_lng: segment.s2lng,
      }))
      setFrameIdx(safe)
      frameIdxRef.current = safe
      applyMappedSegments(mapped, frame.ts, safe, csvFrames.length, undefined)
      return
    }

    return enqueueControl(async () => {
      const wasPlaying = isPlaying
      if (wasPlaying) {
        await fireAndForgetControl(`${API}/control?action=pause`)
        setIsPlaying(false)
      }
      const data = await fetchJsonWithTimeout(`${API}/control?action=seek&frame=${safe}`, 5000)
      setFrameIdx(data.ts_index)
      await pollApiFeed({ force: true })
      if (wasPlaying) {
        await fireAndForgetControl(`${API}/control?action=play`)
        setIsPlaying(true)
      }
      await pollApiFeed({ force: true })
    })
  }, [applyMappedSegments, csvFrames, enqueueControl, isPlaying, mode, pollApiFeed, totalFrames])

  const resetPlayback = useCallback(async () => {
    if (mode === 'csv') {
      if (!csvFrames.length) return
      const frame = csvFrames[0]
      const mapped = frame.segs.map((segment) => ({
        ...segment,
        seg_start_lat: segment.s1lat,
        seg_start_lng: segment.s1lng,
        seg_end_lat: segment.s2lat,
        seg_end_lng: segment.s2lng,
      }))
      setFrameIdx(0)
      frameIdxRef.current = 0
      setIsPlaying(false)
      applyMappedSegments(mapped, frame.ts, 0, csvFrames.length, undefined)
      return
    }

    return enqueueControl(async () => {
      await fireAndForgetControl(`${API}/control?action=pause`)
      setIsPlaying(false)
      const data = await fetchJsonWithTimeout(`${API}/control?action=reset`, 5000)
      setFrameIdx(data.ts_index)
      await pollApiFeed({ force: true })
    })
  }, [applyMappedSegments, csvFrames, enqueueControl, mode, pollApiFeed])

  // On first load, reset and start at T=0
  useEffect(() => {
    resetPlayback()
  }, [resetPlayback])

  useEffect(() => {
    if (mode === 'csv') loadCsvFrames()
  }, [mode, loadCsvFrames])

  // Expose for Dashboard
  if (typeof window !== 'undefined') {
    window.useFeedAcknowledge = acknowledgeIncident
    window.useFeedResolve = resolveIncident
    window.useFeedPollIncidents = pollIncidents
  }
  return {
    isLoaded,
    dataSource: mode,
    isPlaying,
    setIsPlaying: setIsPlayingWrapped,
    playSpeed,
    setPlaySpeed: setPlaySpeedWrapped,
    frameIdx,
    totalFrames,
    goToFrame,
    resetPlayback,
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
