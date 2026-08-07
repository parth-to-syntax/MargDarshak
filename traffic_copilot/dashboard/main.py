import streamlit as st
import folium
from streamlit_folium import st_folium
import os
import sys
from dotenv import load_dotenv

load_dotenv()
TOMTOM_API_KEY = os.getenv("TOMTOM_API_KEY", "")

# Add the parent directory to sys.path to import pipeline
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from pipeline.feed_simulator import FeedSimulator

st.set_page_config(layout="wide", page_title="Traffic Incident Co-Pilot Map")

st.title("Traffic Incident Co-Pilot - Agent 3 Dashboard")
st.markdown("Live traffic data powered by TomTom API. This is a prototype map interface.")

def on_tick(incident):
    pass

def on_event(incident):
    pass

# Initialize the feed simulator in session state so it doesn't spin up every rerun
if 'feed' not in st.session_state or not hasattr(st.session_state.feed, 'latest_data'):
    if 'feed' in st.session_state:
        st.session_state.feed.stop()
    st.session_state.feed = FeedSimulator(tick_seconds=5.0) # fetch every 5 seconds
    st.session_state.feed.start(on_tick, on_event)

# Let the user manually trigger an update or it just gets latest
if st.button("Refresh Map Data"):
    pass

col1, col2 = st.columns([3, 1])

# Get the latest simulated data dict
incidents = getattr(st.session_state.feed, 'latest_data', [])

with col1:
    # Ahmedabad coordinates
    m = folium.Map(location=[23.0225, 72.5714], zoom_start=12)

    # Add TomTom Traffic Flow Layer (Colors roads like Google Maps)
    if TOMTOM_API_KEY:
        tomtom_flow_url = f"https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{{z}}/{{x}}/{{y}}.png?key={TOMTOM_API_KEY}"
        folium.TileLayer(
            tiles=tomtom_flow_url,
            attr="TomTom Traffic",
            name="Live Traffic Flow",
            overlay=True,
            control=True
        ).add_to(m)

    # Plot incidents
    for incident in incidents:
        if "lat" in incident and "lng" in incident:
            lat = incident["lat"]
            lon = incident["lng"]
            
            severity = incident.get("severity", "UNKNOWN")
            delay = incident.get("delay", 0)
            event_type = incident.get("incident_type", "Traffic")
            
            # Determine color by severity
            color = "green"
            if severity == "MAJOR" or severity == 3:
                 color = "red"
            elif severity in ["MINOR", "MODERATE", 1, 2]:
                 color = "orange"
            
            popup_text = f"<b>{event_type}</b><br>Severity: {severity}<br>Delay: {delay}s"
            
            folium.Marker(
                [lat, lon],
                popup=popup_text,
                icon=folium.Icon(color=color, icon="info-sign"),
            ).add_to(m)

    # Render map
    st_data = st_folium(m, width="100%", height=600)

with col2:
    st.subheader("Active Incidents")
    if not incidents:
        st.write("No incidents currently tracked.")
    for inc in incidents:
        st.info(f"{inc.get('incident_type', 'Incident')} - {inc.get('street_name', 'Unknown Road')} \nSeverity: {inc.get('severity', 'UNK')}, Delay: {inc.get('delay', 0)}s")

