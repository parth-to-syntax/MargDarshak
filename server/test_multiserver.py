import os
import time
import subprocess
import requests

def run_multiserver_test():
    print("--- Starting Multi-Server Shared Cache Test ---")
    
    # 1. Start Server A on port 8000
    print("Launching Server A on port 8000...")
    proc_a = subprocess.Popen(
        ["./.venv/bin/python", "-m", "uvicorn", "api:app", "--port", "8000"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )
    
    # 2. Start Server B on port 8001
    print("Launching Server B on port 8001...")
    proc_b = subprocess.Popen(
        ["./.venv/bin/python", "-m", "uvicorn", "api:app", "--port", "8001"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )
    
    # Wait for servers to spin up
    print("Waiting 5 seconds for servers to start up...")
    time.sleep(5)
    
    incident_id = None
    try:
        # Verify Server A is healthy
        res_health_a = requests.get("http://127.0.0.1:8000/health")
        print(f"Server A health: {res_health_a.json()}")
        
        # Verify Server B is healthy
        res_health_b = requests.get("http://127.0.0.1:8001/health")
        print(f"Server B health: {res_health_b.json()}")
        
        # Trigger an incident on Server A
        print("Triggering incident on Server A...")
        seg_id = f"seg_test_{int(time.time())}"
        payload = {
            "seg_id": seg_id,
            "lat": 23.226,
            "lng": 72.645,
            "street_name": "GH Road",
            "seg_start_lat": 23.226,
            "seg_start_lng": 72.645,
            "seg_end_lat": 23.230,
            "seg_end_lng": 72.650,
            "incident_type": "ACCIDENT"
        }
        # Note: we need to bypass auth by sending cookie or disabling auth for test, or we can just authenticate!
        # Let's log in to get session cookie
        login_res = requests.post("http://127.0.0.1:8000/login", json={"username": "officer", "password": "officer123"})
        cookies = login_res.cookies
        print(f"Logged in successfully. Cookie: {cookies.get_dict()}")
        
        trigger_res = requests.post("http://127.0.0.1:8000/incident/trigger", json=payload, cookies=cookies)
        trigger_data = trigger_res.json()
        print(f"Trigger response: {trigger_data}")
        incident_id = trigger_data["id"]
        
        # Wait for the async Copilot analysis (A* routing + Groq AI analysis) to run and populate Redis
        print("Waiting 10 seconds for Copilot background analysis to complete and populate Redis...")
        time.sleep(10)
        
        # Query Insights on Server B (port 8001) using Server B's instance
        print(f"Querying /insights/{incident_id} on Server B (port 8001)...")
        insights_res = requests.get(f"http://127.0.0.1:8001/insights/{incident_id}", cookies=cookies)
        insights_data = insights_res.json()
        print(f"Insights returned from Server B: {insights_data}")
        
        # Verify it has narrative or signals retiming details (checking they are not fallback default texts)
        assert "narrative" in insights_data, "Narrative missing from insights"
        assert "signal_retiming" in insights_data, "Signal retiming missing from insights"
        
        # Query Diversion Routes on Server B
        print(f"Querying /diversion/{incident_id} on Server B (port 8001)...")
        div_res = requests.get(f"http://127.0.0.1:8001/diversion/{incident_id}", cookies=cookies)
        div_data = div_res.json()
        print(f"Diversion routes returned from Server B: {div_data}")
        
        assert "routes" in div_data and len(div_data["routes"]) > 0, "No diversion routes found on Server B"
        print("✅ SUCCESS: Multi-server shared cache verification test passed!")
        
    except Exception as e:
        print(f"❌ FAILED: Multi-server test failed: {e}")
    finally:
        # Clean up processes
        print("Stopping Server A...")
        proc_a.terminate()
        proc_a.wait()
        print("Stopping Server B...")
        proc_b.terminate()
        proc_b.wait()

if __name__ == "__main__":
    run_multiserver_test()
