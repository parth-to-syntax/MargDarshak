import pandas as pd
import folium
import streamlit as st
from streamlit_folium import st_folium
import time

st.set_page_config(
    page_title="Gandhinagar Traffic Simulation",
    layout="wide"
)

# ── Load data ─────────────────────────────────────────────────────
@st.cache_data
def load_data():
    df = pd.read_csv("gandhinagar_traffic_feed.csv")
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    return df

df        = load_data()
timestamps = sorted(df["timestamp"].unique())
TOTAL_TS  = len(timestamps)

# ── Speed ratio → Google Maps style color ────────────────────────
def speed_color(speed, free_flow):
    if free_flow == 0:
        return "#888888"
    ratio = speed / free_flow
    if ratio >= 0.85:  return "#00AA00"   # dark green  — free flow
    if ratio >= 0.65:  return "#7DC900"   # light green — mostly free
    if ratio >= 0.45:  return "#FFA500"   # orange      — moderate
    if ratio >= 0.25:  return "#FF4500"   # red-orange  — slow
    return             "#CC0000"          # dark red    — standstill

def line_weight(incident_type, highway_type):
    if incident_type == "ACCIDENT":    return 8
    if highway_type in ("trunk","primary","secondary"): return 5
    return 3

# ── Session state ─────────────────────────────────────────────────
if "ts_index"   not in st.session_state: st.session_state.ts_index   = 0
if "playing"    not in st.session_state: st.session_state.playing    = False
if "play_speed" not in st.session_state: st.session_state.play_speed = 0.3

# ── Sidebar controls ──────────────────────────────────────────────
with st.sidebar:
    st.title("Traffic Simulation")
    st.caption("Gandhinagar, Gujarat")
    st.divider()

    col1, col2, col3 = st.columns(3)
    if col1.button("▶ Play"):
        st.session_state.playing = True
    if col2.button("⏸ Pause"):
        st.session_state.playing = False
    if col3.button("↺ Reset"):
        st.session_state.ts_index = 0
        st.session_state.playing  = False

    st.session_state.ts_index = st.slider(
        "Timestamp",
        min_value=0,
        max_value=TOTAL_TS - 1,
        value=st.session_state.ts_index,
        format=f"T%d"
    )

    st.session_state.play_speed = st.select_slider(
        "Playback speed",
        options=[0.5, 0.3, 0.15, 0.05],
        value=0.3,
        format_func=lambda x: {0.5:"0.5x", 0.3:"1x", 0.15:"2x", 0.05:"5x"}[x]
    )

    st.divider()
    st.markdown("""
    **Speed ratio legend**
    🟢 Free flow (>85%)
    🟡 Mostly free (65–85%)
    🟠 Moderate (45–65%)
    🔴 Slow (25–45%)
    ⬛ Standstill (<25%)
    """)

# ── Get current timestamp data ────────────────────────────────────
current_ts   = timestamps[st.session_state.ts_index]
current_df   = df[df["timestamp"] == current_ts]

# ── Phase label ───────────────────────────────────────────────────
ts_idx = st.session_state.ts_index
if ts_idx <= 19:   phase_label, phase_color = "Normal flow",     "green"
elif ts_idx <= 24: phase_label, phase_color = "Build-up",        "orange"
elif ts_idx == 25: phase_label, phase_color = "INCIDENT TRIGGER","red"
elif ts_idx <= 45: phase_label, phase_color = "Ripple effect",   "red"
elif ts_idx <= 65: phase_label, phase_color = "Recovery",        "orange"
else:              phase_label, phase_color = "Cleared",         "green"

# ── Top metrics ───────────────────────────────────────────────────
st.markdown(f"### {current_ts.strftime('%Y-%m-%d %H:%M')}  —  "
            f":{phase_color}[{phase_label}]  "
            f"(timestamp {ts_idx + 1} / {TOTAL_TS})")

m1, m2, m3, m4, m5 = st.columns(5)

incident_segs = current_df[current_df["incident_type"] == "ACCIDENT"]
congested     = current_df[current_df["incident_type"] == "CONGESTION"]
avg_speed     = current_df["speed"].mean()
avg_ff        = current_df["free_flow_speed"].mean()
network_ratio = avg_speed / avg_ff if avg_ff > 0 else 1

