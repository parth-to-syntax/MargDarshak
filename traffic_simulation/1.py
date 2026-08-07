import osmnx as ox
import networkx as nx
import pandas as pd

G = ox.graph_from_place("Gandhinagar, Gujarat, India", network_type="drive")
largest = max(nx.connected_components(G.to_undirected()), key=len)
G_main  = G.subgraph(largest).copy()

segments = []
for u, v, k, data in G_main.edges(keys=True, data=True):
    name = data.get("name", None)
    if isinstance(name, list): name = name[0]
    hw = data.get("highway", "unclassified")
    if isinstance(hw, list): hw = hw[0]
    segments.append({"street_name": name, "highway_type": hw})

df = pd.DataFrame(segments)

print(f"Total segments  : {len(df)}")
print(f"Named segments  : {df['street_name'].notna().sum()}")
print(f"Unnamed segments: {df['street_name'].isna().sum()}")
print(f"Unique road names: {df['street_name'].nunique()}")
print(f"\nNamed roads only:")
print(df[df['street_name'].notna()]['street_name'].value_counts().head(30).to_string())
print(f"\nHighway type breakdown:")
print(df['highway_type'].value_counts().to_string())