# pipeline/event_detector.py

SPEED_DROP_THRESHOLD = 0.50   # 50 percent below free-flow
SEVERITY_TRIGGER     = 3
TRIGGER_TYPES        = {'ACCIDENT', 'ROAD_CLOSED', 'CONGESTION'}

def should_trigger(row: dict) -> bool:
    """Decides if the current traffic event warrants triggering an AI response."""
    
    # Handle missing free_flow_speed gracefully
    free_flow = row.get('free_flow_speed', 60)
    current_speed = row.get('speed_kmh', free_flow)
    
    # Calculate speed drop ratio safely
    if free_flow > 0:
        drop = 1.0 - (current_speed / free_flow)
    else:
        drop = 0.0

    return (
        str(row.get('incident_type', '')).upper() in TRIGGER_TYPES and 
        int(row.get('severity', 1)) >= SEVERITY_TRIGGER
    ) or (drop >= SPEED_DROP_THRESHOLD)
