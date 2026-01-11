# Smart Shopping – Server

Flask-based backend service for price comparison across countries and sites.

## Run locally

```bash
cd Server
python3 -m venv .venv
source .venv/bin/activate
pip install -r server/requirements.txt

# Run the backend (recommended - ensures imports like `from server.routes ...` work)
python -m server.app
```
