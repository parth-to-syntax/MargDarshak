# import pandas as pd
# import random
# import math
# from datetime import datetime, timedelta

# random.seed(42)

# seg_df = pd.read_csv("gandhinagar_segments_real.csv")

# # ── Pick ONE specific incident segment ───────────────────────────
# # Find a GH Road segment near a Road 3 crossing — central location
# # Filter GH Road segments and pick the one closest to city centre
# gh_segs = seg_df[seg_df["street_name"] == "GH Road"]
# city_centre_lat, city_centre_lng = 23.215, 72.645

# gh_segs = gh_segs.copy()
# gh_segs["dist_to_centre"] = gh_segs.apply(
#     lambda r: math.sqrt(
#         (r["lat"] - city_centre_lat)**2 +
#         (r["lng"] - city_centre_lng)**2
#     ), axis=1
# )
# incident_seg = gh_segs.nsmallest(1, "dist_to_centre").iloc[0]

# INCIDENT_SEG_ID  = incident_seg["seg_id"]
# INCIDENT_LAT     = incident_seg["lat"]
# INCIDENT_LNG     = incident_seg["lng"]

# print(f"Incident segment : {INCIDENT_SEG_ID}")
# print(f"Street           : {incident_seg['street_name']}")
# print(f"Coordinates      : {INCIDENT_LAT}, {INCIDENT_LNG}")

# # ── Distance-based classification ────────────────────────────────
# HIGHWAY_ROADS = [
#     "Gandhinagar Bypass Road",
#     "Koba - Gandhinagar Highway",
#     "Gandhinagar-Ahmedabad Highway",
# ]

# def haversine_m(lat1, lng1, lat2, lng2):
#     """Distance in metres between two lat/lng points."""
#     R    = 6371000
#     phi1 = math.radians(lat1)
#     phi2 = math.radians(lat2)
#     dphi = math.radians(lat2 - lat1)
#     dlam = math.radians(lng2 - lng1)
#     a    = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlam/2)**2
#     return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

# def classify(seg):
#     """
#     Returns role based on distance from incident point.
#     Same-named road uses tighter distance bands.
#     Other roads use looser bands.
#     """
#     dist = haversine_m(
#         seg["lat"], seg["lng"],
#         INCIDENT_LAT, INCIDENT_LNG
#     )
#     name = seg["street_name"]

#     # The exact incident segment
#     if seg["seg_id"] == INCIDENT_SEG_ID:
#         return "incident", dist

#     # Same road (GH Road) — distance-based severity
#     if name == "GH Road":
#         if dist <= 300:   return "gh_near",   dist   # queue right behind
#         if dist <= 800:   return "gh_mid",    dist   # slow moving
#         return "gh_far",  dist                        # unaffected

#     # Highway roads — slight overflow at any distance
#     if name in HIGHWAY_ROADS:
#         return "highway", dist

#     # All other roads — distance from incident point
#     if dist <= 400:   return "adjacent_close", dist
#     if dist <= 900:   return "adjacent_mid",   dist
#     if dist <= 1800:  return "diversion",      dist
#     return "background", dist

# # Pre-compute role and distance for every segment
# seg_df["role"], seg_df["dist_m"] = zip(*seg_df.apply(classify, axis=1))

# print("\nRole distribution:")
# print(seg_df["role"].value_counts().to_string())

# # ── Speed function ────────────────────────────────────────────────
# def compute_speed(ff, phase, role):
#     n = random.randint
#     if phase == "normal":
#         return max(15, ff + n(-5, 5))

#     elif phase == "buildup":
#         if role == "incident":        return max(10, ff - n(15, 25))
#         if role == "gh_near":         return max(15, ff - n(10, 18))
#         if role == "gh_mid":          return max(20, ff - n(5, 10))
#         if role == "adjacent_close":  return max(15, ff - n(8, 15))
#         return max(15, ff + n(-5, 3))

#     elif phase == "trigger":
#         if role == "incident":        return n(4, 10)
#         if role == "gh_near":         return max(8,  ff - n(25, 35))
#         if role == "gh_mid":          return max(15, ff - n(12, 20))
#         if role == "gh_far":          return max(25, ff - n(3, 8))
#         if role == "adjacent_close":  return max(10, ff - n(18, 28))
#         if role == "adjacent_mid":    return max(20, ff - n(8, 15))
#         if role == "diversion":       return max(20, ff - n(5, 15))
#         if role == "highway":         return max(35, ff - n(3, 8))
#         return max(20, ff + n(-5, 5))

