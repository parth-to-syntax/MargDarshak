import math
from itertools import islice
import osmnx as ox
import networkx as nx
import pandas as pd
from pathlib import Path

GRAPHML_PATH = Path("ahmedabad.graphml")
CITY_QUERY   = "Gandhinagar, Gujarat, India"

CAPACITY_MAP = {
    "trunk":          3500,
    "trunk_link":     2500,
    "primary":        2000,
    "primary_link":   1500,
    "secondary":      1400,
    "secondary_link": 1000,
    "tertiary":       900,
    "tertiary_link":  600,
    "residential":    400,
    "unclassified":   500,
}

FF_SPEED_MAP = {
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
}

# Cache per-segment nearest edge lookups to keep per-tick updates fast.
SEG_EDGE_CACHE: dict = {}

# Per-edge live data updated in place instead of deep-copying the graph.
# Format: {(u, v, k): {"live_weight": float, "volume": float}}
_LIVE_EDGE_DATA: dict = {}


def load_graph() -> nx.MultiDiGraph:
    if GRAPHML_PATH.exists():
        return ox.load_graphml(GRAPHML_PATH)
    G = ox.graph_from_place(CITY_QUERY, network_type="drive")
    ox.save_graphml(G, GRAPHML_PATH)
    return G


def bpr_travel_time(length_m: float, free_flow_kmh: float,
                    volume: float, capacity: float) -> float:
    if free_flow_kmh <= 0 or capacity <= 0:
        return length_m / 5
    free_flow_s = (length_m / 1000) / free_flow_kmh * 3600
    vc          = volume / capacity
    return free_flow_s * (1 + 0.15 * (vc ** 4))


