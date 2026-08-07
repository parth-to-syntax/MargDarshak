import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Flame, Mic, RadioTower, Shield, Stethoscope, TrafficCone } from 'lucide-react'
import { API_BASE_URL } from '../config.js'

const CHANNELS = [
  { id: 'police', name: 'Police Dispatch', color: '#2563eb', icon: Shield, placeholder: 'e.g. "Collision near CH Road, major injury reported"' },
  { id: 'fire', name: 'Fire & Rescue', color: '#2563eb', icon: Flame, placeholder: 'e.g. "Engine fire on Sector 21 road, hazards active"' },
  { id: 'ems', name: 'Medical / EMS', color: '#2563eb', icon: Stethoscope, placeholder: 'e.g. "Ambulance dispatcher request at Sector 11 crossing"' },
  { id: 'traffic', name: 'Traffic Control', color: '#2563eb', icon: TrafficCone, placeholder: 'e.g. "Heavy congestion near GH Road, lanes blocked"' },
]

async function fetchWithTimeout(url, options = {}, timeoutMs = 18000) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, credentials: 'include' })
    return response
  } finally {
    clearTimeout(timeoutId)
  }
}

export default function Radio() {
  const [activeChannelId, setActiveChannelId] = useState(null)
  const [isRecording, setIsRecording] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [transcriptText, setTranscriptText] = useState('')
  const [communicationLog, setCommunicationLog] = useState([])
  const [errorMessage, setErrorMessage] = useState('')

  const mediaRecorderRef = useRef(null)
  const mediaStreamRef = useRef(null)
  const chunksRef = useRef([])
  const pointerHeldRef = useRef(false)
  const activeChannelRef = useRef(null)

  const currentChannel = useMemo(
    () => CHANNELS.find((channel) => channel.id === activeChannelId) || null,
    [activeChannelId]
  )

  const extractedInsights = useMemo(() => {
    const text = transcriptText.trim()
    const normalized = text.toLowerCase()

    const severity = /major|severe|critical|multi-vehicle|pileup|fire/.test(normalized)
      ? 'High'
      : /slowdown|minor|stalled/.test(normalized)
      ? 'Medium'
      : 'Low'

    const locationMatch = text.match(/(?:at|near|on)\s+([A-Za-z0-9\-\s]{3,40})/i)
    const location = locationMatch?.[1]?.trim() || 'Location pending confirmation'

    const incidentType = /fire/.test(normalized)
      ? 'Fire Incident'
      : /ambulance|injur|medical|ems/.test(normalized)
      ? 'Medical Emergency'
      : /crash|accident|collision/.test(normalized)
      ? 'Road Accident'
      : /jam|congestion|traffic/.test(normalized)
      ? 'Traffic Congestion'
      : 'Incident Under Review'

    const suggestedAction = severity === 'High'
      ? 'Activate diversion plan and dispatch nearest response units.'
      : severity === 'Medium'
      ? 'Issue lane advisory and monitor signal timing adjustments.'
      : 'Log event and continue observation from command center.'

    return { incidentType, location, severity, suggestedAction }
  }, [transcriptText])

  const stopAllTracks = useCallback(() => {
    if (!mediaStreamRef.current) return
    for (const track of mediaStreamRef.current.getTracks()) {
      track.stop()
    }
    mediaStreamRef.current = null
  }, [])

  const submitAudio = useCallback(async (channel, blob) => {
    setIsSubmitting(true)
    setErrorMessage('')

    try {
      const form = new FormData()
      form.append('audio', blob, `dispatch_${channel.id}.webm`)
      form.append('channel', channel.id)

      const response = await fetchWithTimeout(
        `${API_BASE_URL}/incident/voice-audio`,
        { method: 'POST', body: form },
        25000
      )

      const data = await response.json()
      if (!response.ok) {
        const detail = data?.detail
        const message = typeof detail === 'string'
          ? detail
          : detail?.message || 'Audio incident registration failed'
        throw new Error(message)
      }

      const transcript = (data?.transcript || '').trim()
      if (transcript) setTranscriptText(transcript)

      const logEntry = {
        id: Date.now(),
        time: new Date().toLocaleTimeString(),
        channel: channel.name,
        summary: transcript || 'Audio processed, incident registered.',
        status: data?.error ? 'ERROR' : 'REPORTED',
        incidentId: data?.id || null,
      }
      setCommunicationLog((previous) => [logEntry, ...previous])
    } catch (error) {
      setErrorMessage(error?.name === 'AbortError' ? 'Audio request timed out. Backend may be down.' : (error.message || 'Audio processing failed'))
      setCommunicationLog((previous) => [
        {
          id: Date.now(),
          time: new Date().toLocaleTimeString(),
          channel: channel.name,
          summary: 'Audio capture failed to register incident.',
          status: 'ERROR',
          incidentId: null,
        },
        ...previous,
      ])
    } finally {
      setIsSubmitting(false)
      setIsRecording(false)
      setActiveChannelId(null)
    }
  }, [])

  const stopPushToTalk = useCallback(() => {
    pointerHeldRef.current = false
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    }
  }, [])

  const startPushToTalk = useCallback(async (channel) => {
    if (isSubmitting || isRecording) return
    pointerHeldRef.current = true
    activeChannelRef.current = channel
    setErrorMessage('')
    setTranscriptText('')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream

      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      mediaRecorderRef.current = recorder
      chunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        mediaRecorderRef.current = null
        stopAllTracks()
        if (blob.size < 256) {
          setIsRecording(false)
          setActiveChannelId(null)
          activeChannelRef.current = null
          setErrorMessage('Audio too short. Hold mic button a bit longer.')
          return
        }
        await submitAudio(channel, blob)
        activeChannelRef.current = null
      }

      recorder.start(200)
      setActiveChannelId(channel.id)
      setIsRecording(true)
    } catch (error) {
      setIsRecording(false)
      setActiveChannelId(null)
      activeChannelRef.current = null
      stopAllTracks()
      setErrorMessage('Microphone access denied or unavailable.')
    }
  }, [isRecording, isSubmitting, stopAllTracks, submitAudio])

  useEffect(() => {
    if (!isRecording) return undefined

    const release = () => {
      if (pointerHeldRef.current) stopPushToTalk()
    }

    window.addEventListener('pointerup', release)
    window.addEventListener('mouseup', release)
    window.addEventListener('touchend', release)
    window.addEventListener('blur', release)

    return () => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('mouseup', release)
      window.removeEventListener('touchend', release)
      window.removeEventListener('blur', release)
    }
  }, [isRecording, stopPushToTalk])

  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current
      if (recorder && recorder.state !== 'inactive') recorder.stop()
      stopAllTracks()
    }
  }, [stopAllTracks])

  const handlePointerDown = (event, channel) => {
    event.preventDefault()
    if (event.currentTarget.setPointerCapture) {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    void startPushToTalk(channel)
  }

  const handlePointerUp = (event, channel) => {
    event.preventDefault()
    if (event.currentTarget.releasePointerCapture && event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    stopPushToTalk()
  }

  const getChannelStatus = (channelId) => {
    if (isRecording && activeChannelId === channelId) return 'Listening'
    if (isSubmitting && activeChannelId === channelId) return 'Active'
    return 'Idle'
  }

  const renderWaveform = (channel) => {
    if (!(isRecording && activeChannelId === channel.id)) return null
    return (
      <div className="mt-4 flex h-8 items-end justify-center gap-1">
        {[10, 18, 13, 24, 15, 20].map((height, index) => (
          <span
            key={`${channel.id}-${height}-${index}`}
            className="w-1.5 rounded-full bg-current/75 animate-pulse"
            style={{ height: `${height}px`, animationDelay: `${index * 120}ms` }}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="ai-page text-lg">
      <main className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-8 px-6 py-10 lg:grid-cols-[1.1fr_1fr]">
        <section>
          <header className="mb-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-base font-semibold text-slate-600 shadow-sm">
              <RadioTower className="h-4 w-4" />
              Ground Radio Simulation
            </div>
            <h1 className="mt-4 text-4xl font-semibold leading-tight text-slate-900 lg:text-5xl">
              Voice Command Hub
            </h1>
            <p className="mt-4 max-w-3xl text-lg leading-relaxed text-slate-600">
              Hold any channel mic to capture audio and register an incident directly from speech.
            </p>
          </header>

          {errorMessage && (
            <div className="mb-6 rounded-xl border border-red-200 bg-white p-4 text-sm font-medium text-red-600">
              {errorMessage}
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {CHANNELS.map((channel) => {
              const Icon = channel.icon
              const status = getChannelStatus(channel.id)
              const isChannelListening = isRecording && activeChannelId === channel.id
              const isActive = status === 'Listening' || status === 'Active'

              return (
                <article
                  key={channel.id}
                  className="min-h-[200px] rounded-xl border border-gray-200 bg-white p-6 shadow-md transition-all duration-200 hover:shadow-lg"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ backgroundColor: `${channel.color}20`, color: channel.color }}>
                        <Icon className="h-5 w-5" />
                      </span>
                      <div>
                        <h2 className="text-lg font-semibold text-slate-900">{channel.name}</h2>
                        <p className="text-sm text-slate-500">Press and hold to transmit incident details.</p>
                      </div>
                    </div>
                    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold ${isActive ? 'animate-pulse bg-blue-100 text-blue-700' : 'border border-gray-200 bg-white text-slate-600'}`}>
                      {isActive ? 'Active' : 'Idle'}
                    </span>
                  </div>

                  <div className="mt-6 flex flex-col items-center justify-center">
                    <button
                      type="button"
                      onPointerDown={(event) => handlePointerDown(event, channel)}
                      onPointerUp={(event) => handlePointerUp(event, channel)}
                      onPointerCancel={(event) => handlePointerUp(event, channel)}
                      className="relative inline-flex h-16 w-16 items-center justify-center rounded-full bg-blue-600 text-white shadow-md transition-transform duration-150 active:scale-95"
                      style={{
                        backgroundColor: isChannelListening ? '#ef4444' : '#2563eb',
                        boxShadow: isChannelListening ? '0 0 0 10px rgba(239,68,68,0.18), 0 0 30px rgba(239,68,68,0.35)' : '0 0 20px rgba(37,99,235,0.2)',
                      }}
                    >
                      {isChannelListening && <span className="absolute inset-0 rounded-full animate-ping" style={{ backgroundColor: '#ef444455' }} />}
                      <Mic className="relative z-10 h-6 w-6" />
                    </button>
                    {renderWaveform(channel)}
                    <p className="mt-3 text-sm text-slate-500">{isChannelListening ? 'Listening...' : 'Push to Talk'}</p>
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        <section className="space-y-6">
          <article className="rounded-xl border border-gray-200 bg-white p-6 shadow-md">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-2xl font-semibold text-slate-900">Live Transcription</h2>
              {isSubmitting && <span className="text-base text-slate-500">Processing...</span>}
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-5 text-lg leading-relaxed" style={{ borderLeft: `5px solid ${currentChannel?.color || '#cbd5e1'}` }}>
              {transcriptText ? (
                <span className="text-slate-900">{transcriptText}</span>
              ) : (
                <span className="text-slate-500">
                  {currentChannel ? `Awaiting transmission: ${currentChannel.placeholder}` : 'Awaiting voice input from active channel...'}
                </span>
              )}
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Location</p>
                <p className="mt-1 text-lg leading-relaxed text-slate-900">{extractedInsights.location}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Incident Type</p>
                <p className="mt-1 text-lg leading-relaxed text-slate-900">{extractedInsights.incidentType}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Severity</p>
                <p className="mt-1 text-lg leading-relaxed text-slate-900">{extractedInsights.severity}</p>
              </div>
            </div>
          </article>

          <article className="rounded-xl border border-gray-200 bg-white p-6 shadow-md">
            <h3 className="text-xl font-semibold text-slate-900">AI Extracted Insights</h3>
            <ul className="mt-4 space-y-3 text-lg leading-relaxed text-slate-700">
              <li>• {extractedInsights.incidentType} detected {extractedInsights.location !== 'Location pending confirmation' ? `near ${extractedInsights.location}` : ''}</li>
              <li>• Severity: {extractedInsights.severity}</li>
              <li>• Suggested: {extractedInsights.suggestedAction}</li>
            </ul>
          </article>

          <article className="rounded-xl border border-gray-200 bg-white p-6 shadow-md">
            <h3 className="text-xl font-semibold text-slate-900">Communication Log</h3>
            <div className="mt-4 space-y-4">
              {communicationLog.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 text-lg leading-relaxed text-slate-500">
                  Incoming radio summaries will appear here as a live timeline.
                </div>
              ) : (
                communicationLog.map((entry) => (
                  <div key={entry.id} className="relative border-l-2 border-gray-200 pl-5">
                    <span className="absolute -left-[7px] top-2 h-3 w-3 rounded-full bg-sky-500" />
                    <div className="flex flex-wrap items-center gap-3 text-base text-slate-500">
                      <span>{entry.time}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-sm font-semibold text-slate-600">{entry.channel}</span>
                      <span className={entry.status === 'ERROR' ? 'text-red-600' : 'text-emerald-600'}>{entry.status}</span>
                    </div>
                    <p className="mt-2 text-lg leading-relaxed text-slate-800">{entry.summary}</p>
                    {entry.incidentId && <p className="mt-1 text-sm font-semibold text-blue-700">Incident: {entry.incidentId}</p>}
                  </div>
                ))
              )}
            </div>
          </article>
        </section>
      </main>
    </div>
  )
}
