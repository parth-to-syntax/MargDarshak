import os
import tweepy
from dotenv import load_dotenv

load_dotenv()

def test_twitter():
    api_key = os.getenv("TWITTER_API_KEY")
    api_secret = os.getenv("TWITTER_API_SECRET")
    access_token = os.getenv("TWITTER_ACCESS_TOKEN")
    access_token_secret = os.getenv("TWITTER_ACCESS_SECRET")
    bearer_token = os.getenv("TWITTER_BEARER_TOKEN")
    
    print("--- Twitter API Verification ---")
    print(f"API Key: {api_key[:5]}...")
    print(f"Access Token: {access_token[:5]}...")

    try:
        client = tweepy.Client(
            consumer_key=api_key,
            consumer_secret=api_secret,
            access_token=access_token,
            access_token_secret=access_token_secret
        )
        # Test Tweet
        print("Posting test tweet...")
        response = client.create_tweet(text="Aetrix Alert System: Twitter Integration Active. #GandhinagarTraffic #Test")
        print(f"✅ SUCCESS! Tweet ID: {response.data['id']}")
        return True
    except Exception as e:
        print(f"❌ FAILED: {e}")
        return False

if __name__ == "__main__":
    test_twitter()