#     elif phase == "ripple":
#         if role == "incident":        return n(5, 12)
#         if role == "gh_near":         return max(8,  ff - n(22, 30))
#         if role == "gh_mid":          return max(15, ff - n(10, 18))
#         if role == "gh_far":          return max(25, ff - n(3, 8))
#         if role == "adjacent_close":  return max(10, ff - n(15, 25))
#         if role == "adjacent_mid":    return max(20, ff - n(8, 15))
#         if role == "diversion":       return max(15, ff - n(10, 20))
#         if role == "highway":         return max(30, ff - n(5, 12))
#         return max(20, ff + n(-8, 5))

#     elif phase == "recovery":
#         if role == "incident":        return max(15, ff - n(10, 20))
#         if role == "gh_near":         return max(20, ff - n(8, 15))
#         if role == "gh_mid":          return max(25, ff - n(5, 10))
#         if role == "gh_far":          return max(30, ff - n(2, 5))
#         if role == "adjacent_close":  return max(20, ff - n(8, 15))
#         if role == "adjacent_mid":    return max(25, ff - n(5, 10))
#         if role == "diversion":       return max(25, ff - n(5, 10))
#         if role == "highway":         return max(40, ff - n(3, 8))
#         return max(25, ff + n(-5, 5))

#     else:  # clear
#         return max(25, ff + n(-4, 4))

# def compute_incident_type(phase, role, speed, ff):
#     drop = 1 - (speed / ff) if ff > 0 else 0

#     if phase in ("normal", "clear"):
#         return "CLEAR", 1

#     if role == "incident":
#         if phase in ("trigger", "ripple"):  return "ACCIDENT",   3
#         if phase in ("buildup","recovery"): return "CONGESTION", 2
#         return "CLEAR", 1

#     if drop >= 0.55: return "CONGESTION", 3
#     if drop >= 0.35: return "CONGESTION", 2
#     if drop >= 0.15: return "CONGESTION", 1
#     return "CLEAR", 1

# def compute_vehicle_count(speed, ff, role, phase):
#     drop = max(0, 1 - (speed / ff)) if ff > 0 else 0
#     base = int(20 + 150 * drop)
#     if role in ("diversion", "adjacent_close") and phase in ("ripple","recovery"):
#         base = int(base * 1.3)
#     return max(5, min(base + random.randint(-10, 10), 200))

# # ── Generate rows ─────────────────────────────────────────────────
# def get_phase(ts):
#     if ts <= 19:  return "normal"
#     if ts <= 24:  return "buildup"
#     if ts == 25:  return "trigger"
#     if ts <= 45:  return "ripple"
#     if ts <= 65:  return "recovery"
#     return "clear"

# BASE_TIME  = datetime(2024, 3, 15, 8, 0, 0)
# TIMESTAMPS = 80
# rows = []

# for ts in range(TIMESTAMPS):
#     phase  = get_phase(ts)
#     ts_str = (BASE_TIME + timedelta(minutes=ts * 5)).strftime("%Y-%m-%d %H:%M:%S")

#     for _, seg in seg_df.iterrows():
#         role  = seg["role"]
#         ff    = int(seg["free_flow_speed"])
#         speed = compute_speed(ff, phase, role)
#         inc_type, severity = compute_incident_type(phase, role, speed, ff)
#         v_count = compute_vehicle_count(speed, ff, role, phase)

#         rows.append({
#             "timestamp":       ts_str,
#             "seg_id":          seg["seg_id"],
#             "street_name":     seg["street_name"],
#             "speed":           speed,
#             "free_flow_speed": ff,
#             "incident_type":   inc_type,
#             "severity":        severity,
#             "vehicle_count":   v_count,
#             "direction":       seg["direction"],
#             "seg_start_lat":   seg["seg_start_lat"],
#             "seg_start_lng":   seg["seg_start_lng"],
#             "seg_end_lat":     seg["seg_end_lat"],
#             "seg_end_lng":     seg["seg_end_lng"],
#             "lat":             seg["lat"],
#             "lng":             seg["lng"],
#         })

# feed_df = pd.DataFrame(rows)
# feed_df.to_csv("gandhinagar_traffic_feed.csv", index=False)

# print(f"\nTotal rows : {len(feed_df)}")
# print(f"Segments   : {len(seg_df)}")
# print(f"Timestamps : {TIMESTAMPS}")

# # ── Sanity check ─────────────────────────────────────────────────
# trigger_ts = (BASE_TIME + timedelta(minutes=25*5)).strftime("%Y-%m-%d %H:%M:%S")

# sample = feed_df[feed_df["timestamp"] == trigger_ts].merge(
#     seg_df[["seg_id","role","dist_m"]], on="seg_id"
# ).sort_values("dist_m").head(15)[[
#     "seg_id","street_name","role","dist_m",
#     "speed","free_flow_speed","incident_type","severity"
# ]]

