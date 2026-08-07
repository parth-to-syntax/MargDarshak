import { useEffect, useState, useRef } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, LineChart, Line, AreaChart, Area, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Legend, RadialBarChart, RadialBar } from 'recharts'
import { Car, Gauge, CheckCircle2, Siren, FileText, ArrowRight } from 'lucide-react'
import { API_BASE_URL } from '../config.js'

const API = API_BASE_URL

function loadRatio(segment) {
  const ff = Number(segment.free_flow || segment.free_flow_speed || 0)
  const sp = Number(segment.speed || 0)
  if (ff <= 0) return 0
  return Math.max(0, Math.min(1, 1 - (sp / ff)))
}

function KpiCard({ title, value, icon: Icon, accentClass }) {
  return (
    <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-md flex items-center gap-4 transition-all duration-200 hover:shadow-lg">
      <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${accentClass}`}>
        <Icon size={26} strokeWidth={2.5} />
      </div>
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</p>
        <p className="mt-1 text-3xl font-bold text-slate-900">{value}</p>
      </div>
    </article>
  )
}

function SectionCard({ title, subtitle, children }) {
  return (
    <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-md overflow-hidden transition-all duration-200 hover:shadow-lg">
      <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      <div className="mt-5">{children}</div>
    </article>
  )
}

export default function Insights() {
  const [feedSegments, setFeedSegments] = useState([])
  const [feedMetrics, setFeedMetrics] = useState({})
  const [feedHistory, setFeedHistory] = useState([])
  const [activeInc, setActiveInc] = useState(null)
  const resetVersionRef = useRef(null)

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
    const poll = async () => {
      try {
        const response = await fetch(`${API}/feed`, { credentials: 'include' })
        const data = await response.json()

        if (resetVersionRef.current === null) {
          resetVersionRef.current = data.reset_version ?? 0
        } else if ((data.reset_version ?? 0) !== resetVersionRef.current) {
          resetVersionRef.current = data.reset_version ?? 0
          setFeedSegments([])
          setFeedMetrics({})
          setFeedHistory([])
        }

        const segments = data.segments || []
        setFeedSegments(segments)
        setFeedMetrics(data.metrics || {})

        const avgLoad = segments.length
          ? Math.round((segments.reduce((sum, segment) => sum + loadRatio(segment), 0) / segments.length) * 100)
          : 0

        const avgSpd = segments.length
          ? Math.round(segments.reduce((s, seg) => s + Number(seg.speed || 0), 0) / segments.length)
          : 0
        const health = Math.round(data.metrics?.network_health || 0)

        const tsLabel = String(data.timestamp || '').split(' ')[1]?.slice(0, 8) || '--:--:--'
        setFeedHistory((previous) => [...previous, { ts: tsLabel, load: avgLoad, speed: avgSpd, health }].slice(-30))
      } catch {}
    }
    poll()
    const timer = setInterval(poll, 4000)
    return () => clearInterval(timer)
  }, [])

  const generatePDF = () => {
    if (!activeInc) return alert("No active incidents to generate advisory for.")
    
    const diversionRoute = activeInc.location === 'Pandit Dindayal Upadhyay Marg' ? 'GH Road / Pathikashram Route' : 'Alternative local arterial road'
    const isConstruction = activeInc.type === 'ROAD_CLOSED'
    const hash = Array.from(activeInc.id || '').reduce((sum, char) => sum + char.charCodeAt(0), 0)
    const incName = isConstruction ? 'Construction' : (hash % 2 === 0 ? 'Car Crash' : 'Truck Crash')

    const htmlContent = `
      <html>
        <head>
          <title>Travel Advisory</title>
          <style>
            body { font-family: system-ui, sans-serif; padding: 40px; color: #1e293b; line-height: 1.6; }
            h1 { color: #dc2626; border-bottom: 2px solid #fca5a5; padding-bottom: 10px; }
            .content { margin-top: 30px; background: #f8fafc; padding: 25px; border-radius: 12px; border: 1px solid #e2e8f0; }
            .footer { margin-top: 50px; font-size: 13px; color: #64748b; text-align: center; }
            .highlight { font-weight: 700; color: #0f172a; }
          </style>
        </head>
        <body>
          <h1>Official Travel Advisory</h1>
          <p><strong>Published:</strong> ${new Date().toLocaleString()}</p>
          
          <div class="content">
            <p>Attention all commuters traveling towards <span class="highlight">${activeInc.location}</span>.</p>
            <p>Due to an active <span class="highlight">${incName}</span>, significant traffic delays are currently being observed in the sector.</p>
            <p><strong>Recommended Action:</strong> Citizens travelling from this route are strictly advised to take the <span class="highlight">${diversionRoute}</span> to reach their destination.</p>
            <p>Emergency services have been dispatched. Normalcy is expected to resume once the site is cleared.</p>
          </div>

          <div class="footer">
            Issued by the SkyGrid Traffic Command Center
          </div>
        </body>
      </html>
    `

    const blob = new Blob([htmlContent], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const newWin = window.open(url, '_blank')
    if(newWin) {
      newWin.onload = () => {
        newWin.document.title = "Travel Advisory PDF"
        setTimeout(() => newWin.print(), 1000)
      }
    }
  }

  const byRoad = {}
  const mix = { CLEAR: 0, CONGESTION: 0, ACCIDENT: 0, ROAD_CLOSED: 0 }

  for (const segment of feedSegments) {
    byRoad[segment.street_name] = byRoad[segment.street_name] || { road: segment.street_name, loadTotal: 0, count: 0 }
    byRoad[segment.street_name].loadTotal += Math.round(loadRatio(segment) * 100)
    byRoad[segment.street_name].count += 1
    mix[segment.incident_type] = (mix[segment.incident_type] || 0) + 1
  }

  const roadLoadData = Object.values(byRoad)
    .map((road) => ({ road: road.road, load: Math.round(road.loadTotal / road.count) }))
    .sort((a, b) => b.load - a.load)
    .slice(0, 8)

  const mixData = [
    { name: 'CLEAR', value: mix.CLEAR, color: '#22c55e' },
    { name: 'CONGESTION', value: mix.CONGESTION, color: '#f59e0b' },
    { name: 'ACCIDENT', value: mix.ACCIDENT, color: '#ef4444' },
    { name: 'ROAD_CLOSED', value: mix.ROAD_CLOSED, color: '#fb7185' },
  ]

  // Hardcoded Before/After stats context based on whether there's an incident
  const currentSpeed = feedMetrics.avg_speed || 0
  const beforeSpeed = activeInc ? currentSpeed + 35.5 : currentSpeed

  // Speed vs Free-Flow per road
  const speedVsFreeFlow = Object.values(
    feedSegments.reduce((acc, seg) => {
      const key = seg.street_name
      if (!acc[key]) acc[key] = { road: key, speedSum: 0, ffSum: 0, count: 0 }
      acc[key].speedSum += Number(seg.speed || 0)
      acc[key].ffSum += Number(seg.free_flow || seg.free_flow_speed || 0)
      acc[key].count += 1
      return acc
    }, {})
  ).map(r => ({
    road: r.road,
    speed: Math.round(r.speedSum / r.count),
    freeFlow: Math.round(r.ffSum / r.count),
  })).sort((a, b) => a.speed - b.speed).slice(0, 10)

  // Vehicle distribution by road
  const vehicleByRoad = Object.values(
    feedSegments.reduce((acc, seg) => {
      const key = seg.street_name
      if (!acc[key]) acc[key] = { road: key, vehicles: 0 }
      acc[key].vehicles += Number(seg.vehicle_count || 0)
      return acc
    }, {})
  ).sort((a, b) => b.vehicles - a.vehicles).slice(0, 8)

  // Radar data for road health dimensions
  const radarData = (() => {
    const totalSeg = feedSegments.length || 1
    const clearPct = Math.round((mix.CLEAR / totalSeg) * 100)
    const avgSpd = Math.round(currentSpeed)
    const hlth = Math.round(feedMetrics.network_health || 0)
    const cap = feedSegments.length ? Math.round(feedSegments.reduce((s, seg) => s + (Number(seg.vehicle_count || 0) / 80), 0) / feedSegments.length * 100) : 0
    const incFree = Math.round(100 - ((feedMetrics.incident_count || 0) / totalSeg) * 100)
    return [
      { metric: 'Clear Roads', value: clearPct },
      { metric: 'Avg Speed', value: Math.min(avgSpd, 100) },
      { metric: 'Capacity', value: Math.min(cap, 100) },
      { metric: 'Incident-Free', value: incFree },
    ]
  })()

  return (
    <div className="ai-page">
      <main className="mx-auto w-full max-w-7xl px-6 py-8">
        <header className="mb-8 rounded-xl border border-gray-200 bg-white p-6 shadow-md flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div>
            <h1 className="text-5xl font-semibold text-slate-900">Traffic Insights & Analytics</h1>
            <p className="mt-2 text-lg text-slate-600">
              Deep dive into macro network performance, road stress levels, and incident impact.
            </p>
          </div>
          <button 
            onClick={generatePDF}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-5 py-3 text-lg font-semibold text-white shadow-md transition hover:scale-105 hover:bg-red-700"
          >
            <FileText size={20} />
            Generate Advisory PDF
          </button>
        </header>


        <section className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
          <KpiCard title="Total Vehicles" value={feedMetrics.total_vehicles || 0} icon={Car} accentClass="bg-blue-100 text-blue-600" />
          <KpiCard title="Avg Speed" value={Math.round(currentSpeed)} icon={Gauge} accentClass="bg-blue-100 text-blue-600" />
          <KpiCard title="Incident Segments" value={feedMetrics.incident_count || 0} icon={Siren} accentClass="bg-red-100 text-red-600" />
        </section>



        <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <SectionCard title="Vehicle Distribution" subtitle="Total vehicle count per major road">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={vehicleByRoad} margin={{ left: 5, right: 10, top: 8, bottom: 56 }}>
                <defs>
                  <linearGradient id="vehicleGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="#0891b2" stopOpacity={0.5} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="road" angle={-25} textAnchor="end" interval={0} height={72} tick={{ fill: '#334155', fontSize: 11 }} />
                <YAxis tick={{ fill: '#334155', fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="vehicles" name="Vehicles" fill="url(#vehicleGrad)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </SectionCard>

          <SectionCard title="Top Bottlenecks" subtitle="Most congested segments by load %">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={feedSegments
                  .map(seg => {
                    const ff = Number(seg.free_flow || seg.free_flow_speed || 1)
                    const load = Math.round((1 - Number(seg.speed || 0) / ff) * 100)
                    return { name: seg.street_name, load: Math.max(0, load) }
                  })
                  .sort((a, b) => b.load - a.load)
                  .slice(0, 8)}
                layout="vertical"
                margin={{ left: 5, right: 20, top: 8, bottom: 8 }}
              >
                <defs>
                  <linearGradient id="bottleneckGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#f97316" stopOpacity={0.8} />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0.9} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" tick={{ fill: '#334155', fontSize: 12 }} unit="%" domain={[0, 100]} />
                <YAxis dataKey="name" type="category" width={130} tick={{ fill: '#334155', fontSize: 11 }} />
                <Tooltip formatter={(value) => `${value}%`} />
                <Bar dataKey="load" name="Load %" fill="url(#bottleneckGrad)" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </SectionCard>
        </section>

        <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <SectionCard title="Road-Wise Analysis" subtitle="Aggregated metrics by street">
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-600">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Street Name</th>
                    <th className="px-4 py-3 font-semibold">Segments</th>
                    <th className="px-4 py-3 font-semibold">Avg Load</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {Object.values(byRoad).sort((a,b) => (b.loadTotal / b.count) - (a.loadTotal / a.count)).slice(0, 10).map((road, idx) => {
                    const l = Math.round(road.loadTotal / road.count)
                    return (
                      <tr key={idx} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 font-medium text-slate-800">{road.road}</td>
                        <td className="px-4 py-3">{road.count}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${l > 60 ? 'bg-red-100 text-red-700' : l > 30 ? 'bg-orange-100 text-orange-700' : 'bg-emerald-100 text-emerald-700'}`}>
                            {l}%
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <SectionCard title="Segment-Wise Analysis" subtitle="Most critical individual road segments">
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-600">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Seg ID</th>
                    <th className="px-4 py-3 font-semibold">Road</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Load</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {feedSegments
                    .map(seg => {
                      const ff = Number(seg.free_flow || seg.free_flow_speed || 1)
                      const load = Math.round((1 - Number(seg.speed || 0) / ff) * 100)
                      return { id: seg.seg_id, road: seg.street_name, type: seg.incident_type, load: Math.max(0, load) }
                    })
                    .sort((a, b) => b.load - a.load)
                    .slice(0, 10)
                    .map((seg, idx) => (
                      <tr key={idx} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs">{seg.id}</td>
                        <td className="px-4 py-3 font-medium text-slate-800">{seg.road}</td>
                        <td className="px-4 py-3">{seg.type}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${seg.load > 60 ? 'bg-red-100 text-red-700' : seg.load > 30 ? 'bg-orange-100 text-orange-700' : 'bg-emerald-100 text-emerald-700'}`}>
                            {seg.load}%
                          </span>
                        </td>
                      </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </section>
      </main>
    </div>
  )
}
