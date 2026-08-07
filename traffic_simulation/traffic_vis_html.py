import pandas as pd
import json

df = pd.read_csv("gandhinagar_traffic_feed.csv")
df["timestamp"] = pd.to_datetime(df["timestamp"])
timestamps = sorted(df["timestamp"].unique())

# ── Build timestamp data for JS ───────────────────────────────────
def speed_color(speed, free_flow):
    if free_flow == 0: return "#888888"
    r = speed / free_flow
    if r >= 0.85: return "#00AA00"
    if r >= 0.65: return "#7DC900"
    if r >= 0.45: return "#FFA500"
    if r >= 0.25: return "#FF4500"
    return "#CC0000"

def get_phase(i):
    if i <= 19:  return "Normal flow"
    if i <= 24:  return "Build-up"
    if i == 25:  return "INCIDENT 1 — GH Road"
    if i <= 34:  return "Ripple — 1 incident"
    if i == 35:  return "INCIDENT 2 — Road 3"
    if i <= 49:  return "Ripple — 2 incidents"
    if i == 50:  return "INCIDENT 3 — KH Road"
    if i <= 60:  return "Ripple — 3 incidents"
    if i <= 65:  return "Recovery — clearing"
    if i <= 75:  return "Recovery — improving"
    return "Cleared"

def phase_color(i):
    if i <= 19:  return "#16A34A"
    if i <= 24:  return "#D97706"
    if 25 <= i <= 60: return "#DC2626"
    if i <= 75:  return "#D97706"
    return "#16A34A"

# Pre-build all frames as JS arrays
all_frames = []
for i, ts in enumerate(timestamps):
    frame_df = df[df["timestamp"] == ts]
    segs = []
    for _, seg in frame_df.iterrows():
        segs.append({
            "id":    seg["seg_id"],
            "name":  seg["street_name"],
            "s1lat": float(seg["seg_start_lat"]),
            "s1lng": float(seg["seg_start_lng"]),
            "s2lat": float(seg["seg_end_lat"]),
            "s2lng": float(seg["seg_end_lng"]),
            "lat":   float(seg["lat"]),
            "lng":   float(seg["lng"]),
            "spd":   int(seg["speed"]),
            "ff":    int(seg["free_flow_speed"]),
            "inc":   seg["incident_type"],
            "sev":   int(seg["severity"]),
            "vc":    int(seg["vehicle_count"]),
            "dir":   seg["direction"],
            "col":   speed_color(seg["speed"], seg["free_flow_speed"]),
        })
    all_frames.append({
        "ts":     pd.Timestamp(ts).strftime("%Y-%m-%d %H:%M"),
        "phase":  get_phase(i),
        "pcol":   phase_color(i),
        "segs":   segs,
    })

frames_json = json.dumps(all_frames)
total       = len(timestamps)
centre_lat  = df["lat"].mean()
centre_lng  = df["lng"].mean()

# ── HTML ──────────────────────────────────────────────────────────
html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Gandhinagar Traffic Simulation</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  * {{ margin:0; padding:0; box-sizing:border-box; font-family:system-ui,sans-serif; }}
  body {{ background:#f0f0f0; display:flex; flex-direction:column; height:100vh; }}
  #map {{ flex:1; }}

  #controls {{
    background:white;
    padding:12px 20px;
    border-top:1px solid #ddd;
    display:flex;
    align-items:center;
    gap:16px;
    flex-wrap:wrap;
  }}
  #phase-badge {{
    padding:4px 14px;
    border-radius:20px;
    font-size:13px;
    font-weight:600;
    color:white;
    min-width:130px;
    text-align:center;
  }}
  #ts-label {{
    font-size:13px;
    font-weight:500;
    color:#333;
    min-width:140px;
  }}
  #slider {{
    flex:1;
    min-width:200px;
    accent-color:#2563EB;
  }}
  button {{
    padding:6px 16px;
    border-radius:6px;
    border:1px solid #ccc;
    background:white;
    cursor:pointer;
    font-size:13px;
    font-weight:500;
  }}
  button:hover {{ background:#f5f5f5; }}
  button.primary {{ background:#2563EB; color:white; border-color:#2563EB; }}
  button.primary:hover {{ background:#1D4ED8; }}

  #metrics {{
    background:white;
    padding:8px 20px;
    border-top:1px solid #ddd;
    display:flex;
    gap:24px;
    flex-wrap:wrap;
  }}
  .metric {{ text-align:center; }}
  .metric-val {{ font-size:20px; font-weight:600; color:#111; }}
  .metric-lbl {{ font-size:11px; color:#888; }}

  #speed-ctrl {{
    display:flex;
    align-items:center;
    gap:6px;
    font-size:12px;
    color:#555;
  }}
  #speed-ctrl select {{
    padding:3px 6px;
    border-radius:4px;
    border:1px solid #ccc;
    font-size:12px;
  }}

  #legend {{
    position:absolute;
    bottom:160px;
    left:12px;
    z-index:1000;
    background:white;
    padding:10px 14px;
    border-radius:8px;
    border:1px solid #ddd;
    font-size:12px;
    line-height:1.9;
    box-shadow:0 2px 6px rgba(0,0,0,0.1);
  }}
  .leg-dot {{
    display:inline-block;
    width:28px;
    height:5px;
    border-radius:3px;
    margin-right:6px;
    vertical-align:middle;
  }}
  #incident-panel {{
    position:absolute;
    top:12px;
    right:12px;
    z-index:1000;
    background:white;
    padding:10px 14px;
    border-radius:8px;
    border:1px solid #ddd;
    font-size:12px;
    box-shadow:0 2px 6px rgba(0,0,0,0.1);
    display:none;
    max-width:220px;
  }}
  #incident-panel.active {{ display:block; border-left:4px solid #DC2626; }}
  #incident-panel h4 {{ color:#DC2626; margin-bottom:6px; font-size:13px; }}
