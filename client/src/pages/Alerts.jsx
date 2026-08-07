import { useState, useEffect, useRef } from 'react'
import {
  Activity,
  Megaphone,
  Radio,
} from 'lucide-react'
import { API_BASE_URL } from '../config.js'

const API = API_BASE_URL
const MAX = 160
const DEFAULTS = { VMS: '', RADIO: '', SOCIAL: '' }

// Removed loadRatio since chart logic moved to Insights

function HeaderCard({ activeInc, statusTag }) {
  let friendlyName = activeInc?.id || 'Unknown'
  if (activeInc) {
    const isConstruction = activeInc.type === 'ROAD_CLOSED'
    const hash = Array.from(activeInc.id || '').reduce((sum, char) => sum + char.charCodeAt(0), 0)
    friendlyName = isConstruction ? 'Construction' : (hash % 2 === 0 ? 'Car Crash' : 'Truck Crash')
  }

  return (
    <header className="rounded-xl border border-gray-200 bg-white p-5 shadow-md transition-all duration-200 hover:shadow-lg">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-4xl font-semibold text-slate-900 lg:text-5xl">Alert Command Center</h1>
          <p className="mt-2 text-lg leading-relaxed text-slate-600">Generate and manage multi-channel traffic alerts.</p>
        </div>
      </div>

      {activeInc && (
        <div className="mt-5 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-700">
              <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" /> INCIDENT
            </span>
            <span className="text-lg font-semibold text-slate-800">{friendlyName} · {activeInc.location}</span>
            <span className="rounded-full bg-orange-100 px-2 py-1 text-xs font-semibold text-orange-700">{statusTag}</span>
          </div>
        </div>
      )}
    </header>
  )
}

// Removed KpiCard and SectionCard

function AlertCard({ channel, icon, text, onTextChange, onPublish, incidentId }) {
  const pct = Math.min((text.length / MAX) * 100, 100)
  const btnLabels = { VMS: 'Publish to VMS', RADIO: 'Send to Radio', SOCIAL: 'Post to Social' }

  return (
    <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-md transition-all duration-200 hover:shadow-lg">
      <div className="flex items-center justify-between text-lg font-semibold text-slate-800">
        <div className="flex flex-wrap items-center gap-2">
          {icon} {channel}
        </div>
        {channel === 'RADIO' && (
          <button 
            onClick={() => {
              if (!window.speechSynthesis) return;
              const utterance = new SpeechSynthesisUtterance(text);
              const voices = window.speechSynthesis.getVoices();
              const edgeVoice = voices.find((v) => v.name.includes('Edge') || v.name.includes('Microsoft'));
              if (edgeVoice) utterance.voice = edgeVoice;
              window.speechSynthesis.speak(utterance);
            }}
            className="flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-200 hover:text-slate-800"
            title="Read out loud (Edge TTS)"
          >
            🔊 Play TTS
          </button>
        )}
      </div>
      <textarea
        className="mt-3 min-h-[110px] w-full rounded-lg border border-gray-200 bg-slate-50 p-3 text-base text-slate-700"
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        placeholder={`Write ${channel} alert copy...`}
      />
      <div className="mt-2 text-sm text-slate-500">{text.length} / {MAX}</div>
      <div className="mt-2 h-1.5 rounded-full bg-slate-200">
        <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
      </div>
      <button
        className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:scale-105 hover:bg-blue-700"
        onClick={() => {
          onPublish(channel, text, incidentId)
          if (channel === 'RADIO' && window.speechSynthesis) {
            const utterance = new SpeechSynthesisUtterance(text)
            const voices = window.speechSynthesis.getVoices()
            const edgeVoice = voices.find(v => v.name.includes('Edge') || v.name.includes('Microsoft'))
            if (edgeVoice) utterance.voice = edgeVoice
            window.speechSynthesis.speak(utterance)
          }
        }}
      >
        {btnLabels[channel]}
      </button>
    </article>
  )
}

export default function Alerts() {
  const [texts, setTexts] = useState(DEFAULTS)
  const [log, setLog] = useState([])
  const [activeInc, setActiveInc] = useState(null)

  useEffect(() => {
    const poll = async () => {
      try {
        const response = await fetch(`${API}/incidents`, { credentials: 'include' })
        const data = await response.json()
        setActiveInc(data.active?.[0] || null)
      } catch {}
    }
    poll()
    const timer = setInterval(poll, 3000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!activeInc) return
    fetch(`${API}/insights/${activeInc.id}`, { credentials: 'include' })
      .then((response) => response.json())
      .then((data) => {
        if (!data.alerts) return
        setTexts((previous) => ({
          VMS: previous.VMS || data.alerts.vms || '',
          RADIO: previous.RADIO || data.alerts.radio || '',
          SOCIAL: previous.SOCIAL || data.alerts.social || '',
        }))
      })
      .catch(() => {})
  }, [activeInc?.id])

  useEffect(() => {
    const poll = async () => {
      try {
        const response = await fetch(`${API}/publish_log`, { credentials: 'include' })
        setLog(await response.json())
      } catch {}
    }
    poll()
    const timer = setInterval(poll, 2200)
    return () => clearInterval(timer)
  }, [])

  // Removed feed polling logic from Alerts

  const handlePublish = async (channel, message, incidentId) => {
    if (!message.trim()) return

    if (channel === 'SOCIAL') {
      const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(message)}`
      window.open(intentUrl, '_blank')
    }

    try {
      await fetch(`${API}/publish`, {
        credentials: 'include',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, message, incident_id: incidentId || '' }),
      })
      setTexts((previous) => ({ ...previous, [channel]: '' }))
    } catch {}
  }

  // Removed bottleneck, road statistics, and mix logic

  return (
    <div className="ai-page">
      <main className="mx-auto w-full max-w-7xl px-6 py-8">
        <HeaderCard activeInc={activeInc} statusTag={(activeInc?.status || 'ACTIVE').replace('_', ' ')} />

        <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <AlertCard channel="VMS" icon={<Megaphone size={16} />} text={texts.VMS} onTextChange={(value) => setTexts((prev) => ({ ...prev, VMS: value }))} onPublish={handlePublish} incidentId={activeInc?.id || ''} />
          <AlertCard channel="RADIO" icon={<Radio size={16} />} text={texts.RADIO} onTextChange={(value) => setTexts((prev) => ({ ...prev, RADIO: value }))} onPublish={handlePublish} incidentId={activeInc?.id || ''} />
          <AlertCard channel="SOCIAL" icon={<Activity size={16} />} text={texts.SOCIAL} onTextChange={(value) => setTexts((prev) => ({ ...prev, SOCIAL: value }))} onPublish={handlePublish} incidentId={activeInc?.id || ''} />
        </section>

        <section className="mt-8 rounded-xl border border-gray-200 bg-white p-5 shadow-md">
          <h3 className="text-xl font-semibold text-slate-900">Publish Log</h3>
          {log.length === 0 ? (
            <p className="mt-3 text-base text-slate-500">No alerts published yet.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {log.map((entry, index) => (
                <div key={index} className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${
                      entry.status === 'success' ? 'bg-emerald-100 text-emerald-700' : 
                      entry.status === 'log_only' ? 'bg-blue-100 text-blue-700' : 
                      'bg-red-100 text-red-700'
                    }`}>
                      {entry.channel} {entry.status && entry.status !== 'success' && entry.status !== 'log_only' ? ` · ERROR: ${entry.status}` : ''}
                    </span>
                    <span>{entry.time}</span>
                    <span className="font-mono">{entry.incident_id}</span>
                  </div>
                  <p className="mt-2 text-base text-slate-800">{entry.message}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
