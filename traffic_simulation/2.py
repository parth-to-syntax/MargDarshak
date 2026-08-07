import osmnx as ox
import networkx as nx
import pandas as pd

def _ff(hw):
    if isinstance(hw, list): hw = hw[0]
    return {
        "trunk":          80,
        "trunk_link":     65,
        "primary":        65,
        "primary_link":   55,
        "secondary":      55,
        "secondary_link": 45,
        "tertiary":       45,
        "tertiary_link":  35,
        "residential":    30,
        "unclassified":   30,
    }.get(hw, 30)

def _direction(slat, slng, elat, elng):
    if abs(elat - slat) > abs(elng - slng):
        return "NORTHBOUND" if elat > slat else "SOUTHBOUND"
    return "EASTBOUND" if elng > slng else "WESTBOUND"

G = ox.graph_from_place("Gandhinagar, Gujarat, India", network_type="drive")
largest = max(nx.connected_components(G.to_undirected()), key=len)
G_main  = G.subgraph(largest).copy()

segments = []
seg_id   = 1

for u, v, k, data in G_main.edges(keys=True, data=True):
    name = data.get("name", None)
    if isinstance(name, list): name = name[0]
    if not name:
        continue

    u_data = G_main.nodes[u]
    v_data = G_main.nodes[v]
    slat, slng = u_data['y'], u_data['x']
    elat, elng = v_data['y'], v_data['x']

    hw = data.get("highway", "residential")
    if isinstance(hw, list): hw = hw[0]

    segments.append({
        "seg_id":          f"SEG_{seg_id:04d}",
        "street_name":     name,
        "lat":             round((slat + elat) / 2, 6),
        "lng":             round((slng + elng) / 2, 6),
        "seg_start_lat":   round(slat, 6),
        "seg_start_lng":   round(slng, 6),
        "seg_end_lat":     round(elat, 6),
        "seg_end_lng":     round(elng, 6),
        "direction":       _direction(slat, slng, elat, elng),
        "length_m":        round(data.get("length", 0), 1),
        "highway_type":    hw,
        "free_flow_speed": _ff(hw),
        "osm_u":           u,
        "osm_v":           v,
    })
    seg_id += 1

seg_df = pd.DataFrame(segments)
seg_df.to_csv("gandhinagar_segments_real.csv", index=False)

print(f"Total named segments : {len(seg_df)}")
print(f"Unique road names    : {seg_df['street_name'].nunique()}")
print(f"\nSegments per road:")
print(seg_df['street_name'].value_counts().to_string())