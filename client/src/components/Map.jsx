import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'

const CENTRE = [23.215, 72.645]

export default function MapView({ segments, incident, incidents = [], onSegmentClick, facilities = [] }) {
  const containerRef = useRef(null)
  const lmapRef   = useRef(null)
  const layersRef = useRef([])
  const markerRefs = useRef([])
  const primaryMarkerRef = useRef(null)
  const diversionRef = useRef([])
  const facilitiesRef = useRef([])
  const segmentsRef = useRef(segments)
  const onSegmentClickRef = useRef(onSegmentClick)

  useEffect(() => {
    segmentsRef.current = segments
    onSegmentClickRef.current = onSegmentClick
  }, [segments, onSegmentClick])

  const [searchQuery, setSearchQuery] = useState('')

  const flyToLocation = (lat, lng, zoom = 15) => {
    if (lmapRef.current) {
      lmapRef.current.flyTo([Number(lat), Number(lng)], zoom)
    }
  }

  const normalize = (value) => String(value || '').toLowerCase().trim()

  const findLocalMatch = (query) => {
    const needle = normalize(query)
    if (!needle) return null

    const incidentMatch = incident && (
      normalize(incident.location).includes(needle) ||
      normalize(incident.type).includes(needle)
    )
    if (incidentMatch) {
      return { lat: incident.lat, lng: incident.lng }
    }

    const facilityMatch = facilities.find((facility) =>
      normalize(facility.name).includes(needle) || normalize(facility.type).includes(needle)
    )
    if (facilityMatch) {
      return { lat: facilityMatch.lat, lng: facilityMatch.lng }
    }

    const segmentMatch = segments.find((segment) =>
      normalize(segment.street_name).includes(needle) || normalize(segment.seg_id).includes(needle)
    )
    if (segmentMatch) {
      return {
        lat: (Number(segmentMatch.seg_start_lat || segmentMatch.lat || CENTRE[0]) + Number(segmentMatch.seg_end_lat || segmentMatch.lat || CENTRE[0])) / 2,
        lng: (Number(segmentMatch.seg_start_lng || segmentMatch.lng || CENTRE[1]) + Number(segmentMatch.seg_end_lng || segmentMatch.lng || CENTRE[1])) / 2,
      }
    }

    return null
  }

  useEffect(() => {
    if (lmapRef.current || !containerRef.current) return
    const map = L.map(containerRef.current, {
      center: CENTRE,
      zoom: 14,
      zoomControl: true,
      attributionControl: false,
    })

    const light = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { subdomains: 'abcd' })
    const dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { subdomains: 'abcd' })
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png')
    const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}')
    
    // Using Stamen Terrain or another free terrain layer, here we use generic ESRI NatGeo/Terrain
    const terrain = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}')

    sat.addTo(map)

    L.control.layers({
      "Light Mode": light,
      "Dark Mode": dark,
      "Satellite": sat,
      "Terrain": terrain,
      "OpenStreetMap": osm
    }).addTo(map)

    const refreshSize = () => {
      map.invalidateSize({ pan: false, animate: false })
    }

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => refreshSize())
      : null
    resizeObserver?.observe(containerRef.current)
    window.addEventListener('resize', refreshSize)

    // Leaflet can render with a stale viewport when parent layout settles after mount.
    setTimeout(refreshSize, 0)
    setTimeout(refreshSize, 160)

    map.on('click', (e) => {
      const clickLat = e.latlng.lat;
      const clickLng = e.latlng.lng;
      const currentSegments = segmentsRef.current;
      const currentOnClick = onSegmentClickRef.current;
      if (!currentSegments || currentSegments.length === 0) return;

      let nearestSeg = null;
      let minDistance = Infinity;

      currentSegments.forEach((seg) => {
        const startLat = Number(seg.seg_start_lat || 0);
        const endLat = Number(seg.seg_end_lat || 0);
        const startLng = Number(seg.seg_start_lng || 0);
        const endLng = Number(seg.seg_end_lng || 0);
        const segLat = seg.lat !== undefined ? Number(seg.lat) : ((startLat + endLat) / 2);
        const segLng = seg.lng !== undefined ? Number(seg.lng) : ((startLng + endLng) / 2);
        if (isNaN(segLat) || isNaN(segLng) || segLat === 0 || segLng === 0) return;

        const dLat = clickLat - segLat;
        const dLng = clickLng - segLng;
        const dist = dLat * dLat + dLng * dLng;

        if (dist < minDistance) {
          minDistance = dist;
          nearestSeg = seg;
        }
      });

      if (nearestSeg && currentOnClick) {
        currentOnClick(nearestSeg);
      }
    });

    lmapRef.current = map
    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', refreshSize)
      map.remove()
      lmapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = lmapRef.current
    if (!map || !segments || segments.length === 0) return
    layersRef.current.forEach(l => map.removeLayer(l))
    layersRef.current = []
    markerRefs.current.forEach(m => map.removeLayer(m))
    markerRefs.current = []

    segments.forEach(seg => {
      if (!seg.seg_start_lat || !seg.seg_end_lat) return
      const freeFlow = seg.free_flow ?? seg.free_flow_speed ?? 0
      const weight = seg.incident_type === 'ACCIDENT' || seg.incident_type === 'ROAD_CLOSED'
        ? 7 : freeFlow >= 55 ? 4 : 2.5

      const line = L.polyline(
        [[seg.seg_start_lat, seg.seg_start_lng], [seg.seg_end_lat, seg.seg_end_lng]],
        { color: seg.color, weight, opacity: 0.88 }
      ).bindTooltip(
        `<b style="font-family:monospace;font-size:12px">${seg.street_name}</b><br/>` +
        `<span style="font-family:monospace;font-size:11px">` +
        `SEG ${seg.seg_id || 'N/A'}<br/>` +
        `${seg.speed} km/h | ff ${freeFlow}<br/>` +
        `${seg.incident_type} sev${seg.severity} | ${seg.vehicle_count} vehicles<br/><br/>` +
        `<span style="color:#fbbf24;font-weight:bold;">[CLICK TO TRIGGER ACCIDENT]</span></span>`,
        { sticky: true }
      ).on('click', (e) => {
        L.DomEvent.stopPropagation(e)
        if (onSegmentClick) onSegmentClick(seg)
      }).addTo(map)
      layersRef.current.push(line)

      if (seg.incident_type === 'ACCIDENT' || seg.incident_type === 'ROAD_CLOSED') {
        const markerIcon = L.divIcon({
          className: '',
          html: `<div style="width:18px;height:18px;border-radius:999px;background:#ef4444;border:2px solid #ffffff;box-shadow:0 6px 18px rgba(239,68,68,0.45);"></div>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        })
        const marker = L.marker([seg.lat, seg.lng], { icon: markerIcon }).bindPopup(
          `<b>${seg.incident_type}</b><br/>${seg.street_name}<br/>${seg.speed} km/h`
        ).addTo(map)
        markerRefs.current.push(marker)
      }
    })
  }, [segments])

  useEffect(() => {
    const map = lmapRef.current
    if (!map) return
    if (primaryMarkerRef.current) {
      map.removeLayer(primaryMarkerRef.current)
      primaryMarkerRef.current = null
    }
    if (incident) {
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:20px;height:20px;background:#e84040;border:3px solid #ffd6d6;border-radius:50%;box-shadow:0 10px 26px rgba(232,64,64,0.42);"></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      })
      const marker = L.marker([incident.lat, incident.lng], { icon })
        .bindPopup(
          `<b style="font-family:monospace">${incident.type}</b><br/>` +
          `<span style="font-family:monospace;font-size:11px">${incident.location}<br/>${incident.speed} km/h</span>`
        ).addTo(map)
      primaryMarkerRef.current = marker
    }
  }, [incident])

  useEffect(() => {
    const map = lmapRef.current
    if (!map) return
    diversionRef.current.forEach(l => map.removeLayer(l))
    diversionRef.current = []

    incidents.forEach((inc) => {
      const coords = inc.diversion_route
      if (coords && coords.length > 1) {
        const line = L.polyline(coords, {
          color:     '#3b82f6',
          weight:    6,
          opacity:   0.9,
          dashArray: '10 6',
        }).bindTooltip(`Suggested diversion for ${inc.id}`).addTo(map)
        diversionRef.current.push(line)
      }
    })
  }, [incidents])

  useEffect(() => {
    const map = lmapRef.current
    if (!map) return
    facilitiesRef.current.forEach(m => map.removeLayer(m))
    facilitiesRef.current = []

    facilities.forEach(f => {
      const isHospital = f.type === 'hospital'
      const color = isHospital ? '#10b981' : '#f59e0b';
      
      const icon = L.divIcon({
        className: '',
        html: `
          <div style="
            width: 32px; 
            height: 32px; 
            background: rgba(255, 255, 255, 0.92);
            border: 2px solid ${color}; 
            border-radius: 50%; 
            display: flex; 
            align-items: center; 
            justify-content: center;
            box-shadow: 0 0 15px ${color}44;
            backdrop-filter: blur(4px);
            transition: all 0.2s ease-in-out;
          ">
            ${isHospital 
              ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`
              : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"></path></svg>`
            }
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      })

      const marker = L.marker([f.lat, f.lng], { icon })
        .bindPopup(`
          <div style="font-family: inherit; padding: 4px; background: transparent;">
            <b style="color: ${color}; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px;">${f.type.replace('_', ' ')}</b>
            <div style="font-weight: bold; margin-top: 2px; color: #0f172a;">${f.name}</div>
          </div>
        `, { className: 'custom-popup' })
        .addTo(map)
      facilitiesRef.current.push(marker)
    })
  }, [facilities])

  const handleSearch = async (e) => {
    e.preventDefault()
    if (!searchQuery) return

    const localMatch = findLocalMatch(searchQuery)
    if (localMatch) {
      flyToLocation(localMatch.lat, localMatch.lng, 15)
      return
    }

    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}`)
      const data = await res.json()
      if (data && data.length > 0 && lmapRef.current) {
        flyToLocation(data[0].lat, data[0].lon, 15)
      }
    } catch (e) {
      console.error(e)
    }
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <form 
        onSubmit={handleSearch}
        style={{ position: 'absolute', top: 10, left: 60, zIndex: 1000, display: 'flex', gap: 6, opacity: 0.95 }}
      >
        <input 
          type="text" 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search location..." 
          style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid #ccc', fontSize: 13, minWidth: 200, outline: 'none', background: 'white' }}
        />
        <button type="submit" style={{ padding: '6px 12px', background: '#2563eb', color: 'white', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 'bold' }}>
          Search
        </button>
      </form>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}