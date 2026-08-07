import streamlit as st
import pandas as pd
from pipeline.feed_simulator import FeedSimulator
from pipeline.road_network import load_graph, get_route
import threading

st.set_page_config(page_title="Agent 1 Tester", layout="wide")
st.title("🚧 Agent 1 (Data Pipeline) - Test Dashboard")

# Use a pure Python class to act as a memory store across threads. 
# This avoids any Streamlit session_state context issues in background threads.
class DataStore:
    ticks = []
    events = []

# Define our mock callbacks
def on_tick(row):
    DataStore.ticks.append(row)
    # Keeping only latest 100
    if len(DataStore.ticks) > 100:
        DataStore.ticks.pop(0)

def on_event(row):
    DataStore.events.append(row)

# Start simulator exactly as WS-3 will
if 'sim' not in st.session_state:
    st.session_state.sim = FeedSimulator(tick_seconds=10) 
    st.session_state.sim.start(on_tick, on_event)
    st.success("Simulator thread successfully started! Fetching data from TomTom...")

# Layout for visualizing outputs
col1, col2 = st.columns(2)

with col1:
    st.subheader("📡 Live TomTom Feed (on_tick)")
    if DataStore.ticks:
        df = pd.DataFrame(DataStore.ticks)
        # Display the data frame so we can verify the schema
        st.dataframe(df, use_container_width=True)
        
        # Plot incidents directly on Streamlit's native map
        if 'lat' in df.columns and 'lng' in df.columns:
            map_df = df.rename(columns={"lat": "latitude", "lng": "longitude"})
            st.map(map_df, zoom=11)
    else:
        st.info("Waiting for first TomTom API poll...")

with col2:
    st.subheader("🚨 Triggered Events (on_event)")
    st.caption("Rows that passed the `event_detector.py` threshold filters.")
    if DataStore.events:
        event_df = pd.DataFrame(DataStore.events)
        st.dataframe(event_df, use_container_width=True)
    else:
        st.info("No high severity events / major speed drops detected yet.")

st.divider()

# Test the Road Network isolation
st.subheader("🗺️ Road Network Test")
st.write("Test our OSMnx graph builder and A* routing independently.")

if st.button("Test OSMnx Graph Cache & Routing"):
    with st.spinner("Downloading/Loading graph (Takes 1-2 mins on first run, instant afterwards)..."):
        G = load_graph()
        st.success(f"Graph loaded successfully! Nodes: {len(G.nodes)}")
        
        # Provide sample coordinates for Ahmedabad (e.g., SG Highway to Paldi)
        route_names = get_route(G, 23.0369, 72.5269, 23.0225, 72.5714)
        st.write("**Extracted Diversion Route Names:**")
        st.write(route_names)

# Manual refresh to poll new data into UI
st.button("🔄 Refresh Data View", help="Pulls latest data from the background thread into the UI")
