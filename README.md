# SkyGrid - Gandhinagar Traffic Incident Co-Pilot

SkyGrid is an AI-assisted traffic operations platform for Gandhinagar that combines:

- Live traffic feed playback from CSV
- Incident detection and lifecycle tracking
- LLM-generated response guidance (signal retiming, diversion text, public alerts, narrative)
- Diversion route computation on a real road graph using OSMnx + NetworkX
- Multi-channel alert publishing workflow (VMS / radio / social)
- Voice-triggered incident creation (text and audio transcription)

The project is split into a FastAPI backend (`server/`) and a Vite + React frontend (`client/`).

## 1) What This Project Does

SkyGrid simulates and supports an urban traffic command center workflow:

1. A backend loop replays timestamped road-segment telemetry from `gandhinagar_traffic_feed.csv`.
2. Incidents (`ACCIDENT`, `ROAD_CLOSED`) are detected and tracked in shared state.
3. A co-pilot service computes live diversion candidates using BPR-weighted edge travel times.
4. Groq LLM generates operator-ready guidance in 4 outputs:
   - signal_retiming
   - diversion_route
   - public_alert
   - narrative
5. Frontend pages expose this data for operations teams:
   - dashboard map + incident panel
   - incident command center
   - alert command center
   - radio voice intake

## 2) High-Level Architecture

### Backend (`server/`)

- `api.py`
  - FastAPI app startup and all HTTP endpoints
  - In-memory playback and incident state
  - Background tick loop for feed progression
  - Voice/audio incident trigger endpoints
  - Alert publishing + debug endpoints
- `copilot.py`
  - Incident co-pilot orchestration
  - Prompting and parsing for Groq outputs
  - 30-second autonomous refresh loop during active incidents
  - Officer chat context handling
- `router.py`
  - OSMnx graph load/cache
  - Live edge-weight overlay from feed frames
  - BPR travel-time modeling
  - K-shortest simple path generation for diversion candidates

### Frontend (`client/`)

- React + Vite + Tailwind app
- Main pages:
  - `Dashboard.jsx`: map, incident status, AI insights, playback control
  - `Incidents.jsx`: active/resolved incident command view
  - `Alerts.jsx`: channel-specific alert generation + publish log
  - `Radio.jsx`: push-to-talk voice capture and incident registration

## 3) Repository Structure

```text
skygrid/
  server/
    api.py
    copilot.py
    router.py
    gandhinagar_traffic_feed.csv
    ahmedabad.graphml
    DEBUGGING_STEPS.md
    test_twitter.py
  client/
    package.json
    index.html
    src/
      App.jsx
      config.js
      pages/
        Dashboard.jsx
        Incidents.jsx
        Alerts.jsx
        Radio.jsx
        LandingPage.jsx
      components/
      hooks/
  data/
  traffic_copilot/
  traffic_simulation/
```

Note: `server/` and `client/` form the main integrated web application flow.

## 4) Prerequisites

- Python 3.10+ (recommended 3.11)
- Node.js 18+ and npm
- macOS/Linux shell (commands below assume zsh/bash)
- Groq API key for LLM features (and audio transcription endpoint)

Optional:

- Twitter/X developer credentials for social publishing

## 5) Environment Variables

Create `server/.env`:

```env
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=llama-3.1-8b-instant

# Optional: only needed for /publish SOCIAL channel
TWITTER_API_KEY=...
TWITTER_API_SECRET=...
TWITTER_ACCESS_TOKEN=...
TWITTER_ACCESS_SECRET=...
TWITTER_BEARER_TOKEN=...
```

Frontend runtime override (optional):

- `VITE_API_URL` in frontend environment, or
- `SKYGRID_API_BASE_URL` in browser localStorage (configured from UI profile settings)

## 6) Local Setup

### A) Backend setup

```bash
cd server
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install fastapi uvicorn pandas python-dotenv tweepy python-multipart groq osmnx networkx
```

### B) Frontend setup

```bash
cd client
npm install
```

## 7) Run the Application

### Terminal 1: Start backend

Important: run from `server` so relative paths to CSV and graph cache resolve correctly.

```bash
cd server
source .venv/bin/activate
uvicorn api:app --host 0.0.0.0 --port 8000 --reload
```

### Terminal 2: Start frontend

```bash
cd client
npm run dev
```

Open the Vite URL shown in terminal (typically `http://localhost:5173`).

## 8) Core Workflows

### Playback and incident analysis

1. Backend replay loop steps through feed timestamps.
2. Incident rows create `ACTIVE` incidents in backend state.
3. Co-pilot thread computes diversion routes and calls Groq.
4. Frontend polls `/feed`, `/incidents`, `/insights/{incident_id}` and updates map/UI.

### Voice-based incident reporting

- Text trigger: `POST /incident/voice`
- Audio trigger + transcription: `POST /incident/voice-audio`

Both paths create incidents and start analysis threads.

## 9) API Quick Reference

### Health and playback

- `GET /health` - service status
- `GET /feed` - current frame, metrics, and segments
- `GET /control?action=play|pause|reset|seek|speed` - playback control

### Incident operations

- `GET /incidents` - active/resolved lists
- `POST /incident/trigger` - manual map-triggered incident
- `POST /incident/voice` - text-driven voice report parsing
- `POST /incident/voice-audio` - audio upload + transcription + incident creation

### AI and routing

- `GET /insights/{incident_id}` - co-pilot output + diversion polyline
- `GET /diversion/{incident_id}` - top diversion routes
- `POST /chat` - officer chat Q&A
- `GET /narrativelog` - narrative history

### Alerts and publishing

- `POST /publish` - publish to VMS/RADIO/SOCIAL workflow
- `GET /publish_log` - publish audit trail

### Diagnostics

- `GET /debug/verify/{incident_id}` - end-to-end AI/reroute verification
- `GET /debug/log?incident_id=...` - route + LLM process logs
- `GET /facilities` - static emergency facility locations

## 10) Frontend Pages

- `/` - landing page
- `/dashboard` - live operations dashboard
- `/incidents` - command center incident tracking
- `/alerts` - multi-channel alert authoring/publishing
- `/radio` - push-to-talk voice command UI

## 11) Data and Graph Files

- Feed CSV loaded by backend:
  - `server/gandhinagar_traffic_feed.csv`
- OSMnx graph cache:
  - `server/ahmedabad.graphml`

If the graph file is missing, `router.py` can build and save it for the configured city query (`Gandhinagar, Gujarat, India`).

## 12) Troubleshooting

Use `server/DEBUGGING_STEPS.md` for incident verification.

Common issues:

- Backend fails at startup due to missing CSV:
  - Ensure server is launched from `server/`.
- Groq features not responding:
  - Check `GROQ_API_KEY` in `server/.env`.
- Frontend shows offline feed:
  - Confirm backend on `http://localhost:8000` and API base URL settings in profile dropdown.
- Social publish does not create tweet:
  - Verify all Twitter credentials and app write permissions.

## 13) Development Notes

- Backend state is in-memory; restarting the server resets incidents and playback state.
- The tick loop auto-runs in a daemon thread on backend startup.
- Incident resolution includes a minimum lifetime guard to keep incidents visible during async AI generation.
- Route generation currently uses a fixed destination in `/diversion/{incident_id}` and incident endpoint coordinates in co-pilot flow.

## 14) Suggested Next Improvements

- Add pinned backend `requirements.txt` for reproducible installs
- Add test suite for API endpoints and routing logic
- Move secrets handling to environment manager / vault for deployment
- Persist incident lifecycle and publish logs to a database
- Add Docker compose for one-command startup

---

Built for AI-assisted traffic incident management and command center simulation.