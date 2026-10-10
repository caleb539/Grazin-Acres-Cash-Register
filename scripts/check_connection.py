"""Check that the Farmmatch agent can reach the register database.

Usage:
    set SUPABASE_SECRET_KEY=<key from Grazin Acres Register > Project Settings > API Keys>
    python scripts/check_connection.py

Prints exactly what is wrong if the key or headers are not right. Never prints the key.
"""
import base64
import json
import os
import sys
import urllib.error
import urllib.request

PROJECT_REF = "fkjeeeicnxsnmaovsjtk"
URL = f"https://{PROJECT_REF}.supabase.co"


def fail(msg: str) -> None:
    print(f"FAIL: {msg}")
    sys.exit(1)


def jwt_payload(token: str) -> dict | None:
    parts = token.split(".")
    if len(parts) != 3:
        return None
    try:
        pad = "=" * (-len(parts[1]) % 4)
        return json.loads(base64.urlsafe_b64decode(parts[1] + pad))
    except Exception:
        return None


def main() -> None:
    raw = os.environ.get("SUPABASE_SECRET_KEY")
    if raw is None:
        fail("SUPABASE_SECRET_KEY is not set.")
    key = raw.strip()
    if key != raw:
        print("WARN: key had leading/trailing whitespace or a newline. Strip it in the agent too.")

    if key.startswith("sb_publishable_"):
        fail("This is the PUBLISHABLE key. The agent needs the SECRET key (sb_secret_...) or the legacy service_role key.")
    elif key.startswith("sb_secret_"):
        print("OK: key format is a new-style secret key (sb_secret_...).")
    else:
        payload = jwt_payload(key)
        if payload is None:
            fail("Key is neither sb_secret_... nor a JWT. It was probably copied incompletely.")
        if payload.get("ref") != PROJECT_REF:
            fail(f"This key belongs to project '{payload.get('ref')}', not Grazin Acres Register ({PROJECT_REF}). "
                 "Copy the key from the Grazin Acres Register project.")
        if payload.get("role") != "service_role":
            fail(f"This is the '{payload.get('role')}' key. The agent needs the service_role key.")
        print("OK: legacy service_role key for the right project.")

    # Both headers, same key. This is what supabase-js does.
    req = urllib.request.Request(
        f"{URL}/rest/v1/agent_sales_to_post?select=sale_id&limit=1",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            rows = json.loads(resp.read())
            print(f"OK: connected. agent_sales_to_post returned {len(rows)} row(s).")
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:300]
        fail(f"HTTP {e.code}: {body}")
    except urllib.error.URLError as e:
        fail(f"Network error (no internet, firewall, or proxy?): {e.reason}")


if __name__ == "__main__":
    main()
