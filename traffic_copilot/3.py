import pandas as pd
import random
from datetime import datetime, timedelta

random.seed(42)

seg_df = pd.read_csv("gandhinagar_segments_real.csv")

# ── Incident classification ───────────────────────────────────────
INCIDENT_ROAD   = "GH Road"

ADJACENT_ROADS  = [
    "CH Road",
    "Road 3",
]

DIVERSION_ROADS = [
    "G Road",
    "KH Road",
    "Road 2",
    "Ka Road",
]

HIGHWAY_ROADS   = [
    "Gandhinagar Bypass Road",
    "Koba - Gandhinagar Highway",
    "Gandhinagar-Ahmedabad Highway",
]

def classify(street):
    if street == INCIDENT_ROAD:       return "incident"
    if street in ADJACENT_ROADS:      return "adjacent"
    if street in DIVERSION_ROADS:     return "diversion"
    if street in HIGHWAY_ROADS:       return "highway"
    return "background"

def get_phase(ts):
    if ts <= 19:  return "normal"
    if ts <= 24:  return "buildup"
    if ts == 25:  return "trigger"
    if ts <= 45:  return "ripple"
    if ts <= 65:  return "recovery"
    return "clear"

def compute_speed(ff, phase, role):
    n = random.randint
    if phase == "normal":
        return max(15, ff + n(-5, 5))
    elif phase == "buildup":
        if role == "incident":   return max(10, ff - n(15, 25))
        if role == "adjacent":   return max(15, ff - n(5, 10))
        return max(15, ff + n(-5, 3))
    elif phase == "trigger":
        if role == "incident":   return n(4, 10)
        if role == "adjacent":   return max(10, ff - n(20, 30))
        if role == "diversion":  return max(20, ff - n(8, 18))
        if role == "highway":    return max(30, ff - n(5, 10))
        return max(20, ff + n(-5, 5))
    elif phase == "ripple":
        if role == "incident":   return n(5, 12)
        if role == "adjacent":   return max(10, ff - n(18, 28))
        if role == "diversion":  return max(15, ff - n(12, 22))
        if role == "highway":    return max(25, ff - n(8, 15))
        return max(20, ff + n(-8, 5))
    elif phase == "recovery":
        if role == "incident":   return max(15, ff - n(10, 20))
        if role == "adjacent":   return max(20, ff - n(8, 15))
        if role == "diversion":  return max(25, ff - n(5, 12))
        if role == "highway":    return max(35, ff - n(3, 8))
        return max(25, ff + n(-5, 5))
    else:  # clear
        return max(25, ff + n(-4, 4))

def compute_incident_type(phase, role, speed, ff):
    drop = 1 - (speed / ff) if ff > 0 else 0

    if phase in ("normal", "clear"):
        return "CLEAR", 1

    if role == "incident":
        if phase in ("trigger", "ripple"):  return "ACCIDENT",   3
        if phase == "buildup":              return "CONGESTION", 2
        if phase == "recovery":             return "CONGESTION", 2
        return "CLEAR", 1

    # All other roles — based on speed drop
    if drop >= 0.55:  return "CONGESTION", 3
    if drop >= 0.35:  return "CONGESTION", 2
    if drop >= 0.15:  return "CONGESTION", 1
    return "CLEAR", 1

def compute_vehicle_count(speed, ff, role, phase):
    drop  = max(0, 1 - (speed / ff)) if ff > 0 else 0
    base  = int(20 + 150 * drop)
    # Diversion roads get extra vehicles
    if role == "diversion" and phase in ("ripple", "recovery"):
        base = int(base * 1.4)
    return max(5, min(base + random.randint(-10, 10), 200))

# ── Generate rows ─────────────────────────────────────────────────
BASE_TIME = datetime(2024, 3, 15, 8, 0, 0)
TIMESTAMPS = 80
rows = []

for ts in range(TIMESTAMPS):
    phase  = get_phase(ts)
    ts_str = (BASE_TIME + timedelta(minutes=ts * 5)).strftime("%Y-%m-%d %H:%M:%S")

    for _, seg in seg_df.iterrows():
        role  = classify(seg["street_name"])
        ff    = int(seg["free_flow_speed"])
        speed = compute_speed(ff, phase, role)
        inc_type, severity = compute_incident_type(phase, role, speed, ff)
        v_count = compute_vehicle_count(speed, ff, role, phase)

        rows.append({
            "timestamp":       ts_str,
            "seg_id":          seg["seg_id"],
            "street_name":     seg["street_name"],
            "speed":           speed,
            "free_flow_speed": ff,
            "incident_type":   inc_type,
            "severity":        severity,
            "vehicle_count":   v_count,
            "direction":       seg["direction"],
            "seg_start_lat":   seg["seg_start_lat"],
            "seg_start_lng":   seg["seg_start_lng"],
            "seg_end_lat":     seg["seg_end_lat"],
            "seg_end_lng":     seg["seg_end_lng"],
            "lat":             seg["lat"],
            "lng":             seg["lng"],
        })

feed_df = pd.DataFrame(rows)
feed_df.to_csv("gandhinagar_traffic_feed.csv", index=False)

print(f"Total rows     : {len(feed_df)}")
print(f"Segments       : {len(seg_df)}")
print(f"Timestamps     : {TIMESTAMPS}")
print(f"File size      : {feed_df.memory_usage(deep=True).sum() / 1e6:.1f} MB")

# ── Sanity check on trigger timestamp ────────────────────────────
trigger_ts = (BASE_TIME + timedelta(minutes=25 * 5)).strftime("%Y-%m-%d %H:%M:%S")
check_roads = [INCIDENT_ROAD] + ADJACENT_ROADS + DIVERSION_ROADS

sample = feed_df[
    (feed_df["timestamp"] == trigger_ts) &
    (feed_df["street_name"].isin(check_roads))
].drop_duplicates(subset="street_name")[[
    "street_name", "speed", "free_flow_speed",
    "incident_type", "severity", "vehicle_count"
]]

print(f"\nTrigger moment snapshot (ts=25 → {trigger_ts}):")
print(sample.to_string(index=False))