# print(f"\nTrigger snapshot — 15 segments closest to incident:")
# print(sample.to_string(index=False))

import pandas as pd
import random
import math
from datetime import datetime, timedelta

random.seed(42)

seg_df = pd.read_csv("gandhinagar_segments_real.csv")

# ── Incident definitions ──────────────────────────────────────────
INCIDENTS = [
    {
        "seg_id":   "SEG_0244",
        "lat":      23.218614,
        "lng":      72.642449,
        "road":     "GH Road",
        "start_ts": 25,
        "end_ts":   65,
        "type":     "ACCIDENT",
    },
    {
        "seg_id":   None,
        "lat":      None,
        "lng":      None,
        "road":     "Road 3",
        "start_ts": 35,
        "end_ts":   60,
        "type":     "ROAD_CLOSED",
    },
    {
        "seg_id":   None,
        "lat":      None,
        "lng":      None,
        "road":     "KH Road",
        "start_ts": 50,
        "end_ts":   75,
        "type":     "ACCIDENT",
    },
]

CITY_CENTRE  = (23.215, 72.645)
HIGHWAY_ROADS = [
    "Gandhinagar Bypass Road",
    "Koba - Gandhinagar Highway",
    "Gandhinagar-Ahmedabad Highway",
]

def find_incident_seg(road_name):
    road_segs = seg_df[seg_df["street_name"] == road_name].copy()
    if road_segs.empty:
        raise ValueError(f"Road not found: {road_name}")
    road_segs["d"] = road_segs.apply(
        lambda r: math.sqrt(
            (r["lat"] - CITY_CENTRE[0])**2 +
            (r["lng"] - CITY_CENTRE[1])**2
        ), axis=1
    )
    best = road_segs.nsmallest(1, "d").iloc[0]
    return best["seg_id"], best["lat"], best["lng"]

for inc in INCIDENTS:
    if inc["seg_id"] is None:
        sid, lat, lng  = find_incident_seg(inc["road"])
        inc["seg_id"]  = sid
        inc["lat"]     = lat
        inc["lng"]     = lng

print("Incidents configured:")
for inc in INCIDENTS:
    print(f"  {inc['road']:20s}  seg={inc['seg_id']}  "
          f"T{inc['start_ts']}→T{inc['end_ts']}  {inc['type']}")

