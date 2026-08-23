import json
import re
import threading
from datetime import datetime

from groq import Groq
from dotenv import load_dotenv
import os
import pandas as pd

from router import find_diversion_routes, build_live_graph
from auth import save_incident, add_incident_log

load_dotenv(override=True)
GROQ_MODEL = os.getenv("GROQ_MODEL", "groq/compound-mini")
_groq_key = (os.getenv("GROQ_API_KEY") or "").strip()


def _make_groq_client():
    if not _groq_key:
        return None
    try:
        return Groq(api_key=_groq_key)
    except Exception as exc:
        print(f"[copilot] Groq client disabled: {exc}")
        return None


client = _make_groq_client()

SYSTEM_PROMPT = """You are a traffic incident co-pilot for Gandhinagar, Gujarat, India.
You assist traffic control officers during live incidents in real time.

Your outputs must always be specific and actionable.
Always reference real Gandhinagar road names — GH Road, CH Road, Road 3,
KH Road, G Road, Ka Road, Gandhinagar Bypass Road, etc.
Never use generic advice like "monitor traffic" without naming a road and intersection.

For every incident update respond with EXACTLY this JSON and no other text:
{
  "signal_retiming": "...",
  "diversion_route": "...",
  "public_alert": "...",
  "narrative": "..."
}
CRITICAL: The values inside this JSON must be plain text paragraphs. Do NOT nest JSON arrays, dictionaries, or stringified JSON inside the string values.

signal_retiming rules:
- Name the exact intersection e.g. "GH Road x CH Road"
- Give exact phase changes in seconds e.g. "extend green from 40s to 75s"
- Justify with current queue length or speed drop

diversion_route rules:
- Give 2 candidate routes in activation sequence
- Each route: road names, estimated travel time, current load % of capacity
- State which to activate first and when to activate the backup

public_alert rules:
- Write exactly 3 versions separated by |
- VMS: max 90 chars, ALL CAPS
- RADIO: one natural sentence under 25 words
- SOCIAL: under 160 chars, end with #GandhinagarTraffic

narrative rules:
- Write as a verbal briefing to the officer
- Include: what happened, current state, what will happen in 10 min, what to watch
- Under 60 words
- No bullet points — flowing prose only"""


def build_incident_prompt(incident: dict,
                           routes: list,
                           frame_df: pd.DataFrame,
                           elapsed_min: int) -> list[dict]:

    WATCH_ROADS = [
        "GH Road", "CH Road", "Road 3", "KH Road",
        "G Road", "Ka Road", "Gandhinagar Bypass Road", "Road 2",
    ]

    road_lines = []
    for road in WATCH_ROADS:
        segs = frame_df[frame_df["street_name"] == road]
        if segs.empty:
            continue
        avg_spd = round(segs["speed"].mean())
        avg_ff  = round(segs["free_flow_speed"].mean())
        avg_vc  = round(segs["vehicle_count"].mean())
        drop    = round((1 - avg_spd / avg_ff) * 100) if avg_ff > 0 else 0
        status  = segs["incident_type"].iloc[0]
        road_lines.append(
            f"  {road:30s}: {avg_spd:3d} km/h  "
            f"(ff {avg_ff}, -{drop}% drop, ~{avg_vc} vehicles, {status})"
        )

    route_lines = []
    for i, r in enumerate(routes[:2], 1):
        mins = r["travel_time_s"] // 60
        secs = r["travel_time_s"] % 60
        load = round(r["max_vc_ratio"] * 100)
        route_lines.append(
            f"  Route {i}: {' → '.join(r['road_names'])} | "
            f"{mins}m {secs}s | max load {load}% capacity"
        )

    user_content = f"""LIVE INCIDENT REPORT — Gandhinagar Traffic Management
=====================================================
Incident type    : {incident['type']} (severity {incident.get('severity', 1)}/3)
Location         : {incident['location']}
Coordinates      : {incident['lat']}, {incident['lng']}
Current speed    : {incident['speed']} km/h
Elapsed time     : {elapsed_min} minutes since detection

LIVE NETWORK STATE (current frame readings):
{chr(10).join(road_lines) if road_lines else '  No live data available'}

COMPUTED DIVERSION CANDIDATES (BPR load-weighted A*):
{chr(10).join(route_lines) if route_lines else '  No viable routes computed'}

Generate the four-part JSON response now.
Use only real Gandhinagar road names.
Be specific about intersections for signal retiming."""

    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user",   "content": user_content},
    ]