m1.metric("Incident segments", len(incident_segs),
          delta="ACTIVE" if len(incident_segs) > 0 else "None",
          delta_color="inverse")
m2.metric("Congested segments", len(congested))
m3.metric("Avg network speed",  f"{avg_speed:.0f} km/h")
m4.metric("Network health",     f"{network_ratio*100:.0f}%",
          delta=f"{(network_ratio-1)*100:.0f}%",
          delta_color="normal")
m5.metric("Total vehicles",     f"{current_df['vehicle_count'].sum():,}")

# ── Build Folium map ──────────────────────────────────────────────
m = folium.Map(
    location=[current_df["lat"].mean(), current_df["lng"].mean()],
    zoom_start=14,
    tiles="CartoDB positron"
)

for _, seg in current_df.iterrows():
    color  = speed_color(seg["speed"], seg["free_flow_speed"])
    weight = line_weight(seg["incident_type"], seg.get("highway_type","residential"))

    # Incident segment gets a pulsing red marker on top of the line
    if seg["incident_type"] == "ACCIDENT":
        folium.CircleMarker(
            location=[seg["lat"], seg["lng"]],
            radius=12,
            color="#CC0000",
            fill=True,
            fill_color="#CC0000",
            fill_opacity=0.9,
            tooltip=f"ACCIDENT — {seg['street_name']} | {seg['speed']} km/h | severity {seg['severity']}",
            popup=folium.Popup(
                f"<b>ACCIDENT</b><br>"
                f"Road: {seg['street_name']}<br>"
                f"Speed: {seg['speed']} km/h<br>"
                f"Free flow: {seg['free_flow_speed']} km/h<br>"
                f"Vehicles: {seg['vehicle_count']}<br>"
                f"Seg ID: {seg['seg_id']}",
                max_width=200
            )
        ).add_to(m)

    folium.PolyLine(
        locations=[
            (seg["seg_start_lat"], seg["seg_start_lng"]),
            (seg["seg_end_lat"],   seg["seg_end_lng"]),
        ],
        color=color,
        weight=weight,
        opacity=0.9,
        tooltip=(
            f"{seg['street_name']} | "
            f"{seg['speed']} km/h / {seg['free_flow_speed']} km/h ff | "
            f"{seg['incident_type']} sev{seg['severity']} | "
            f"{seg['vehicle_count']} vehicles"
        ),
    ).add_to(m)

# Progress bar on map showing timestamp position
progress_pct = int((ts_idx / (TOTAL_TS-1)) * 100)
progress_html = f"""
<div style="position:fixed;top:10px;left:50%;transform:translateX(-50%);
            z-index:1000;background:white;padding:8px 16px;
            border-radius:20px;border:1px solid #ccc;
            font-size:13px;font-weight:500;min-width:220px;text-align:center">
  {'▶' if st.session_state.playing else '⏸'} &nbsp;
  {phase_label} &nbsp;|&nbsp; T{ts_idx+1}/{TOTAL_TS}
  <div style="margin-top:5px;background:#eee;border-radius:4px;height:4px">
    <div style="width:{progress_pct}%;background:#3498DB;height:4px;border-radius:4px"></div>
  </div>
</div>
"""
m.get_root().html.add_child(folium.Element(progress_html))

st_folium(m, width="100%", height=580, returned_objects=[])

# ── Live data table ───────────────────────────────────────────────
with st.expander("Live segment data — current timestamp", expanded=False):
    display_df = current_df[[
        "seg_id","street_name","speed","free_flow_speed",
        "incident_type","severity","vehicle_count","direction"
    ]].sort_values("speed")
    st.dataframe(display_df, use_container_width=True, height=300)

# ── Auto-play ─────────────────────────────────────────────────────
if st.session_state.playing:
    if st.session_state.ts_index < TOTAL_TS - 1:
        time.sleep(st.session_state.play_speed)
        st.session_state.ts_index += 1
        st.rerun()
    else:
        st.session_state.playing  = False
        st.session_state.ts_index = 0
        st.rerun()