</style>
</head>
<body>

<div id="map"></div>

<div id="metrics">
  <div class="metric"><div class="metric-val" id="m-incident">0</div><div class="metric-lbl">Incident segs</div></div>
  <div class="metric"><div class="metric-val" id="m-congested">0</div><div class="metric-lbl">Congested segs</div></div>
  <div class="metric"><div class="metric-val" id="m-speed">0 km/h</div><div class="metric-lbl">Avg speed</div></div>
  <div class="metric"><div class="metric-val" id="m-health">100%</div><div class="metric-lbl">Network health</div></div>
  <div class="metric"><div class="metric-val" id="m-vehicles">0</div><div class="metric-lbl">Total vehicles</div></div>
</div>

<div id="controls">
  <div id="phase-badge">Normal flow</div>
  <div id="ts-label">T1 / {total}</div>
  <input type="range" id="slider" min="0" max="{total-1}" value="0"
         oninput="goTo(parseInt(this.value))">
  <button class="primary" onclick="togglePlay()" id="play-btn">▶ Play</button>
  <button onclick="reset()">↺ Reset</button>
  <div id="speed-ctrl">
    Speed:
    <select id="spd-sel" onchange="updateSpeed()">
      <option value="600">0.5x</option>
      <option value="300" selected>1x</option>
      <option value="150">2x</option>
      <option value="80">4x</option>
      <option value="30">10x</option>
    </select>
  </div>
</div>

<div id="legend">
  <b>Speed vs free flow</b><br>
  <span class="leg-dot" style="background:#00AA00"></span>Free flow (&gt;85%)<br>
  <span class="leg-dot" style="background:#7DC900"></span>Mostly clear (65–85%)<br>
  <span class="leg-dot" style="background:#FFA500"></span>Moderate (45–65%)<br>
  <span class="leg-dot" style="background:#FF4500"></span>Slow (25–45%)<br>
  <span class="leg-dot" style="background:#CC0000"></span>Standstill (&lt;25%)<br>
</div>

<div id="incident-panel">
  <h4 id="inc-count">INCIDENT ACTIVE</h4>
  <div id="inc-details"></div>
</div>

<script>
const FRAMES = {frames_json};
const map = L.map('map').setView([{centre_lat:.6f}, {centre_lng:.6f}], 14);

L.tileLayer('https://{{s}}.basemaps.cartocdn.com/light_all/{{z}}/{{x}}/{{y}}{{r}}.png', {{
  attribution: '&copy; OpenStreetMap &copy; CARTO'
}}).addTo(map);

let polylines = [];
let incMarker = null;
let curIdx    = 0;
let playing   = false;
let timer     = null;
let speed     = 300;

function clearMap() {{
  polylines.forEach(p => map.removeLayer(p));
  polylines = [];
  if (incMarker) {{ map.removeLayer(incMarker); incMarker = null; }}
}}