def build_live_graph(G_base: nx.MultiDiGraph,
                     frame_df: pd.DataFrame,
                     active_incidents: list[dict] | None = None) -> nx.MultiDiGraph:
    """
    Overlay live CSV frame data onto the OSMnx graph via an in-place
    edge-weight dict (_LIVE_EDGE_DATA) instead of deep-copying the graph.
    Returns the same G_base object with a custom edge attribute accessor
    pattern used by find_diversion_routes via get_live_weight().

    For routing we build a lightweight DiGraph view with updated weights.
    We also block all road segments not present in our traffic database.
    """
    _LIVE_EDGE_DATA.clear()

    # 1. Batch compute nearest edges for any un-cached segments first
    uncached = []
    mid_lngs = []
    mid_lats = []
    for _, row in frame_df.iterrows():
        seg_id = str(row.get("seg_id", ""))
        if seg_id not in SEG_EDGE_CACHE:
            mid_lat = (float(row.get("seg_start_lat", 0)) + float(row.get("seg_end_lat", 0))) / 2.0
            mid_lng = (float(row.get("seg_start_lng", 0)) + float(row.get("seg_end_lng", 0))) / 2.0
            uncached.append(seg_id)
            mid_lngs.append(mid_lng)
            mid_lats.append(mid_lat)

    # Ensure manual incidents are also vectorized and cached
    if active_incidents:
        for incident in active_incidents:
            if incident and incident.get("seg_id"):
                inc_seg_id = str(incident["seg_id"])
                if inc_seg_id not in SEG_EDGE_CACHE:
                    mid_lat = (float(incident.get("seg_start_lat", 0)) + float(incident.get("seg_end_lat", 0))) / 2.0
                    mid_lng = (float(incident.get("seg_start_lng", 0)) + float(incident.get("seg_end_lng", 0))) / 2.0
                    uncached.append(inc_seg_id)
                    mid_lngs.append(mid_lng)
                    mid_lats.append(mid_lat)

    if uncached:
        print(f"[DEBUG] Vectorizing spatial lookup for {len(uncached)} segments...")
        try:
            edges = ox.nearest_edges(G_base, X=mid_lngs, Y=mid_lats)
            for i, seg_id in enumerate(uncached):
                SEG_EDGE_CACHE[seg_id] = edges[i]
        except Exception as e:
            print(f"[router] Vectorized nearest_edges failed: {e}")
            for seg_id in uncached:
                SEG_EDGE_CACHE[seg_id] = None

    # Get set of all active/valid database edges
    valid_edges = set()
    for _, row in frame_df.iterrows():
        seg_id = str(row.get("seg_id", ""))
        edge = SEG_EDGE_CACHE.get(seg_id)
        if edge:
            valid_edges.add(edge)

    if active_incidents:
        for incident in active_incidents:
            if incident and incident.get("seg_id"):
                inc_seg_id = str(incident["seg_id"])
                edge = SEG_EDGE_CACHE.get(inc_seg_id)
                if edge:
                    valid_edges.add(edge)

    # 2. Seed all edges in the base graph.
    # Block any edge not in our valid database segment list to prevent phantom routing.
    for u, v, k, data in G_base.edges(keys=True, data=True):
        if (u, v, k) not in valid_edges:
            length   = data.get("length", 100)
            _LIVE_EDGE_DATA[(u, v, k)] = {"live_weight": length * 4.0, "volume": 0}
        else:
            length   = data.get("length", 100)
            hw       = data.get("highway", "residential")
            if isinstance(hw, list):
                hw = hw[0]
            capacity = CAPACITY_MAP.get(hw, 500)
            ff_spd   = FF_SPEED_MAP.get(hw, 35)
            weight   = bpr_travel_time(length, ff_spd, capacity * 0.3, capacity)
            _LIVE_EDGE_DATA[(u, v, k)] = {"live_weight": weight, "volume": capacity * 0.3}

    # 3. Apply live CSV per-segment overrides using the fast cache
    for _, row in frame_df.iterrows():
        seg_id = str(row.get("seg_id", ""))
        edge   = SEG_EDGE_CACHE.get(seg_id)

        if edge is None:
            continue

        u, v, k = edge
        if not G_base.has_edge(u, v, key=k):
            continue

        data     = G_base[u][v][k]
        length   = data.get("length", 100)
        hw       = data.get("highway", "residential")
        if isinstance(hw, list):
            hw = hw[0]
        capacity = CAPACITY_MAP.get(hw, 500)

        inc    = row.get("incident_type", "CLEAR")
        volume = float(row.get("vehicle_count", 0) or 0)
        ff     = float(row.get("free_flow_speed", 0) or 0)

        weight = (
            100000
            if inc in ("ACCIDENT", "ROAD_CLOSED")
            else bpr_travel_time(length, ff, volume, capacity)
        )

        _LIVE_EDGE_DATA[(u, v, k)] = {"live_weight": weight, "volume": volume}

    # Forcibly block all active incident segments
    if active_incidents:
        for incident in active_incidents:
            if incident and incident.get("seg_id"):
                inc_seg_id = str(incident["seg_id"])
                inc_edge = SEG_EDGE_CACHE.get(inc_seg_id)
                if inc_edge:
                    u, v, k = inc_edge
                    if G_base.has_edge(u, v, key=k):
                        vol = _LIVE_EDGE_DATA.get((u, v, k), {}).get("volume", 0)
                        _LIVE_EDGE_DATA[(u, v, k)] = {"live_weight": 100000, "volume": vol}

    return G_base


def _get_live_weight(G_base, u, v, k):
    """Return live_weight for edge (u,v,k), fallback to length/5."""
    ed = _LIVE_EDGE_DATA.get((u, v, k))
    if ed:
        return ed["live_weight"]
    return G_base[u][v][k].get("length", 100) / 5


