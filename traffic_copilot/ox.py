import osmnx as ox
import pandas as pd

# Bounding box around the sectors visible in your screenshot
# North, South, East, West
BBOX = (23.235, 23.195, 72.665, 72.620)

G = ox.graph_from_bbox(
    bbox=(BBOX[3], BBOX[1], BBOX[2], BBOX[0]), # (west, south, east, north)
    network_type="drive"
)

# Convert edges to dataframe
edges = ox.graph_to_gdfs(G, nodes=False)

# Print every named road segment
named = edges[edges['name'].notna()][
    ['name', 'highway', 'length', 'maxspeed']
].copy()

print(named['name'].unique())