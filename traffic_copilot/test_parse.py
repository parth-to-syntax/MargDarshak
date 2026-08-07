import sys
sys.path.append('D:/Projects/Aetrix/traffic_copilot')
from pipeline.feed_simulator import FeedSimulator
fs = FeedSimulator()
inc = fs._fetch_tomtom_incidents()
print('REAL_LEN:', len(inc))
