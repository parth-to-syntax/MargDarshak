import osmnx as ox
import pandas as pd

def _free_flow_from_highway(hw_type):
    if isinstance(hw_type, list):
        hw_type = hw_type[0]
    speeds = {
        "trunk":          80,
        "primary":        60,
        "secondary":      50,
        "tertiary":       40,
        "tertiary_link":  35,
        "residential":    30,
        "unclassified":   35,
    }
    return speeds.get(hw_type, 35)

# Manual override — OSMnx sometimes misclassifies Gandhinagar sector roads
SPEED_OVERRIDE = {
    "GH Road":                    50,
    "CH Road":                    40,
    "CHH Road":                   40,
    "G Road":                     40,
    "KH Road":                    50,
    "Road 2":                     40,
    "Road 3":                     40,
    "Road 4":                     40,
    "Road 5":                     40,
    "Gandhinagar-Sarkhej Highway": 70,
}

# Exact OSM names from your Step 1 output — all 10 confirmed present
TARGET_ROADS = [
    "GH Road",
    "CH Road",
    "CHH Road",
    "G Road",
    "KH Road",
    "Road 2",
    "Road 3",
    "Road 4",
    "Road 5",
    "Gandhinagar-Sarkhej Highway",
]

G = ox.graph_from_bbox(
    bbox=(72.620, 23.195, 72.665, 23.235),
    network_type="drive"
)

segments = []
seg_id = 1

for u, v, k, data in G.edges(keys=True, data=True):
    name = data.get("name", "")
    if isinstance(name, list):
        name = name[0]

    matched = None
    for target in TARGET_ROADS:
        if target.lower() == str(name).lower():  # exact match now, not contains
            matched = target
            break

    if not matched:
        continue

    u_data = G.nodes[u]
    v_data = G.nodes[v]

    start_lat = u_data['y']
    start_lng = u_data['x']
    end_lat   = v_data['y']
    end_lng   = v_data['x']
    mid_lat   = (start_lat + end_lat) / 2
    mid_lng   = (start_lng + end_lng) / 2

    dlat = end_lat - start_lat
    dlng = end_lng - start_lng
    if abs(dlat) > abs(dlng):
        direction = "NORTHBOUND" if dlat > 0 else "SOUTHBOUND"
    else:
        direction = "EASTBOUND"  if dlng > 0 else "WESTBOUND"

    hw_type   = data.get("highway", "unclassified")
    ff_speed  = SPEED_OVERRIDE.get(
        matched,
        _free_flow_from_highway(hw_type)
    )

    segments.append({
        "seg_id":          f"SEG_{seg_id:03d}",
        "street_name":     matched,
        "lat":             round(mid_lat, 6),
        "lng":             round(mid_lng, 6),
        "seg_start_lat":   round(start_lat, 6),
        "seg_start_lng":   round(start_lng, 6),
        "seg_end_lat":     round(end_lat, 6),
        "seg_end_lng":     round(end_lng, 6),
        "direction":       direction,
        "length_m":        round(data.get("length", 100), 1),
        "highway_type":    hw_type if isinstance(hw_type, str) else hw_type[0],
        "free_flow_speed": ff_speed,
    })
    seg_id += 1

seg_df = pd.DataFrame(segments)
seg_df = seg_df.drop_duplicates(subset="street_name", keep="first")

# Should now be exactly 10
print(f"Segments found: {len(seg_df)}")
print(seg_df[["seg_id", "street_name", "lat", "lng", "direction", "free_flow_speed"]])

seg_df.to_csv("gandhinagar_segments_real.csv", index=False)
