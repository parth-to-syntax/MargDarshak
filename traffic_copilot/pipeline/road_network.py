import osmnx as ox
import networkx as nx
from pathlib import Path

# Fix warning in osmnx related to pandas
import pandas as pd
pd.options.mode.chained_assignment = None

GRAPHML = Path('data/ahmedabad.graphml')
CITY = 'Ahmedabad, Gujarat, India'

def load_graph() -> nx.MultiDiGraph:
    """Loads the road network graph for Ahmedabad, generating and caching it if missed."""
    if GRAPHML.exists():
        return ox.load_graphml(GRAPHML)
    
    # Generate graph from OSMnx
    G = ox.graph_from_place(CITY, network_type='drive')
    
    # Save graph mapping to disk for cache
    GRAPHML.parent.mkdir(parents=True, exist_ok=True)
    ox.save_graphml(G, GRAPHML)
    return G

def get_route(G, o_lat, o_lng, d_lat, d_lng) -> list[str]:
    """Return ordered street names for diversion route between coords."""
    orig = ox.nearest_nodes(G, o_lng, o_lat)
    dest = ox.nearest_nodes(G, d_lng, d_lat)
    
    try:
        path = nx.astar_path(G, orig, dest, weight='length')
    except nx.NetworkXNoPath:
        return ["Route unavailable"]

    names = []
    for u, v in zip(path[:-1], path[1:]):
        edge_data = G[u][v][0]
        name = edge_data.get('name', 'Unnamed road')
        if isinstance(name, list): 
            name = name[0]
        if not names or names[-1] != name:
            names.append(name)
            
    return names if names else ["Unnamed road"]