# ── Helpers ───────────────────────────────────────────────────────
def haversine_m(lat1, lng1, lat2, lng2):
    R    = 6371000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lng2 - lng1)
    a    = (math.sin(dphi/2)**2 +
            math.cos(phi1) * math.cos(phi2) * math.sin(dlam/2)**2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

def get_phase(ts):
    if ts <= 19:  return "normal"
    if ts <= 24:  return "buildup"
    if ts == 25:  return "trigger"
    if ts <= 45:  return "ripple"
    if ts <= 65:  return "recovery"
    return "clear"

def get_active_incidents(ts):
    return [i for i in INCIDENTS if i["start_ts"] <= ts <= i["end_ts"]]

ROLE_PRIORITY = {
    "incident":       10,
    "gh_near":         9,
    "adjacent_close":  8,
    "gh_mid":          7,
    "adjacent_mid":    6,
    "diversion":       5,
    "highway":         4,
    "background":      0,
}

def classify_for_ts(seg, ts):
    active = get_active_incidents(ts)
    if not active:
        return "background", 1.0

    best_role = "background"
    best_mult = 1.0
    hits      = 0

    for inc in active:
        dist = haversine_m(
            seg["lat"], seg["lng"],
            inc["lat"], inc["lng"]
        )

        if seg["seg_id"] == inc["seg_id"]:
            role = "incident"
        elif seg["street_name"] == inc["road"]:
            if dist <= 300:    role = "gh_near"
            elif dist <= 800:  role = "gh_mid"
            else:              role = "background"
        elif seg["street_name"] in HIGHWAY_ROADS:
            role = "highway"
        else:
            if dist <= 400:    role = "adjacent_close"
            elif dist <= 900:  role = "adjacent_mid"
            elif dist <= 1800: role = "diversion"
            else:              role = "background"

        if ROLE_PRIORITY.get(role, 0) > ROLE_PRIORITY.get(best_role, 0):
            best_role = role
        if role != "background":
            hits += 1

    mult = 0.85 if hits >= 2 else 1.0
    return best_role, mult

def compute_speed(ff, ts, role, mult=1.0):
    n     = random.randint
    phase = get_phase(ts)

    if phase == "normal" or role == "background":
        base = max(15, ff + n(-5, 5))

    elif role == "incident":
        if phase in ("trigger", "ripple"):  base = n(4, 10)
        elif phase == "buildup":            base = max(10, ff - n(15, 25))
        elif phase == "recovery":           base = max(15, ff - n(10, 20))
        else:                               base = max(25, ff + n(-4, 4))

    elif role == "gh_near":
        if phase == "trigger":              base = max(8,  ff - n(25, 35))
        elif phase == "ripple":             base = max(8,  ff - n(22, 30))
        elif phase == "recovery":           base = max(20, ff - n(8,  15))
        elif phase == "buildup":            base = max(15, ff - n(10, 18))
        else:                               base = max(25, ff + n(-4, 4))

    elif role == "gh_mid":
        if phase in ("trigger", "ripple"):  base = max(15, ff - n(12, 20))
        elif phase == "recovery":           base = max(25, ff - n(5,  10))
        else:                               base = max(25, ff + n(-5, 5))

    elif role == "adjacent_close":
        if phase in ("trigger", "ripple"):  base = max(10, ff - n(18, 28))
        elif phase == "recovery":           base = max(20, ff - n(8,  15))
        elif phase == "buildup":            base = max(15, ff - n(8,  15))
        else:                               base = max(25, ff + n(-4, 4))

    elif role == "adjacent_mid":
        if phase in ("trigger", "ripple"):  base = max(20, ff - n(8,  15))
        elif phase == "recovery":           base = max(25, ff - n(5,  10))
        else:                               base = max(25, ff + n(-4, 4))

    elif role == "diversion":
        if phase in ("trigger", "ripple"):  base = max(15, ff - n(10, 20))
        elif phase == "recovery":           base = max(25, ff - n(5,  12))
        else:                               base = max(25, ff + n(-4, 4))

    elif role == "highway":
        if phase in ("trigger", "ripple"):  base = max(35, ff - n(5,  12))
        elif phase == "recovery":           base = max(40, ff - n(3,   8))
        else:                               base = max(35, ff + n(-4, 4))

    else:
        base = max(15, ff + n(-5, 5))

    return max(3, int(base * mult))

def compute_incident_type(ts, role, speed, ff, seg_id):
    active = get_active_incidents(ts)
    drop   = 1 - (speed / ff) if ff > 0 else 0

    if not active or role == "background":
        return "CLEAR", 1

    if role == "incident":
        phase = get_phase(ts)
        inc_type = next(
            (i["type"] for i in active if i["seg_id"] == seg_id),
            "ACCIDENT"
        )
        if phase in ("trigger", "ripple"):  return inc_type, 3
        if phase in ("buildup","recovery"): return "CONGESTION", 2
        return "CLEAR", 1

    if drop >= 0.55: return "CONGESTION", 3
    if drop >= 0.35: return "CONGESTION", 2
    if drop >= 0.15: return "CONGESTION", 1
    return "CLEAR", 1

def compute_vehicle_count(speed, ff, role, ts):
    drop  = max(0, 1 - (speed / ff)) if ff > 0 else 0
    base  = int(20 + 150 * drop)
    phase = get_phase(ts)
    if role in ("diversion", "adjacent_close") and phase in ("ripple","recovery"):
        base = int(base * 1.3)
    return max(5, min(base + random.randint(-10, 10), 200))

# ── Generate rows ─────────────────────────────────────────────────
BASE_TIME  = datetime(2024, 3, 15, 8, 0, 0)
TIMESTAMPS = 80
rows       = []

for ts in range(TIMESTAMPS):
    ts_str = (BASE_TIME + timedelta(minutes=ts * 5)).strftime("%Y-%m-%d %H:%M:%S")

    for _, seg in seg_df.iterrows():
        role, mult = classify_for_ts(seg, ts)
        ff         = int(seg["free_flow_speed"])
        speed      = compute_speed(ff, ts, role, mult)
        inc_type, severity = compute_incident_type(
            ts, role, speed, ff, seg["seg_id"]
        )
        v_count = compute_vehicle_count(speed, ff, role, ts)

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

print(f"\nTotal rows : {len(feed_df)}")
print(f"Segments   : {len(seg_df)}")
print(f"Timestamps : {TIMESTAMPS}")

# ── Sanity check ─────────────────────────────────────────────────
for inc in INCIDENTS:
    ts_str = (BASE_TIME + timedelta(
        minutes=inc["start_ts"] * 5
    )).strftime("%Y-%m-%d %H:%M:%S")
    sample = feed_df[
        (feed_df["timestamp"] == ts_str) &
        (feed_df["seg_id"]    == inc["seg_id"])
    ][["seg_id","street_name","speed","incident_type","severity"]]
    print(f"\nIncident {inc['road']} at T{inc['start_ts']}:")
    print(sample.to_string(index=False))