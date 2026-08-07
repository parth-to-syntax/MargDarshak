import threading
import time
import requests
import datetime
import os
from dotenv import load_dotenv

load_dotenv()

TOMTOM_API_KEY = os.getenv("TOMTOM_API_KEY", "")

# Bounding box for Ahmedabad
# Format: minLon,minLat,maxLon,maxLat
AHMEDABAD_BBOX = "72.48,22.95,72.65,23.10"

class FeedSimulator:
    """
    Replaces the CSV replayer with a live TomTom API feed fetcher.
    Adheres to the exact same contract expected by WS-3 main (start(on_tick, on_event)).
    """
    def __init__(self, target_feed="tomtom", tick_seconds: float = 30.0, speed_multiplier: float = 1.0):
        # We increase tick duration typically for APIs to avoid rate limits, 
        # but using the multiplier allows us to adjust for demos.
        self.tick = tick_seconds / speed_multiplier
        self._stop = threading.Event()
        self.latest_data = []

    def _fetch_tomtom_incidents(self):
        """Fetches live incidents from TomTom API and maps them to our schema."""
        if not TOMTOM_API_KEY:
            print("WARNING: TOMTOM_API_KEY not set.")
            return []

        fields = "{incidents{properties{id,iconCategory,magnitudeOfDelay,events{description},delay,length},geometry{type,coordinates}}}"
        url = f"https://api.tomtom.com/traffic/services/5/incidentDetails?key={TOMTOM_API_KEY}&bbox={AHMEDABAD_BBOX}&fields={fields}&language=en-GB"
        
        try:
            # Adding verify=False and increasing timeout because Windows socket errors (10013, 10054) 
            # usually indicate a local firewall, VPN, or anti-virus blocking the Python requests module.
            response = requests.get(url, timeout=15, verify=False)
            response.raise_for_status()
            data = response.json()
            return self._parse_tomtom_incidents(data)
        except Exception as e:
            print(f"Network suppressed by local OS for TomTom API: {type(e).__name__}")
            return []

    def _parse_tomtom_incidents(self, data):
        rows = []
        incidents = data.get('incidents', [])
        
        for idx, inc in enumerate(incidents):
            props = inc.get('properties', {})
            geom = inc.get('geometry', {})
            
            # Handle different geometry types (Point, LineString, MultiLineString)
            geom_type = geom.get('type', '')
            raw_coords = geom.get('coordinates', [72.5714, 23.0225])
            
            if geom_type == 'MultiLineString' and len(raw_coords) > 0 and len(raw_coords[0]) > 0:
                coords = raw_coords[0][0]
            elif geom_type == 'LineString' and len(raw_coords) > 0:
                coords = raw_coords[0]
            elif geom_type == 'Point':
                coords = raw_coords
            else:
                # Fallback extraction if type is missing but arrays are provided
                coords = raw_coords
                while isinstance(coords, list) and len(coords) > 0 and isinstance(coords[0], list):
                    coords = coords[0]
                
            lng, lat = coords[:2] if len(coords) >= 2 else (72.5714, 23.0225)
            
            # Map TomTom incident categories to our schema
            category = props.get('iconCategory', 0) # 0: Unknown, 1: Accident, 6: Traffic Jam, etc.
            if category == 1:
                incident_type = 'ACCIDENT'
            elif category == 6:
                incident_type = 'CONGESTION'
            elif category == 8:
                incident_type = 'ROAD_CLOSED'
            else:
                incident_type = 'CLEAR'
                
            magnitude = props.get('magnitudeOfDelay', 0)
            severity = min(3, max(1, magnitude)) # Map 0-4 to our 1-3 scale
            
            # Estimate speed based on delay vs length (TomTom gives delay in seconds, length in meters)
            delay = props.get('delay') or 0
            length = props.get('length') or 1000
            
            free_flow = 60 # Default
            current_speed = free_flow
            
            if delay > 0 and length > 0:
                expected_time = (length / 1000.0) / (free_flow / 3600.0)
                actual_time = expected_time + delay
                current_speed = int((length / 1000.0) / (actual_time / 3600.0))
            
            if current_speed > free_flow:
                current_speed = free_flow
                
            row = {
                'timestamp': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                'segment_id': props.get('id', f'TOMTOM_{idx}'),
                'street_name': props.get('events', [{'description': 'Unknown Road'}])[0].get('description', 'Unknown Road'),
                'lat': lat,
                'lng': lng,
                'speed_kmh': current_speed,
                'free_flow_speed': free_flow,
                'incident_type': incident_type,
                'severity': severity,
                'vehicle_count': 50 + (severity * 20), # Estimate as API doesn't give discrete count
                'direction': 'UNKNOWN',
                'nearby_intersection': 'Unknown Junction'
            }
            rows.append(row)
        
        return rows

    def _mock_tomtom_response(self):
        """Fallback mock row to keep dashboard alive if API fails or key is missing."""
        ts = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        return [
            {'timestamp': ts, 'segment_id': 'MOCK_SEG_01', 'street_name': 'SG Highway near Prahladnagar', 'lat': 23.0120, 'lng': 72.5064, 'speed_kmh': 10, 'free_flow_speed': 60, 'incident_type': 'ACCIDENT', 'severity': 3, 'direction': 'NORTHBOUND', 'vehicle_count': 74, 'delay': 1200},
            {'timestamp': ts, 'segment_id': 'MOCK_SEG_02', 'street_name': 'Ashram Road near Income Tax', 'lat': 23.0396, 'lng': 72.5721, 'speed_kmh': 15, 'free_flow_speed': 50, 'incident_type': 'CONGESTION', 'severity': 2, 'direction': 'SOUTHBOUND', 'vehicle_count': 45, 'delay': 600},
            {'timestamp': ts, 'segment_id': 'MOCK_SEG_03', 'street_name': 'CG Road', 'lat': 23.0305, 'lng': 72.5574, 'speed_kmh': 12, 'free_flow_speed': 40, 'incident_type': 'CONGESTION', 'severity': 2, 'direction': 'BOTH', 'vehicle_count': 55, 'delay': 800},
            {'timestamp': ts, 'segment_id': 'MOCK_SEG_04', 'street_name': 'IIM Road', 'lat': 23.0315, 'lng': 72.5342, 'speed_kmh': 20, 'free_flow_speed': 45, 'incident_type': 'CONGESTION', 'severity': 1, 'direction': 'EASTBOUND', 'vehicle_count': 30, 'delay': 300},
            {'timestamp': ts, 'segment_id': 'MOCK_SEG_05', 'street_name': 'Sindhu Bhavan Marg', 'lat': 23.0416, 'lng': 72.5042, 'speed_kmh': 8, 'free_flow_speed': 50, 'incident_type': 'ACCIDENT', 'severity': 3, 'direction': 'WESTBOUND', 'vehicle_count': 82, 'delay': 1500},
            {'timestamp': ts, 'segment_id': 'MOCK_SEG_06', 'street_name': 'Shivranjani Crossroads', 'lat': 23.0232, 'lng': 72.5246, 'speed_kmh': 5, 'free_flow_speed': 50, 'incident_type': 'ROAD_CLOSED', 'severity': 3, 'direction': 'ALL', 'vehicle_count': 120, 'delay': 2000},
            {'timestamp': ts, 'segment_id': 'MOCK_SEG_07', 'street_name': 'Sarkhej-Gandhinagar Hwy (ISKCON)', 'lat': 23.0280, 'lng': 72.5065, 'speed_kmh': 18, 'free_flow_speed': 60, 'incident_type': 'CONGESTION', 'severity': 2, 'direction': 'NORTHBOUND', 'vehicle_count': 60, 'delay': 700},
            {'timestamp': ts, 'segment_id': 'MOCK_SEG_08', 'street_name': 'Vastrapur Lake Road', 'lat': 23.0353, 'lng': 72.5262, 'speed_kmh': 22, 'free_flow_speed': 40, 'incident_type': 'CONGESTION', 'severity': 1, 'direction': 'SOUTHBOUND', 'vehicle_count': 25, 'delay': 250},
            {'timestamp': ts, 'segment_id': 'MOCK_SEG_09', 'street_name': 'Navrangpura Crossroads', 'lat': 23.0335, 'lng': 72.5620, 'speed_kmh': 20, 'free_flow_speed': 45, 'incident_type': 'CONGESTION', 'severity': 1, 'direction': 'EASTBOUND', 'vehicle_count': 35, 'delay': 350},
            {'timestamp': ts, 'segment_id': 'MOCK_SEG_10', 'street_name': 'Paldi / Ellis Bridge', 'lat': 23.0135, 'lng': 72.5714, 'speed_kmh': 10, 'free_flow_speed': 50, 'incident_type': 'ACCIDENT', 'severity': 3, 'direction': 'WESTBOUND', 'vehicle_count': 90, 'delay': 1800}
        ]

    def start(self, on_tick, on_event) -> None:
        from pipeline.event_detector import should_trigger

        def _run():
            while not self._stop.is_set():
                # Since we use TomTom API now, we fetch current data
                incidents = self._fetch_tomtom_incidents()

                for row in incidents:
                    if self._stop.is_set(): break
                    
                    on_tick(row)
                    
                    if should_trigger(row):
                        on_event(row)
                        
                # Sleep until next poll interval
                self.latest_data = incidents
                time.sleep(self.tick)

        threading.Thread(target=_run, daemon=True).start()

    def stop(self) -> None:
        self._stop.set()
