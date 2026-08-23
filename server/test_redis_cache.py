import os
import json
import time
import redis
from copilot import IncidentCoPilot, redis_client
from auth import init_db, save_incident, load_incidents

# Configure environment defaults for tests
os.environ["REDIS_URL"] = "redis://localhost:6379/0"
os.environ["REDIS_AI_TTL"] = "5"
os.environ["REDIS_ROUTE_TTL"] = "5"

def test_basic_redis_operations():
    print("--- Test A: Basic Redis Operations ---")
    
    # 1. Initialize co-pilot
    copilot = IncidentCoPilot(None)
    
    # Sample incident data
    incident_id = "TEST_INC_001"
    sample_ai = {"signal_retiming": "test", "diversion_route": "test", "public_alert": "test", "narrative": "test"}
    sample_routes = [{"road_names": ["Road A", "Road B"], "coords": [[1, 2], [3, 4]]}]
    
    # Set values
    copilot._redis_set(f"margdarshak:ai:{incident_id}", json.dumps(sample_ai), 10)
    copilot._redis_set(f"margdarshak:routes:{incident_id}", json.dumps(sample_routes), 10)
    
    # Get values
    ai_res = copilot._redis_get(f"margdarshak:ai:{incident_id}")
    routes_res = copilot._redis_get(f"margdarshak:routes:{incident_id}")
    
    assert ai_res is not None, "Failed to read AI key"
    assert routes_res is not None, "Failed to read routes key"
    
    parsed_ai = json.loads(ai_res)
    parsed_routes = json.loads(routes_res)
    
    assert parsed_ai["signal_retiming"] == "test", "AI content mismatch"
    assert parsed_routes[0]["road_names"] == ["Road A", "Road B"], "Routes content mismatch"
    
    print("✅ Basic Redis operations test passed.")

def test_ttl_verification():
    print("--- Test B: TTL Verification ---")
    copilot = IncidentCoPilot(None)
    incident_id = "TEST_INC_002"
    sample_ai = {"narrative": "TTL test"}
    
    # Set key with short TTL (2 seconds)
    copilot._redis_set(f"margdarshak:ai:{incident_id}", json.dumps(sample_ai), 2)
    
    # Check TTL value
    r = redis.Redis.from_url(os.getenv("REDIS_URL"))
    ttl = r.ttl(f"margdarshak:ai:{incident_id}")
    assert 0 < ttl <= 2, f"Unexpected TTL: {ttl}"
    
    # Wait for expiry
    print("Waiting 2.5 seconds for TTL expiry...")
    time.sleep(2.5)
    
    assert r.get(f"margdarshak:ai:{incident_id}") is None, "Key did not expire"
    print("✅ TTL verification test passed.")

def test_resolution_cleanup():
    print("--- Test C: Resolution Cleanup ---")
    copilot = IncidentCoPilot(None)
    incident_id = "TEST_INC_003"
    
    sample_ai = {"narrative": "cleanup test"}
    sample_routes = [{"road_names": ["Road X"], "coords": [[1, 1]]}]
    
    # Simulate analysis results write
    copilot._redis_set(f"margdarshak:ai:{incident_id}", json.dumps(sample_ai), 10)
    copilot._redis_set(f"margdarshak:routes:{incident_id}", json.dumps(sample_routes), 10)
    
    # Populate fallbacks
    copilot._ai_fallback[incident_id] = sample_ai
    copilot._routes_fallback[incident_id] = sample_routes
    
    # Resolve
    copilot.resolve_incident(incident_id, "seg_123")
    
    # Verify both keys and fallbacks are cleared
    r = redis.Redis.from_url(os.getenv("REDIS_URL"))
    assert r.get(f"margdarshak:ai:{incident_id}") is None, "AI key not deleted on resolution"
    assert r.get(f"margdarshak:routes:{incident_id}") is None, "Routes key not deleted on resolution"
    assert incident_id not in copilot._ai_fallback, "AI fallback not deleted on resolution"
    assert incident_id not in copilot._routes_fallback, "Routes fallback not deleted on resolution"
    
    print("✅ Resolution cleanup test passed.")

def test_redis_failure_handling():
    print("--- Test D: Redis Failure Handling ---")
    # Temporarily force connection failure by using a wrong port connection
    try:
        bad_pool = redis.ConnectionPool(host="localhost", port=9999, socket_connect_timeout=0.5)
        bad_client = redis.Redis(connection_pool=bad_pool)
        
        # Test auth db initialization (must not depend on Redis)
        init_db()
        sample_db_inc = {"id": "TEST_SQLITE_001", "seg_id": "seg_1", "location": "Sector 1", "type": "ACCIDENT", "severity": 3, "status": "ACTIVE"}
        save_incident(sample_db_inc)
        loaded = load_incidents()
        assert any(i["id"] == "TEST_SQLITE_001" for i in loaded), "SQLite persistence failed"
        print("✅ SQLite persists and loads incidents independently of Redis.")
        
        # Instantiate co-pilot and mock redis client failure
        import copilot as copilot_module
        original_client = copilot_module.redis_client
        copilot_module.redis_client = bad_client
        
        copilot = IncidentCoPilot(None)
        
        # Writes must not crash the app, but fallback to RAM
        sample_ai = {"narrative": "failed redis test"}
        success = copilot._redis_set("margdarshak:ai:FAIL_INC", json.dumps(sample_ai), 10)
        assert not success, "Write should have failed due to invalid Redis server"
        
        # Update fallbacks directly as if fallback block executed
        copilot._ai_fallback["FAIL_INC"] = sample_ai
        
        # Reads must fallback to RAM
        val = copilot.get_last_ai("FAIL_INC")
        assert val == sample_ai, "Fallback read failed"
        
        # Cleanup / Restore original client
        copilot_module.redis_client = original_client
        print("✅ Redis failure and local fallback tests passed.")
    except Exception as e:
        print(f"❌ Redis failure handling test failed: {e}")
        raise

if __name__ == "__main__":
    init_db()
    test_basic_redis_operations()
    test_ttl_verification()
    test_resolution_cleanup()
    test_redis_failure_handling()
    print("\n🎉 ALL TESTS PASSED SUCCESSFULLY! 🎉")
