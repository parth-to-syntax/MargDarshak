import pandas as pd
import folium

seg_df = pd.read_csv("gandhinagar_segments_real.csv")

COLOR_MAP = {
    "trunk":          "#E74C3C",
    "trunk_link":     "#E74C3C",
    "primary":        "#E67E22",
    "primary_link":   "#E67E22",
    "secondary":      "#F1C40F",
    "secondary_link": "#F1C40F",
    "tertiary":       "#3498DB",
    "tertiary_link":  "#3498DB",
    "residential":    "#95A5A6",
    "unclassified":   "#BDC3C7",
}

# Incident classification colors
INCIDENT_ROAD   = "GH Road"
ADJACENT_ROADS  = ["CH Road", "Road 3"]
DIVERSION_ROADS = ["G Road", "KH Road", "Road 2", "Ka Road"]
HIGHWAY_ROADS   = [
    "Gandhinagar Bypass Road",
    "Koba - Gandhinagar Highway",
    "Gandhinagar-Ahmedabad Highway",
]

def role_color(street):
    if street == INCIDENT_ROAD:      return "#E74C3C", 6   # red, thick
    if street in ADJACENT_ROADS:     return "#E67E22", 5   # orange
    if street in DIVERSION_ROADS:    return "#2ECC71", 5   # green
    if street in HIGHWAY_ROADS:      return "#9B59B6", 5   # purple
    return None, 3                                          # default by highway type

m = folium.Map(
    location=[seg_df["lat"].mean(), seg_df["lng"].mean()],
    zoom_start=13,
    tiles="CartoDB positron"
)

for _, seg in seg_df.iterrows():
    override_color, weight = role_color(seg["street_name"])
    color = override_color if override_color else COLOR_MAP.get(seg["highway_type"], "#BDC3C7")

    folium.PolyLine(
        locations=[
            (seg["seg_start_lat"], seg["seg_start_lng"]),
            (seg["seg_end_lat"],   seg["seg_end_lng"]),
        ],
        color=color,
        weight=weight,
        opacity=0.85,
        tooltip=(
            f"{seg['street_name']} | "
            f"{seg['highway_type']} | "
            f"FF: {seg['free_flow_speed']} km/h | "
            f"{seg['direction']} | "
            f"{seg['seg_id']}"
        ),
    ).add_to(m)

legend_html = """
<div style="position:fixed;bottom:30px;left:30px;z-index:1000;
            background:white;padding:14px 18px;border-radius:8px;
            border:1px solid #ccc;font-size:13px;line-height:2">
  <b>Simulation roles</b><br>
  <span style="color:#E74C3C">&#9644;&#9644;</span> Incident road (GH Road)<br>
  <span style="color:#E67E22">&#9644;&#9644;</span> Adjacent / spillback<br>
  <span style="color:#2ECC71">&#9644;&#9644;</span> Diversion roads<br>
  <span style="color:#9B59B6">&#9644;&#9644;</span> Highway overflow<br>
  <span style="color:#3498DB">&#9644;</span> Tertiary (background)<br>
  <span style="color:#95A5A6">&#9644;</span> Residential (background)<br>
  <br><i>Hover any segment for details</i>
</div>
"""
m.get_root().html.add_child(folium.Element(legend_html))

m.save("verify_segments_step3.html")
print(f"Saved → verify_segments_step3.html")
print(f"Total segments plotted: {len(seg_df)}")