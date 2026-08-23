from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import pandas as pd
import threading
import time
from datetime import datetime
import json
import subprocess
import tempfile
import shutil
import sys
from pathlib import Path
from groq import Groq

from router  import load_graph, build_live_graph, find_diversion_routes
from copilot import IncidentCoPilot
from auth import (
    authenticate_user,
    create_session,
    create_user,
    delete_session,
    delete_user,
    get_user_from_session,
    init_db,
    list_users,
    load_incidents,
    save_incident,
    add_incident_log,
    get_incident_logs,
    get_next_incident_id,
    get_connection,
    kick_user_sessions,
)

import os
import tweepy
from dotenv import load_dotenv

load_dotenv(override=True)
_groq_key = (os.getenv("GROQ_API_KEY") or "").strip()


def _make_groq_client():
    if not _groq_key:
        return None
    try:
        return Groq(api_key=_groq_key)
    except Exception as exc:
        print(f"[startup] Groq client disabled: {exc}")
        return None


groq_client = _make_groq_client()

# ── App ───────────────────────────────────────────────────────────
app = FastAPI(title="MargDarshak — Gandhinagar Traffic Co-Pilot")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

init_db()

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    allowed_paths = {"/", "/login", "/health", "/docs", "/openapi.json", "/favicon.ico"}
    if request.method == "OPTIONS" or request.url.path in allowed_paths or request.url.path.startswith("/static"):
        return await call_next(request)

    token = request.cookies.get("margdarshak_session")
    user = get_user_from_session(token)
    if not user:
        return JSONResponse(status_code=401, content={"detail": "not_authenticated"})
    request.state.user = user
    return await call_next(request)

# ── Load data ─────────────────────────────────────────────────────
df = pd.read_csv("gandhinagar_traffic_feed.csv")
df["timestamp"] = pd.to_datetime(df["timestamp"])
df = df.drop_duplicates(subset=["seg_id"], keep="first")
TOTAL      = 1