function renderFrame(idx) {{
  clearMap();
  const frame = FRAMES[idx];
  const segs  = frame.segs;

  let incCount = 0, congCount = 0, totalSpd = 0, totalFF = 0, totalVC = 0;
  let incSeg   = null;

  segs.forEach(seg => {{
    const w = seg.inc === 'ACCIDENT' ? 8 : (seg.ff >= 55 ? 5 : 3);
    const p = L.polyline(
      [[seg.s1lat, seg.s1lng], [seg.s2lat, seg.s2lng]],
      {{ color: seg.col, weight: w, opacity: 0.92 }}
    ).bindTooltip(
      `<b>${{seg.name}}</b><br>` +
      `Speed: ${{seg.spd}} / ${{seg.ff}} km/h<br>` +
      `Status: ${{seg.inc}} (sev ${{seg.sev}})<br>` +
      `Vehicles: ${{seg.vc}}<br>` +
      `Direction: ${{seg.dir}}<br>` +
      `ID: ${{seg.id}}`,
      {{ sticky: true }}
    ).addTo(map);
    polylines.push(p);

    if (seg.inc === 'ACCIDENT') {{ incCount++; incSeg = seg; }}
    if (seg.inc === 'CONGESTION') congCount++;
    totalSpd += seg.spd;
    totalFF  += seg.ff;
    totalVC  += seg.vc;
  }});

  const incSegs = segs.filter(s => s.inc === 'ACCIDENT' || s.inc === 'ROAD_CLOSED');
  const uniqueInc = [];
  const seenNames = new Set();
  incSegs.forEach(s => {{
    if (!seenNames.has(s.name)) {{
      seenNames.add(s.name);
      uniqueInc.push(s);
    }}
  }});

  uniqueInc.forEach(incSeg => {{
    const marker = L.circleMarker([incSeg.lat, incSeg.lng], {{
      radius: 10, color: '#CC0000', fillColor: '#CC0000',
      fillOpacity: 0.95, weight: 2
    }}).bindPopup(
      `<b>${{incSeg.inc}}</b><br>${{incSeg.name}}<br>` +
      `Speed: ${{incSeg.spd}} km/h<br>Vehicles: ${{incSeg.vc}}`
    ).addTo(map);
    polylines.push(marker);
  }});

  if (uniqueInc.length > 0) {{
    document.getElementById('incident-panel').className = 'active';
    document.getElementById('inc-count').textContent =
  uniqueInc.length > 1 ? `${{uniqueInc.length}} INCIDENTS ACTIVE` : 'INCIDENT ACTIVE';
    document.getElementById('inc-details').innerHTML = uniqueInc.map(s =>
      `<b>${{s.inc}}</b>: ${{s.name}}<br>` +
      `Speed: ${{s.spd}} km/h | Vehicles: ${{s.vc}}<br>`
    ).join('<hr style="margin:4px 0">');
  }} else {{
    document.getElementById('incident-panel').className = '';
  }}

  const avgSpd    = totalSpd / segs.length;
  const avgFF     = totalFF  / segs.length;
  const health    = Math.round((avgSpd / avgFF) * 100);

  document.getElementById('m-incident').textContent  = incCount;
  document.getElementById('m-congested').textContent = congCount;
  document.getElementById('m-speed').textContent     = Math.round(avgSpd) + ' km/h';
  document.getElementById('m-health').textContent    = health + '%';
  document.getElementById('m-vehicles').textContent  = totalVC.toLocaleString();

  const badge = document.getElementById('phase-badge');
  badge.textContent   = frame.phase;
  badge.style.background = frame.pcol;

  document.getElementById('ts-label').textContent =
    `${{frame.ts}}  (T${{idx+1}}/{total})`;
  document.getElementById('slider').value = idx;
}}

function goTo(idx) {{
  curIdx = Math.max(0, Math.min(idx, FRAMES.length - 1));
  renderFrame(curIdx);
}}

function togglePlay() {{
  playing = !playing;
  document.getElementById('play-btn').textContent = playing ? '⏸ Pause' : '▶ Play';
  if (playing) tick();
  else if (timer) {{ clearTimeout(timer); timer = null; }}
}}

function tick() {{
  if (!playing) return;
  if (curIdx >= FRAMES.length - 1) {{
    curIdx  = 0;
    playing = false;
    document.getElementById('play-btn').textContent = '▶ Play';
    renderFrame(0);
    return;
  }}
  curIdx++;
  renderFrame(curIdx);
  timer = setTimeout(tick, speed);
}}

function reset() {{
  playing = false;
  if (timer) clearTimeout(timer);
  document.getElementById('play-btn').textContent = '▶ Play';
  goTo(0);
}}

function updateSpeed() {{
  speed = parseInt(document.getElementById('spd-sel').value);
}}

renderFrame(0);
</script>
</body>
</html>"""

with open("traffic_simulation.html", "w", encoding="utf-8") as f:
    f.write(html)

print(f"Saved → traffic_simulation.html")
print(f"Open in browser — no server needed")