def find_diversion_routes(G_base: nx.MultiDiGraph,
                           inc_lat: float, inc_lng: float,
                           dest_lat: float, dest_lng: float,
                           incident: dict | None = None,
                           k: int = 3) -> tuple[list[dict], list[str]]:
    """
    Returns (routes, debug_log).
    routes  — up to k load-aware diversion routes ranked by BPR travel time.
    debug_log — list of human-readable strings tracing every decision made.
    Each route dict: road_names, travel_time_s, length_km, max_vc_ratio, coords.
    """
    debug: list[str] = []

    # ── Origin / Destination ──────────────────────────────────────────
    if incident and incident.get("seg_start_lat") is not None:
        origin = ox.nearest_nodes(
            G_base,
            float(incident["seg_start_lng"]),
            float(incident["seg_start_lat"]),
        )
        debug.append(f"[ORIGIN] Using incident segment start-point node {origin} "
                     f"({incident['seg_start_lat']:.4f}, {incident['seg_start_lng']:.4f})")
    else:
        origin = ox.nearest_nodes(G_base, inc_lng, inc_lat)
        debug.append(f"[ORIGIN] Nearest node to incident lat/lng: {origin} ({inc_lat:.4f}, {inc_lng:.4f})")

    dest = ox.nearest_nodes(G_base, dest_lng, dest_lat)
    debug.append(f"[DEST]   Destination node {dest} ({dest_lat:.4f}, {dest_lng:.4f})")

    # ── Build weighted DiGraph view (no deep copy) ────────────────────
    debug.append("[GRAPH]  Building DiGraph view with live BPR weights...")

    def weight_fn(u, v, data):
        # For DiGraph edges, find best matching MultiDiGraph key
        best = float("inf")
        if G_base.has_edge(u, v):
            for kk in G_base[u][v]:
                w = _LIVE_EDGE_DATA.get((u, v, kk), {}).get("live_weight",
                      G_base[u][v][kk].get("length", 100) / 5)
                if w < best:
                    best = w
        return best

    # Convert to DiGraph for shortest_simple_paths (doesn't support MultiDiGraph)
    G_di = nx.DiGraph()
    blocked_count = 0
    for u, v, key_, data in G_base.edges(keys=True, data=True):
        w = _LIVE_EDGE_DATA.get((u, v, key_), {}).get(
            "live_weight", data.get("length", 100) / 5
        )
        if w >= 100000:
            blocked_count += 1
        # Keep minimum weight edge between (u,v) if multiple parallel edges
        if G_di.has_edge(u, v):
            if G_di[u][v]["live_weight"] > w:
                G_di[u][v]["live_weight"] = w
                G_di[u][v]["length"]      = data.get("length", 100)
                G_di[u][v]["name"]        = data.get("name", "Unnamed")
                G_di[u][v]["highway"]     = data.get("highway", "residential")
                G_di[u][v]["volume"]      = _LIVE_EDGE_DATA.get((u, v, key_), {}).get("volume", 0)
        else:
            G_di.add_edge(u, v,
                live_weight=w,
                length=data.get("length", 100),
                name=data.get("name", "Unnamed"),
                highway=data.get("highway", "residential"),
                volume=_LIVE_EDGE_DATA.get((u, v, key_), {}).get("volume", 0),
            )

    debug.append(f"[GRAPH]  DiGraph: {G_di.number_of_nodes()} nodes, "
                 f"{G_di.number_of_edges()} edges, {blocked_count} blocked edges (weight=100000)")

    # Check if origin is trapped (all outgoing edges from origin in G_di are blocked)
    trapped = True
    if G_di.has_node(origin):
        neighbors = list(G_di.neighbors(origin))
        if not neighbors:
            trapped = True
        else:
            for v in neighbors:
                if G_di[origin][v].get("live_weight", 0) < 100000:
                    trapped = False
                    break
    else:
        trapped = False

    if trapped:
        debug.append(f"[ROUTE]  Origin node {origin} is trapped (all outgoing edges blocked). Shifting origin to predecessors...")
        predecessors = list(G_di.predecessors(origin))
        if predecessors:
            origin = predecessors[0]
            debug.append(f"[ROUTE]  New origin node set to predecessor: {origin}")

    # ── Path enumeration ──────────────────────────────────────────────
    routes         = []
    seen_sigs      = set()
    candidates_seen = 0
    skip_blocked   = 0
    skip_dup       = 0

    try:
        # Explicit backend routing log details
        print(f"=== ROUTER RUN FOR INCIDENT: {incident.get('id') if incident else 'N/A'} ===")
        print(f"Blocked Segment ID: {incident.get('seg_id') if incident else 'N/A'}")
        print(f"Graph Base Node Count: {G_base.number_of_nodes()} | Edge Count: {G_base.number_of_edges()}")
        print(f"Graph DiGraph Node Count: {G_di.number_of_nodes()} | Edge Count: {G_di.number_of_edges()}")

        debug.append(f"[ROUTE]  Running Yen's k-shortest-simple-paths (k={k*3} oversample)...")
        print("Running Yen's k-shortest-simple-paths algorithm...")
        paths_iter = nx.shortest_simple_paths(G_di, origin, dest, weight="live_weight")

        for path in islice(paths_iter, k * 3):
            candidates_seen += 1
            print(f"Yen's algorithm found candidate path: {path}")
            total_time   = 0
            total_length = 0
            road_names   = []
            max_vc       = 0
            blocked      = False

            for u, v in zip(path[:-1], path[1:]):
                if not G_di.has_edge(u, v):
                    blocked = True
                    break
                edge_data = G_di[u][v]
                # Removed hard w >= 999999 blocked check to allow soft-block fallback routing
                pass

                total_time   += w
                total_length += edge_data.get("length", 0)

                name = edge_data.get("name", "Unnamed")
                if isinstance(name, list):
                    name = name[0]
                if not road_names or road_names[-1] != name:
                    road_names.append(name)

                hw = edge_data.get("highway", "residential")
                if isinstance(hw, list):
                    hw = hw[0]
                cap  = CAPACITY_MAP.get(hw, 500)
                vol  = edge_data.get("volume", 0)
                vc   = vol / cap if cap > 0 else 0
                max_vc = max(max_vc, vc)

            if blocked:
                skip_blocked += 1
                continue
            if not road_names:
                continue

            sig = tuple(road_names)
            if sig in seen_sigs:
                skip_dup += 1
                continue
            seen_sigs.add(sig)

            mins = total_time // 60
            secs = round(total_time % 60)
            load = round(max_vc * 100)
            route_str = " → ".join(road_names)
            debug.append(f"[ROUTE]  ✅ Candidate #{len(routes)+1}: {route_str} | "
                         f"{mins}m {secs}s | {total_length/1000:.2f} km | max load {load}%")

            coords = []
            for u, v in zip(path[:-1], path[1:]):
                edge_dict = G_base.get_edge_data(u, v)
                if not edge_dict:
                    coords.append((G_base.nodes[u]["y"], G_base.nodes[u]["x"]))
                    continue
                # Default to first parallel edge key
                data = edge_dict[list(edge_dict.keys())[0]]
                if "geometry" in data:
                    for x, y in data["geometry"].coords:
                        # Shapely stores (lng, lat) but Leaflet needs (lat, lng)
                        coords.append((y, x))
                else:
                    coords.append((G_base.nodes[u]["y"], G_base.nodes[u]["x"]))
            if path:
                end_n = path[-1]
                coords.append((G_base.nodes[end_n]["y"], G_base.nodes[end_n]["x"]))

            routes.append({
                "path":          path,
                "road_names":    road_names,
                "coords":        coords,
                "travel_time_s": round(total_time),
                "length_km":     round(total_length / 1000, 2),
                "max_vc_ratio":  round(max_vc, 2),
            })

            if len(routes) == k:
                break

    except (nx.NetworkXNoPath, nx.NodeNotFound) as e:
        debug.append(f"[ROUTE]  ❌ No path found: {e}")
        print(f"Routing failed: nx.NetworkXNoPath or nx.NodeNotFound: {e}")

    debug.append(f"[ROUTE]  Explored {candidates_seen} candidates | "
                 f"skipped {skip_blocked} blocked, {skip_dup} duplicates | "
                 f"kept {len(routes)} routes")

    routes.sort(key=lambda r: r["travel_time_s"])

    if routes:
        print(f"Routing successful. Best route: {' -> '.join(routes[0]['road_names'])}")
        print(f"Alternate Route coordinates count: {len(routes[0]['coords'])}")
        print(f"Alternate Route coordinates: {routes[0]['coords']}")
        debug.append(f"[RESULT] Best route: {' → '.join(routes[0]['road_names'])} | "
                     f"{routes[0]['travel_time_s']//60}m {routes[0]['travel_time_s']%60}s | "
                     f"max load {round(routes[0]['max_vc_ratio']*100)}%")
    else:
        print("Routing result: No viable detour routes found.")
        debug.append("[RESULT] ⚠️  No viable diversion routes found.")

    print(f"==================================================")
    return routes, debug