def _parse_llm_response(raw: str) -> dict:
    fallback = {
        "signal_retiming": "Signal data unavailable — use manual protocols.",
        "diversion_route": "Diversion route unavailable — use manual protocols.",
        "public_alert":    "VMS: INCIDENT ON GH ROAD USE ALTERNATE ROUTES | "
                           "RADIO: Incident on GH Road, please use alternate routes. | "
                           "SOCIAL: Traffic incident on GH Road Gandhinagar. Use alternate routes. #GandhinagarTraffic",
        "narrative":       "Incident detected. Automated analysis unavailable. Manual assessment required.",
    }
    try:
        clean  = re.sub(r"```json|```", "", raw).strip()
        result = json.loads(clean)
        required = {"signal_retiming", "diversion_route", "public_alert", "narrative"}
        if required.issubset(result.keys()):
            return result
    except Exception:
        pass
    return fallback


def _llm_chat(
    messages: list[dict],
    *,
    temperature: float,
    max_tokens: int,
    json_output: bool = False,
) -> str:
    if client is None:
        raise RuntimeError("Missing GROQ_API_KEY in backend/.env")

    kwargs = {
        "model": GROQ_MODEL,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "messages": messages,
    }
    if json_output:
        kwargs["response_format"] = {"type": "json_object"}

    response = client.chat.completions.create(**kwargs)
    return response.choices[0].message.content or ""


