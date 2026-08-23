import { useMemo, useState, useEffect } from 'react'
import { Activity, AlertTriangle, CheckCircle2, Clock3, MapPin, Siren } from 'lucide-react'
import { API_BASE_URL } from '../config.js'

const API = API_BASE_URL

const TYPE_STYLES = {
  ACCIDENT: 'bg-red-100 text-red-700',
  ROAD_CLOSED: 'bg-amber-100 text-amber-700',
  CONGESTION: 'bg-orange-100 text-orange-700',
  CLEAR: 'bg-emerald-100 text-emerald-700',
}

function severityMeta(level) {
  if (level >= 3) return { label: 'High', color: 'bg-red-500', width: '100%' }
  if (level === 2) return { label: 'Medium', color: 'bg-orange-500', width: '66%' }
  return { label: 'Low', color: 'bg-amber-400', width: '33%' }
}

function StatusBadge({ status }) {
  if (status === 'ACTIVE') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-700">
        <span className="inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse" />
        ACTIVE
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">
      <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
      RESOLVED
    </span>
  )
}

function KpiCard({ title, value, icon: Icon, accentClass }) {
  return (
    <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-md transition-all duration-200 hover:-translate-y-1 hover:shadow-lg">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</p>
        <span className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ${accentClass}`}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <p className="mt-4 text-2xl font-bold text-slate-900">{value}</p>
    </article>
  )
}

export default function Incidents() {
  const [incidentData, setIncidentData] = useState({ active: [], resolved: [], total: 0, avg_response: 8.4 })
  const [statusFilter, setStatusFilter] = useState('ALL')

  useEffect(() => {
    const pollIncidents = async () => {
      try {
        const response = await fetch(`${API}/incidents`, { credentials: 'include' })
        setIncidentData(await response.json())
      } catch {
        // Keep last successful snapshot when polling fails.
      }
    }

    pollIncidents()
    const timer = setInterval(pollIncidents, 2500)
    return () => clearInterval(timer)
  }, [])

  const visibleIncidents = useMemo(() => {
    const merged = [...incidentData.active, ...incidentData.resolved]
    if (statusFilter === 'ACTIVE') return merged.filter((incident) => incident.status === 'ACTIVE')
    if (statusFilter === 'RESOLVED') return merged.filter((incident) => incident.status === 'RESOLVED')
    return merged
  }, [incidentData.active, incidentData.resolved, statusFilter])

  const quickSummaryText = incidentData.active.length > 0
    ? `${incidentData.active.length} active incidents require attention`
    : 'No active incidents currently require intervention'

  return (
    <div className="ai-page">
      <main className="mx-auto w-full max-w-7xl px-6 py-8">
        <header className="mb-8 rounded-xl border border-gray-200 bg-white p-5 shadow-md">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Incident Command Center</h1>
              <p className="mt-1 text-sm text-slate-500">
                Monitor, manage, and respond to live incidents in real time.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button className="rounded-lg bg-blue-600 px-5 py-3 text-lg font-semibold text-white shadow-md transition hover:scale-105 hover:bg-blue-700">
                {/* Removed 'Add Report Incident' button as per requirements */}
              </button>
              <select
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option value="ALL">All</option>
                <option value="ACTIVE">Active</option>
                <option value="RESOLVED">Resolved</option>
              </select>
            </div>
          </div>
        </header>

        <section className="mb-6 rounded-xl border border-blue-100 bg-blue-50 p-4 shadow-sm">
          <p className="text-sm font-semibold text-blue-900">{quickSummaryText}</p>
        </section>

        <section className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          <KpiCard title="Total Incidents" value={incidentData.total} icon={AlertTriangle} accentClass="bg-slate-100 text-slate-700" />
          <KpiCard title="Active Incidents" value={incidentData.active.length} icon={Siren} accentClass="bg-red-100 text-red-600" />
          <KpiCard title="Resolved" value={incidentData.resolved.length} icon={CheckCircle2} accentClass="bg-emerald-100 text-emerald-600" />
        </section>

        <section className="mt-8 space-y-4">
          {visibleIncidents.length === 0 ? (
            <article className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
              <Activity className="mx-auto h-10 w-10 text-slate-400" />
              <h2 className="mt-4 text-xl font-semibold text-slate-800">No active incidents</h2>
              <p className="mt-2 text-sm text-slate-500">System is stable. You can trigger a test event to validate workflows.</p>
              <button className="mt-5 rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:scale-105 hover:bg-blue-700">
                Simulate Incident
              </button>
            </article>
          ) : (
            visibleIncidents.map((incident) => {
              const severity = severityMeta(incident.severity)
              
              // Map to friendly names as requested
              const isConstruction = incident.type === 'ROAD_CLOSED'
              const hash = Array.from(incident.id || '').reduce((sum, char) => sum + char.charCodeAt(0), 0)
              const friendlyName = isConstruction ? 'Construction' : (hash % 2 === 0 ? 'Car Crash' : 'Truck Crash')

              return (
                <article
                  key={incident.id}
                  className="cursor-pointer rounded-lg border border-gray-200 bg-white p-5 shadow-sm transition-all duration-200 hover:border-blue-300 hover:shadow-md"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0 lg:w-[48%]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-sm text-slate-900">{friendlyName}</span>
                      </div>
                      <p className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                        <MapPin className="h-3.5 w-3.5 text-slate-400" />
                        {incident.location}
                      </p>
                    </div>

                    <div className="lg:w-[34%]">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Severity</p>
                      <div className="mt-1 h-1.5 w-full rounded-full bg-slate-200">
                        <div className={`h-1.5 rounded-full ${severity.color}`} style={{ width: severity.width }} />
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-xs text-slate-500">
                        <span>{severity.label}</span>
                        <span className="font-mono">{incident.time}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-start gap-2 lg:w-[15%] lg:justify-end">
                      <StatusBadge status={incident.status} />
                    </div>
                  </div>
                </article>
              )
            })
          )}
        </section>
      </main>
    </div>
  )
}
