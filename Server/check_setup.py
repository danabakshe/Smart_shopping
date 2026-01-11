#!/usr/bin/env python3
"""Quick check to verify google-genai is available and API key is set."""
import os
import sys
from pathlib import Path

# Load .env from project root
ROOT_DIR = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT_DIR / ".env"
if ENV_PATH.exists():
    try:
        from dotenv import load_dotenv
        load_dotenv(ENV_PATH)
    except PermissionError:
        print(f"   ⚠ Could not read .env file (permission denied): {ENV_PATH}")
        print("   → Environment variables may be set another way")

print("=" * 60)
print("Setup Check for Smart Shopping Server")
print("=" * 60)

# Check 1: google-genai package
print("\n1. Checking google-genai package...")
try:
    from google import genai
    print("   ✓ google-genai is installed")
except ImportError as e:
    print(f"   ✗ google-genai is NOT installed: {e}")
    print("   → Install with: pip install google-genai")
    sys.exit(1)

# Check 2: API key
print("\n2. Checking GEMINI_API_KEY...")
api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
if api_key and api_key.strip():
    print(f"   ✓ API key is set (length: {len(api_key)} chars)")
    print(f"   → Key starts with: {api_key[:10]}...")
else:
    print("   ✗ API key is NOT set or is empty")
    print("   → Add GEMINI_API_KEY=your_key_here to .env file")
    print(f"   → .env location: {ENV_PATH}")

# Check 3: Model
print("\n3. Checking GEMINI_MODEL...")
model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
print(f"   ✓ Model: {model}")

# Check 4: Test import from price_service
print("\n4. Testing price_service import...")
genai_available = False
try:
    from server.services.price_service import _GENAI_AVAILABLE, _get_client
    genai_available = _GENAI_AVAILABLE
    if _GENAI_AVAILABLE:
        print("   ✓ _GENAI_AVAILABLE is True")
        if api_key and api_key.strip():
            try:
                client = _get_client()
                print("   ✓ Client creation successful")
            except Exception as e:
                print(f"   ✗ Client creation failed: {e}")
        else:
            print("   ⚠ Cannot test client (no API key)")
    else:
        print("   ✗ _GENAI_AVAILABLE is False")
except Exception as e:
    print(f"   ✗ Import failed: {e}")

print("\n" + "=" * 60)
if api_key and api_key.strip() and genai_available:
    print("✓ Setup looks good! Restart your Flask server if it's running.")
else:
    print("⚠ Please fix the issues above before running the server.")
print("=" * 60)