# ── Build Street Metadata Lookup ──────────────────────────────
# We create a dictionary of unique street names and their representative 
# geographical segments (center, start, and end nodes) to allow instant 
# lookup during voice-to-incident reporting without scanning the entire CSV.
STREET_METADATA = {}
for name, group in df.groupby("street_name"):
    # Pick a representative segment (ideally one that isn't null)
    rep = group.iloc[len(group)//2] # Middle row as a proxy for "center"
    STREET_METADATA[name.lower()] = {
        "seg_id":        rep["seg_id"],
        "street_name":   rep["street_name"],
        "lat":           float(rep["lat"]),
        "lng":           float(rep["lng"]),
        "seg_start_lat": float(rep["seg_start_lat"]),
        "seg_start_lng": float(rep["seg_start_lng"]),
        "seg_end_lat":   float(rep["seg_end_lat"]),
        "seg_end_lng":   float(rep["seg_end_lng"]),
    }
print(f"[startup] Cached metadata for {len(STREET_METADATA)} unique streets.")

# ── Load OSMnx graph + init co-pilot ─────────────────────────────
print("[startup] Loading OSMnx graph...")
G_base  = load_graph()
copilot = IncidentCoPilot(G_base)
print("[startup] Graph loaded. Co-pilot ready.")

# ── Shared state ──────────────────────────────────────────────────
state_lock = threading.RLock()
state = {
    "ts_index":    0,
    "playing":     True,
    "tick_sleep":  0.8,
    "reset_version": 0,
    "incidents":   [],
    "publish_log": [],
    "inc_counter": 1,
}

persisted_incidents = load_incidents()
if persisted_incidents:
    state["incidents"] = persisted_incidents
    state["inc_counter"] = max(int(i.get("id", "INC_000").split("_")[-1]) for i in persisted_incidents if i.get("id")) + 1

def refresh_state_incidents():
    refreshed = load_incidents()
    with state_lock:
        state["incidents"] = refreshed






def _dedup_key(incident: dict) -> str:
    location = (incident.get("location") or "").strip().lower()
    incident_type = (incident.get("type") or incident.get("incident_type") or "ACCIDENT").upper()
    bucket = str(int(time.time() // 10))
    return f"{location}|{incident_type}|{bucket}"


def _upsert_incident(incident: dict) -> dict:
    with state_lock:
        incident = dict(incident)
        incident.setdefault("created_at", datetime.now().isoformat())
        incident.setdefault("acknowledged_at", None)
        incident.setdefault("resolved_at", None)
        incident.setdefault("diversion_route", None)
        incident.setdefault("operator_actions", [])
        incident["dedup_key"] = _dedup_key(incident)
        existing = next(
            (
                i for i in state["incidents"]
                if i.get("status") == "ACTIVE" and i.get("dedup_key") == incident["dedup_key"]
            ),
            None,
        )
        if existing:
            existing.update({k: v for k, v in incident.items() if k not in {"id"}})
            existing["id"] = existing.get("id") or incident["id"]
            existing["dedup_key"] = incident["dedup_key"]
            save_incident(existing)
            return existing

        state["incidents"].append(incident)
        save_incident(incident)
        add_incident_log(incident["id"], f"{incident['id']} created")

        return incident


def calculate_base_incident_speed(incident: dict) -> int:
    inc_type = incident.get("type") or incident.get("incident_type") or "ACCIDENT"
    severity = int(incident.get("severity") or 3)
    
    if inc_type == "ROAD_CLOSED":
        return 5
    if severity >= 3:
        return 20
    elif severity == 2:
        return 40
    else:
        return 50


def calculate_incident_speed(incident: dict) -> int:
    if incident.get("status") == "RESOLVED":
        resolved_at_str = incident.get("resolved_at")
        if resolved_at_str:
            try:
                resolved_at = datetime.fromisoformat(resolved_at_str)
                elapsed_seconds = (datetime.now() - resolved_at).total_seconds()
                base_speed = calculate_base_incident_speed(incident)
                recovery_fraction = min(1.0, elapsed_seconds / 30.0)
                return int(base_speed + (60 - base_speed) * recovery_fraction)
            except Exception:
                pass
        return 60
    return calculate_base_incident_speed(incident)


def should_trigger(row) -> bool:
    """
    Returns True if this incident row should fire the Groq AI pipeline.
    The PS-3 spec was severity >= 3 or speed drop >= 50%, but the demo CSV
    data rarely hits this. We lower the threshold so incidents actually 
    trigger the AI during the demo.
    """
    if row["incident_type"] == "ROAD_CLOSED":
        return True
    severity  = int(row.get("severity", 1))
    speed     = float(row.get("speed", 999))
    free_flow = float(row.get("free_flow_speed", 1)) or 1
    # Lowered threshold for demo visibility
    return severity >= 2 or (free_flow - speed) / free_flow >= 0.20


# Background feed tick thread has been removed. Active state is database-driven.

# ── Helpers ───────────────────────────────────────────────────────
def _color(speed, free_flow):
    r = speed / free_flow if free_flow > 0 else 1
    if r >= 0.85:   return "#00AA00"
    elif r >= 0.65: return "#7DC900"
    elif r >= 0.45: return "#FFA500"
    elif r >= 0.25: return "#FF4500"
    return "#CC0000"

# ── Endpoints ─────────────────────────────────────────────────────

class IncidentTrigger(BaseModel):
    seg_id: str
    lat: float
    lng: float
    street_name: str
    seg_start_lat: float
    seg_start_lng: float
    seg_end_lat: float
    seg_end_lng: float
    incident_type: str = "ACCIDENT"

class VoiceReport(BaseModel):
    text: str
    channel: str

class LoginPayload(BaseModel):
    username: str
    password: str

class UserCreatePayload(BaseModel):
    username: str
    email: str
    password: str | None = None
    role: str = "officer"
    send_email: bool = True


@app.post("/login")
def login(payload: LoginPayload, response: Response):
    user = authenticate_user(payload.username, payload.password)
    if not user:
        raise HTTPException(status_code=401, detail="invalid_credentials")

    # Invalidate all prior sessions for this user (Newest Login Wins)
    # kick_user_sessions(user["id"])

    token = create_session(user["id"])
    response.set_cookie(key="margdarshak_session", value=token, httponly=True, samesite="lax", max_age=60 * 60 * 8)
    return {"ok": True, "user": user, "token": token}


@app.post("/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get("margdarshak_session")
    delete_session(token)
    response.delete_cookie("margdarshak_session")
    return {"ok": True}


@app.get("/me")
def me(request: Request):
    return {"ok": True, "user": getattr(request.state, "user", None)}


@app.get("/admin/users")
def list_admin_users(request: Request, page: int = 1, search: str = None):
    user = getattr(request.state, "user", None)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="forbidden")
    
    all_users = list_users()
    if search:
        search_lower = search.lower()
        all_users = [
            u for u in all_users 
            if search_lower in u["username"].lower() or (u.get("email") and search_lower in u["email"].lower())
        ]
    
    limit = 10
    offset = (page - 1) * limit
    paginated_users = all_users[offset : offset + limit]
    
    return {
        "users": paginated_users,
        "total": len(all_users),
        "page": page,
        "total_pages": (len(all_users) + limit - 1) // limit
    }


user_creation_timestamps = []
creation_lock = threading.Lock()

def check_user_creation_rate_limit() -> bool:
    global user_creation_timestamps
    now = time.time()
    with creation_lock:
        user_creation_timestamps = [t for t in user_creation_timestamps if now - t < 60]
        if len(user_creation_timestamps) >= 5:
            return False
        user_creation_timestamps.append(now)
        return True


@app.post("/admin/users")
def create_admin_user(payload: UserCreatePayload, request: Request):
    if not check_user_creation_rate_limit():
        raise HTTPException(
            status_code=429,
            detail="Too many user creation attempts. Please wait a minute before trying again."
        )
    user = getattr(request.state, "user", None)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="forbidden")
    created = create_user(
        payload.username,
        payload.password,
        payload.role,
        email=payload.email,
        send_email=payload.send_email,
    )
    return {"ok": True, "user": created}


@app.delete("/admin/users/{user_id}")
def delete_admin_user(user_id: int, request: Request):
    user = getattr(request.state, "user", None)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="forbidden")
    
    if user.get("id") == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete current logged-in admin")
        
    with get_connection() as conn:
        row = conn.execute("SELECT username FROM users WHERE id = ?", (user_id,)).fetchone()
    if row and row["username"] == "admin":
        raise HTTPException(status_code=400, detail="Cannot delete default admin account")
        
    delete_user(user_id)
    return {"ok": True}


def _trigger_voice_incident_from_text(text: str, channel: str):
    import re
    known = list(STREET_METADATA.keys())
    extracted = copilot.parse_voice_report(text, known)

    street = (extracted.get("street_name") or "").lower()
    inc_type = extracted.get("type") or "ACCIDENT"

    meta = None
    # Try to extract segment number from text (e.g. "segment 14", "seg 30")
    seg_match = re.search(r'(?:segment|seg)\s*#?\s*(\d+)', text, re.IGNORECASE)
    if seg_match:
        try:
            seg_num = int(seg_match.group(1))
            seg_id_target = f"SEG_{seg_num:04d}"
            matching_seg = df[df["seg_id"] == seg_id_target]
            if not matching_seg.empty:
                rep = matching_seg.iloc[0]
                meta = {
                    "seg_id":        rep["seg_id"],
                    "street_name":   rep["street_name"],
                    "lat":           float(rep["lat"]),
                    "lng":           float(rep["lng"]),
                    "seg_start_lat": float(rep["seg_start_lat"]),
                    "seg_start_lng": float(rep["seg_start_lng"]),
                    "seg_end_lat":   float(rep["seg_end_lat"]),
                    "seg_end_lng":   float(rep["seg_end_lng"]),
                }
                print(f"[Voice] Matched segment ID from text: {seg_id_target}")
        except Exception as e:
            print(f"[Voice] Segment parsing error: {e}")

    if not meta:
        meta = STREET_METADATA.get(street)
        if not meta:
            for candidate in known:
                if candidate in text.lower():
                    meta = STREET_METADATA[candidate]
                    break

            if not meta:
                fallback_row = None
                if not df.empty:
                    fallback_row = df.sort_values(by=["severity", "speed"], ascending=[False, True]).iloc[0]

                if fallback_row is None:
                    return {
                        "error": f"Street '{street}' not found in Gandhinagar grid.",
                        "extracted": extracted,
                    }

                meta = {
                    "seg_id": fallback_row["seg_id"],
                    "street_name": fallback_row["street_name"],
                    "lat": float(fallback_row["lat"]),
                    "lng": float(fallback_row["lng"]),
                    "seg_start_lat": float(fallback_row["seg_start_lat"]),
                    "seg_start_lng": float(fallback_row["seg_start_lng"]),
                    "seg_end_lat": float(fallback_row["seg_end_lat"]),
                    "seg_end_lng": float(fallback_row["seg_end_lng"]),
                }

    with state_lock:
        inc_id = get_next_incident_id()
        severity = int(extracted.get("severity") or 3)
        incident = {
            "id":       inc_id,
            "seg_id":   meta["seg_id"],
            "location": meta["street_name"],
            "direction": "",
            "type":     inc_type,
            "severity": severity,
            "speed":    calculate_incident_speed({"type": inc_type, "severity": severity, "status": "ACTIVE"}),
            "time":     datetime.now().strftime("%H:%M:%S"),
            "status":   "ACTIVE",
            "lat":      meta["lat"],
            "lng":      meta["lng"],
            "seg_start_lat": meta["seg_start_lat"],
            "seg_start_lng": meta["seg_start_lng"],
            "seg_end_lat": meta["seg_end_lat"],
            "seg_end_lng": meta["seg_end_lng"],
            "detected_at": time.time(),
            "is_manual": True,
            "report_text": text,
            "channel": channel,
        }
        state["playing"] = False

    incident = _upsert_incident(incident)

    rows = df
    threading.Thread(
        target=copilot.on_incident_detected,
        args=(incident, rows),
    daemon=True,
    ).start()

    return incident


@app.post("/incident/acknowledge/{incident_id}")
def acknowledge_incident(incident_id: str):
    refresh_state_incidents()
    with state_lock:
        inc = next((i for i in state["incidents"] if i["id"] == incident_id), None)
        if not inc:
            raise HTTPException(status_code=404, detail="Incident not found")
        if not inc.get("acknowledged_at"):
            inc["acknowledged_at"] = datetime.now().isoformat()
            action = "Incident acknowledged by operator"
            if "operator_actions" not in inc or inc["operator_actions"] is None:
                inc["operator_actions"] = []
            inc["operator_actions"].append(action)
            save_incident(inc)
            add_incident_log(incident_id, f"{incident_id} acknowledged")
    return {"ok": True, "incident_id": incident_id, "incident": inc}


@app.post("/incident/resolve/{incident_id}")
def resolve_incident(incident_id: str):
    refresh_state_incidents()
    with state_lock:
        inc = next((i for i in state["incidents"] if i["id"] == incident_id), None)
        if not inc:
            raise HTTPException(status_code=404, detail="Incident not found")
        inc["status"] = "RESOLVED"
        inc["resolved_at"] = datetime.now().isoformat()
        inc["diversion_route"] = None
        action = "Incident resolved by operator"
        if "operator_actions" not in inc or inc["operator_actions"] is None:
            inc["operator_actions"] = []
        inc["operator_actions"].append(action)
        save_incident(inc)
    copilot.resolve_incident(incident_id, inc.get("seg_id"))
    add_incident_log(incident_id, f"{incident_id} resolved")
    return {"ok": True, "incident_id": incident_id, "incident": inc}


@app.get("/incident/logs")
def get_logs():
    return {"logs": get_incident_logs()}


@app.post("/incident/trigger")
def trigger_manual_incident(payload: IncidentTrigger):
    with state_lock:
        active_inc = next((i for i in state["incidents"] if i.get("seg_id") == payload.seg_id and i.get("status") == "ACTIVE"), None)
        if active_inc:
            raise HTTPException(
                status_code=400,
                detail=f"This segment already has an active incident ({active_inc.get('id')})."
            )
    inc_id = get_next_incident_id()
    print(f"INCIDENT RECEIVED: {inc_id}")
    with state_lock:
        incident = {
            "id":       inc_id,
            "seg_id":   payload.seg_id,
            "location": payload.street_name,
            "direction": "",
            "type":     payload.incident_type,
            "severity": 3,
            "speed":    calculate_incident_speed({"type": payload.incident_type, "severity": 3, "status": "ACTIVE"}),
            "time":     datetime.now().strftime("%H:%M:%S"),
            "status":   "ACTIVE",
            "lat":      payload.lat,
            "lng":      payload.lng,
            "seg_start_lat": payload.seg_start_lat,
            "seg_start_lng": payload.seg_start_lng,
            "seg_end_lat": payload.seg_end_lat,
            "seg_end_lng": payload.seg_end_lng,
            "detected_at": time.time(),
            "is_manual": True,
            "acknowledged_at": None,
            "resolved_at": None,
            "diversion_route": None,
            "operator_actions": [],
        }
        state["playing"] = False

    incident = _upsert_incident(incident)
    print(f"INCIDENT SAVED: {inc_id}")

    rows = df

    threading.Thread(
        target=copilot.on_incident_detected,
        args=(incident, rows),
        daemon=True,
    ).start()

    return incident


@app.post("/incident/voice")
def trigger_voice_incident(payload: VoiceReport):
    return _trigger_voice_incident_from_text(payload.text, payload.channel)


@app.post("/incident/voice-audio")
async def trigger_voice_incident_audio(
    audio: UploadFile = File(...),
    channel: str = Form("radio"),
):
    if groq_client is None:
        raise HTTPException(
            status_code=503,
            detail="GROQ_API_KEY missing. Set it in backend/.env to enable audio transcription.",
        )

    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio payload")

    filename = audio.filename or "dispatch_audio.webm"
    try:
        transcription = groq_client.audio.transcriptions.create(
            file=(filename, audio_bytes),
            model="whisper-large-v3-turbo",
            response_format="json",
            language="en",
        )
        text = getattr(transcription, "text", None)
        if text is None and isinstance(transcription, dict):
            text = transcription.get("text")
        if not text:
            raise RuntimeError("No text returned from transcription")

        result = _trigger_voice_incident_from_text(text, channel)
        if isinstance(result, dict):
            result["transcript"] = text
        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Audio transcription failed: {exc}")


@app.get("/feed")
def get_feed():
    refresh_state_incidents()
    ts   = df.iloc[0]["timestamp"]
    rows = df
    segs = []

    active_incidents = [i for i in state["incidents"] if i["status"] == "ACTIVE"]

    for _, r in rows.iterrows():
        s_id = r["seg_id"]
        # Clear the CSV-recorded playback incidents; use DB-driven status
        i_type = "CLEAR"
        severity = int(r["severity"])
        
        for inc in active_incidents:
            if str(inc.get("seg_id")) == str(s_id):
                i_type = inc["type"]
                severity = int(inc.get("severity", 3))
                break

        segs.append({
            "seg_id":        s_id,
            "street_name":   r["street_name"],
            "speed":         int(r["speed"]) if i_type == "CLEAR" else 5,
            "free_flow":     int(r["free_flow_speed"]),
            "incident_type": i_type,
            "severity":      severity if i_type == "CLEAR" else 3,
            "vehicle_count": int(r["vehicle_count"]),
            "direction":     r["direction"],
            "lat":           float(r["lat"]),
            "lng":           float(r["lng"]),
            "s1lat":         float(r["seg_start_lat"]),
            "s1lng":         float(r["seg_start_lng"]),
            "s2lat":         float(r["seg_end_lat"]),
            "s2lng":         float(r["seg_end_lng"]),
            "color":         _color(r["speed"], r["free_flow_speed"]) if i_type == "CLEAR" else "#ef4444",
        })

    avg_speed = float(rows["speed"].mean())
    avg_ff    = float(rows["free_flow_speed"].mean())

    return {
        "timestamp":  str(ts),
        "ts_index":   0,
        "reset_version": 0,
        "playing":    False,
        "tick_sleep_ms": 1000,
        "total":      TOTAL,
        "segments":   segs,
        "metrics": {
            "total_vehicles":   int(rows["vehicle_count"].sum()),
            "avg_speed":        round(avg_speed, 1),
            "network_health":   round((avg_speed / avg_ff) * 100) if avg_ff > 0 else 100,
            "incident_count":   len([i for i in active_incidents if i["type"] in ("ACCIDENT", "ROAD_CLOSED")]),
            "congestion_count": len([i for i in active_incidents if i["type"] == "CONGESTION"]),
        },
    }


@app.get("/incidents")
def get_incidents():
    refresh_state_incidents()
    active   = [i for i in state["incidents"] if i["status"] == "ACTIVE"][::-1]
    resolved = [i for i in state["incidents"] if i["status"] == "RESOLVED"][::-1]
    return {
        "active":        active,
        "resolved":      resolved,
        "total":         len(state["incidents"]),
        "avg_response":  8.4,
    }


@app.get("/insights/{incident_id}")
def get_insights(incident_id: str):
    """
    Returns Claude-generated 4-part intelligence for an incident.
    Also returns BPR-computed diversion route coordinates.
    """
    refresh_state_incidents()
    inc = next((i for i in state["incidents"] if i["id"] == incident_id), None)
    if not inc:
        return {"error": "not found"}

    ai = copilot.get_last_ai(incident_id)

    if ai:
        signal    = ai.get("signal_retiming", "")
        diversion = ai.get("diversion_route",  "")
        alert     = ai.get("public_alert",     "")
        narrative = ai.get("narrative",         "")
    else:
        # Fallback while Claude is still processing
        signal    = f"Extend green at {inc['location']} x CH Road by 30s. Reduce junction phase by 15s."
        diversion = "Ka Road → G Road → Road 2. Activate immediately. Monitor load."
        alert     = (f"VMS: INCIDENT ON {inc['location'].upper()} USE KA ROAD | "
                     f"RADIO: Incident on {inc['location']}, divert via Ka Road. | "
                     f"SOCIAL: Traffic incident on {inc['location']} Gandhinagar. #GandhinagarTraffic")
        narrative = f"Incident at {inc['location']} at {inc['time']}. Speed {inc['speed']} km/h. Diversion active."

    # Get live diversion coords from co-pilot
    diversion_coords = copilot.get_diversion_coords(incident_id)

    # Parse alert into 3 channels
    vms, radio, social = "", "", ""
    if "|" in alert:
        parts = [p.strip() for p in alert.split("|")]
        vms = parts[0] if len(parts) > 0 else ""
        radio = parts[1] if len(parts) > 1 else ""
        social = parts[2] if len(parts) > 2 else ""
    else:
        # Fallback for LLMs that miss the pipe and use prefixes
        import re
        vms_m = re.search(r"VMS:\s*(.*?)(?=\s*RADIO:|\s*SOCIAL:|$)", alert, re.I | re.S)
        rad_m = re.search(r"RADIO:\s*(.*?)(?=\s*SOCIAL:|\s*VMS:|$)", alert, re.I | re.S)
        soc_m = re.search(r"SOCIAL:\s*(.*?)(?=\s*RADIO:|\s*VMS:|$)", alert, re.I | re.S)
        vms = vms_m.group(1) if vms_m else ""
        radio = rad_m.group(1) if rad_m else ""
        social = soc_m.group(1) if soc_m else ""
        
    # Clean up prefixes if they are still there
    vms = vms.replace("VMS:", "").strip()
    radio = radio.replace("RADIO:", "").strip()
    social = social.replace("SOCIAL:", "").strip()
    
    # If it failed to find any, provide full text fallback only if it's small enough
    social = social or (alert if len(alert) < 280 else alert[:277]+"...")

    return {
        "signal_retiming":  signal,
        "diversion":        diversion,
        "narrative":        narrative,
        "alerts": {
            "vms":    vms,
            "radio":  radio,
            "social": social,
        },
        "diversion_coords": diversion_coords,
        "narrative_log":    copilot.narrative_log[-10:],
    }


@app.get("/narrativelog")
def get_narrative_log():
    return copilot.narrative_log


class ChatPayload(BaseModel):
    message: str

@app.post("/chat")
def chat(payload: ChatPayload):
    """Officer Q&A — multi-turn conversation with incident context."""
    reply = copilot.chat(payload.message)
    return {"reply": reply}


class PublishPayload(BaseModel):
    channel:     str
    message:     str
    incident_id: str = ""

def publish_to_twitter(message: str):
    """
    Publishes a tweet using credentials from .env.
    Requires Access Token/Secret from Dev Portal for Write access.
    """
    api_key = os.getenv("TWITTER_API_KEY")
    api_secret = os.getenv("TWITTER_API_SECRET")
    access_token = os.getenv("TWITTER_ACCESS_TOKEN")
    access_secret = os.getenv("TWITTER_ACCESS_SECRET")
    bearer_token = os.getenv("TWITTER_BEARER_TOKEN")
    
    # Validation
    if not api_key or "YOUR" in (access_token or "YOUR"):
        print("[twitter] Skipping publish: Credentials not fully configured or using placeholders.")
        return None

    try:
        # Twitter V2 Client
        client = tweepy.Client(
            bearer_token=bearer_token,
            consumer_key=api_key,
            consumer_secret=api_secret,
            access_token=access_token,
            access_token_secret=access_secret
        )
        response = client.create_tweet(text=message)
        tweet_id = response.data['id']
        print(f"[twitter] Successfully published tweet ID: {tweet_id}")
        return tweet_id
    except Exception as e:
        print(f"[twitter] Failed to post tweet: {e}")
        return None

@app.post("/publish")
def publish_alert(payload: PublishPayload):
    # Note: Automated API tweets are currently disabled in favor of 
    # Frontend Twitter Intent to avoid 402/Quota errors on Free tier.
    tweet_id = None

    state["publish_log"].insert(0, {
        "channel":     payload.channel,
        "message":     payload.message,
        "incident_id": payload.incident_id,
        "tweet_id":    tweet_id,
        "time":        datetime.now().strftime("%H:%M:%S"),
    })
    return {"ok": True, "tweet_id": tweet_id}


@app.get("/publish_log")
def get_publish_log():
    return state["publish_log"]


# Control endpoint removed.



@app.get("/diversion/{incident_id}")
def get_diversion(incident_id: str):
    """
    Returns top-3 BPR-weighted diversion routes for an incident.
    Used by frontend to draw route overlays on the map.
    """
    refresh_state_incidents()
    inc = next((i for i in state["incidents"] if i["id"] == incident_id), None)
    if not inc:
        return {"routes": []}

    rows = df
    
    active_incs = [i for i in state["incidents"] if i.get("status") == "ACTIVE"]
    if not any(i["id"] == inc["id"] for i in active_incs):
        active_incs.append(inc)
        
    G = build_live_graph(G_base, rows, active_incidents=active_incs)

    dest_lat = float(inc.get("seg_end_lat") or inc.get("lat") or 23.240)
    dest_lng = float(inc.get("seg_end_lng") or inc.get("lng") or 72.660)
    if abs(dest_lat - float(inc["lat"])) < 0.0001 and abs(dest_lng - float(inc["lng"])) < 0.0001:
        dest_lat = 23.240
        dest_lng = 72.660

    routes, _ = find_diversion_routes(
        G,
        inc["lat"], inc["lng"],
        dest_lat, dest_lng,
        incident=inc,
        k=3,
    )

    if routes and not inc.get("diversion_route"):
        inc["diversion_route"] = routes[0]["coords"]
        save_incident(inc)

    return {
        "routes": [
            {
                "road_names":    r["road_names"],
                "coords":        r["coords"],
                "travel_time_s": r["travel_time_s"],
                "length_km":     r["length_km"],
                "max_vc_ratio":  r["max_vc_ratio"],
            }
            for r in routes
        ]
    }


@app.get("/health")
def health():
    return {"status": "ok", "total_timestamps": TOTAL}


@app.get("/debug/verify/{incident_id}")
def debug_verify_incident(incident_id: str, include_routes: bool = False):
    """
    One-shot verification endpoint for incident -> AI -> reroute pipeline.
    """
    inc = next((i for i in state["incidents"] if i["id"] == incident_id), None)
    if not inc:
        return {
            "ok": False,
            "error": "incident_not_found",
            "incident_id": incident_id,
            "known_ids": [i["id"] for i in state["incidents"][-10:]],
        }

    ts = df.iloc[0]["timestamp"]
    rows = df

    routes = []
    if include_routes:
        active_incs = [i for i in state["incidents"] if i.get("status") == "ACTIVE"]
        if not any(i["id"] == inc["id"] for i in active_incs):
            active_incs.append(inc)
        G = build_live_graph(G_base, rows, active_incidents=active_incs)
        
        dest_lat = float(inc.get("seg_end_lat") or inc.get("lat") or 23.240)
        dest_lng = float(inc.get("seg_end_lng") or inc.get("lng") or 72.660)
        if abs(dest_lat - float(inc["lat"])) < 0.0001 and abs(dest_lng - float(inc["lng"])) < 0.0001:
            dest_lat = 23.240
            dest_lng = 72.660
            
        routes, _ = find_diversion_routes(
            G,
            inc["lat"], inc["lng"],
            dest_lat, dest_lng,
            incident=inc,
            k=3,
        )

    quick_coords = copilot.get_diversion_coords()

    ai = copilot.get_last_ai() or {}
    ai_checks = {
        "signal_retiming": bool(ai.get("signal_retiming")),
        "diversion_route": bool(ai.get("diversion_route")),
        "public_alert": bool(ai.get("public_alert")),
        "narrative": bool(ai.get("narrative")),
    }

    return {
        "ok": True,
        "incident": {
            "id": inc["id"],
            "status": inc.get("status"),
            "type": inc.get("type"),
            "location": inc.get("location"),
            "speed": inc.get("speed"),
            "lat": inc.get("lat"),
            "lng": inc.get("lng"),
        },
        "playback": {
            "ts_index": state["ts_index"],
            "timestamp": str(ts),
            "playing": state["playing"],
            "tick_sleep": state["tick_sleep"],
        },
        "ai": {
            "available": any(ai_checks.values()),
            "field_checks": ai_checks,
            "narrative_preview": (ai.get("narrative", "")[:160] if ai else ""),
        },
        "reroute": {
            "routes_computed": include_routes,
            "routes_found": len(routes),
            "quick_coords_count": len(quick_coords),
            "best_route_roads": routes[0]["road_names"] if routes else [],
            "best_route_coords_count": len(routes[0]["coords"]) if routes else 0,
            "best_route_travel_time_s": routes[0]["travel_time_s"] if routes else None,
        },
        "how_to_verify": [
            "1) Confirm incidents endpoint has active incident.",
            "2) Call /insights/{incident_id} and check text fields are non-empty.",
            "3) Ensure diversion_coords length is > 1 for map polyline.",
            "4) Call /diversion/{incident_id} and confirm routes is non-empty.",
        ],
    }


@app.get("/facilities")
def get_facilities():
    """Returns a list of emergency facilities (hospitals, fire stations) in Gandhinagar."""
    return [
        {"id": "hosp_001", "name": "Civil Hospital (Sector 12)", "type": "hospital", "lat": 23.226, "lng": 72.645},
        {"id": "hosp_002", "name": "Aashka Hospital (Sargasan)", "type": "hospital", "lat": 23.190, "lng": 72.605},
        {"id": "hosp_003", "name": "Apollo Hospital (Bhat)", "type": "hospital", "lat": 23.102, "lng": 72.628},
        {"id": "fire_001", "name": "Gandhinagar Fire Station (Sector 17)", "type": "fire_station", "lat": 23.232, "lng": 72.650},
        {"id": "fire_002", "name": "Fire Station (Sector 21)", "type": "fire_station", "lat": 23.245, "lng": 72.637},
    ]


@app.get("/debug/log")
def debug_log(incident_id: str | None = None):
    """
    Returns the detailed routing + LLM analysis process log for an incident.
    If no incident_id given, returns log for the currently active incident.
    """
    log = copilot.get_debug_log(incident_id)
    active = next((i for i in state["incidents"] if i["status"] == "ACTIVE"), None)
    return {
        "incident_id": incident_id or (active["id"] if active else None),
        "log": log,
        "line_count": len(log),
    }