class IncidentCoPilot:
    """
    Manages the 30-second autonomous reasoning loop and officer chat.
    One instance per running server. Call on_incident_detected() when
    event_detector fires. Call on_feed_tick() on every CSV frame.
    """

    def __init__(self, G_base):
        self.G_base           = G_base
        self.G_live           = G_base          # updated every tick
        self._latest_frame_df = None
        self._active_incident = None
        self._incident_start  = None
        # Per-incident storage — keyed by incident id string
        self._ai_per_incident:     dict = {}    # id -> parsed LLM output dict
        self._routes_per_incident: dict = {}    # id -> list of route dicts
        self._debug_per_incident:  dict = {}    # id -> list of debug log strings
        self.narrative_log    = []              # list of {time, narrative, routes}
        self._chat_history    = []
        self._lock            = threading.Lock()
        self._timer           = None

    # ── Public interface ───────────────────────────────────────────

    def parse_voice_report(self, text: str, known_streets: list[str], channel: str = None) -> dict:
        """
        Uses LLM to extract street_name, incident_type, and severity from voice text based on the radio channel.
        """
        channel_guidance = ""
        if channel == "police":
            channel_guidance = "This is Police Dispatch. We handle accident reports and law enforcement events. Map to type: ACCIDENT or ROAD_CLOSED. Severity: 3 (High)."
        elif channel == "fire":
            channel_guidance = "This is Fire & Rescue. We handle fires, hazards, and rescue situations. Map to type: ROAD_CLOSED or ACCIDENT. Severity: 3 (High)."
        elif channel == "ems":
            channel_guidance = "This is Medical / EMS. We handle medical emergencies and ambulance routing. Map to type: ACCIDENT. Severity: 3 (High)."
        elif channel == "traffic":
            channel_guidance = "This is Traffic Control. We handle congestion, blockages, and signals. Map to type: CONGESTION or ROAD_CLOSED. Severity: 2 (Medium) or 1 (Low)."

        prompt = f"""
        You are a dispatch processor for Gandhinagar Traffic.
        {channel_guidance}
        Extract the street name, incident type, and severity from this radio transcript.
        
        Transcript: "{text}"
        
        Known Streets (Use these!): {", ".join(known_streets[:50])}...
        
        Respond ONLY in JSON format:
        {{
            "street_name": "string or null",
            "type": "ACCIDENT or ROAD_CLOSED or CONGESTION or null",
            "severity": 1
        }}
        """
        try:
            raw = _llm_chat(
                [{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=100
            )
            match = re.search(r"\{.*\}", raw, re.DOTALL)
            if match:
                return json.loads(match.group(0))
        except Exception as e:
            print(f"[copilot] Voice parse failed: {e}")
        return {"street_name": None, "type": None}

    def on_feed_tick(self, frame_df: pd.DataFrame):
        """Call on every CSV frame tick; keep this non-blocking for playback."""
        with self._lock:
            self._latest_frame_df = frame_df

    def on_incident_detected(self, incident: dict, frame_df: pd.DataFrame):
        """
        Call when event_detector fires.
        incident dict must have: id, seg_id, location, type, severity,
                                 speed, time, lat, lng
        """
        threading.Thread(
            target=self._run_analysis,
            args=(incident, frame_df),
            daemon=True,
        ).start()

    def resolve_incident(self, incident_id: str, seg_id: str):
        with self._lock:
            self._routes_per_incident.pop(incident_id, None)
            self._ai_per_incident.pop(incident_id, None)
            self._debug_per_incident.pop(incident_id, None)

    def get_last_ai(self, incident_id: str | None = None) -> dict | None:
        """Return AI output for a specific incident, or the active one if no id given."""
        with self._lock:
            if incident_id:
                return self._ai_per_incident.get(incident_id)
            if self._ai_per_incident:
                return list(self._ai_per_incident.values())[-1]
            return None

    def get_diversion_coords(self, incident_id: str | None = None) -> list:
        """Returns polyline coords for the best cached diversion route."""
        with self._lock:
            iid = incident_id
            if not iid and self._routes_per_incident:
                iid = list(self._routes_per_incident.keys())[-1]
            routes = list(self._routes_per_incident.get(iid, [])) if iid else []
        return routes[0]["coords"] if routes else []

    def get_debug_log(self, incident_id: str | None = None) -> list[str]:
        """Returns the detailed routing/analysis process log for an incident."""
        with self._lock:
            iid = incident_id
            if not iid and self._debug_per_incident:
                iid = list(self._debug_per_incident.keys())[-1]
            return list(self._debug_per_incident.get(iid, [])) if iid else []

    def chat(self, officer_message: str) -> str:
        """Multi-turn officer Q&A with full incident context injected."""
        with self._lock:
            incident  = self._active_incident
            # Get the AI output scoped to the active incident
            ai_output = (
                self._ai_per_incident.get(incident["id"])
                if incident else None
            )
            history   = list(self._chat_history)

        context = "No active incident."
        if incident and ai_output:
            context = (
                f"Active incident: {incident['type']} on {incident['location']}. "
                f"Speed: {incident['speed']} km/h. "
                f"Narrative: {ai_output.get('narrative', '')} "
                f"Recommended diversion: {ai_output.get('diversion_route', '')}"
            )

        messages = [
            {
                "role": "system",
                "content": (
                    "You are a traffic incident co-pilot for Gandhinagar, India. "
                    "Answer officer questions directly in 1-3 sentences. "
                    "Reference real road names. "
                    "If uncertain about safety-critical information say so clearly. "
                    f"Current context: {context}"
                ),
            },
            *history,
            {"role": "user", "content": officer_message},
        ]

        try:
            reply = _llm_chat(messages, temperature=0.2, max_tokens=220)
            print(f"[copilot] Chatbot Raw Reply: {repr(reply)}")
        except Exception as e:
            reply = f"Co-pilot error: {str(e)}"

        with self._lock:
            self._chat_history.extend([
                {"role": "user",      "content": officer_message},
                {"role": "assistant", "content": reply},
            ])
            self._chat_history = self._chat_history[-40:]

        return reply

    # ── Internal ───────────────────────────────────────────────────

    def _run_analysis(self, incident: dict, frame_df: pd.DataFrame):
        try:
            with self._lock:
                self._active_incident = incident
            incident_id = incident["id"]
            print(f"ROUTING STARTED: {incident_id}")
            add_incident_log(incident_id, f"Routing started for {incident_id}")
            
            start = datetime.fromisoformat(incident["created_at"]) if "created_at" in incident else datetime.now()
            elapsed = round((datetime.now() - start).total_seconds() / 60)

            try:
                from auth import load_incidents
                active_incidents = [i for i in load_incidents() if i.get("status") == "ACTIVE"]
                if not any(i["id"] == incident["id"] for i in active_incidents):
                    active_incidents.append(incident)
                G_live = build_live_graph(self.G_base, frame_df, active_incidents=active_incidents)
            except Exception as e:
                print(f"[copilot] build_live_graph failed: {e}")
                add_incident_log(incident_id, f"A* routing failed for {incident_id}")
                return

            try:
                dest_lat = float(incident.get("seg_end_lat") or incident.get("lat") or 23.240)
                dest_lng = float(incident.get("seg_end_lng") or incident.get("lng") or 72.660)
                
                # If destination is identical to origin, use a default city center destination for detour
                if abs(dest_lat - float(incident["lat"])) < 0.0001 and abs(dest_lng - float(incident["lng"])) < 0.0001:
                    dest_lat = 23.240
                    dest_lng = 72.660

                routes, route_debug = find_diversion_routes(
                    self.G_base,
                    float(incident["lat"]), float(incident["lng"]),
                    dest_lat, dest_lng,
                    incident=incident,
                    k=3,
                )
                print(f"ROUTING COMPLETED: {incident_id}")
            except Exception as e:
                print(f"ROUTING FAILED: {incident_id} - {e}")
                add_incident_log(incident_id, f"A* routing failed for {incident_id}")
                routes, route_debug = [], [f"[ROUTE] Fatal crash: {e}"]

            diversion_route = routes[0]["coords"] if routes else []
            
            # Update shared state and persist
            incident["diversion_route"] = diversion_route
            save_incident(incident)
            
            if diversion_route:
                add_incident_log(incident_id, f"Routing generated for {incident_id}")
            else:
                add_incident_log(incident_id, f"A* routing failed to find path for {incident_id}")

            # Save routing results to cache immediately so frontend maps can render routes
            with self._lock:
                self._routes_per_incident[incident_id] = routes
                ts = datetime.now().strftime("%H:%M:%S")
                self._debug_per_incident[incident_id] = (
                    [f"[RUN]    Analysis at {ts}"] +
                    route_debug
                )

            print(f"AI ANALYSIS STARTED: {incident_id}")
            messages = build_incident_prompt(incident, routes, frame_df, elapsed)
            try:
                llm_raw = _llm_chat(
                    messages,
                    temperature=0.15,
                    max_tokens=900,
                    json_output=True,
                )
                ai_output = _parse_llm_response(llm_raw)
                with self._lock:
                    self._ai_per_incident[incident_id] = ai_output
                    ts = datetime.now().strftime("%H:%M:%S")
                    llm_debug = [
                        f"[LLM]    Model: {GROQ_MODEL} | temp=0.15 | max_tokens=900",
                        f"[LLM]    Incident: {incident['type']} on {incident['location']}",
                        f"[LLM]    signal_retiming: {ai_output.get('signal_retiming', '')[:80]}...",
                        f"[LLM]    diversion_route: {ai_output.get('diversion_route', '')[:80]}...",
                    ]
                    self._debug_per_incident[incident_id].extend(llm_debug)
            except Exception as e:
                print(f"[copilot] Groq call failed: {e}")

        except Exception as e:
            print(f"[copilot] Unhandled error in _run_analysis: {e}")