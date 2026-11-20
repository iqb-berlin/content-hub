#!/usr/bin/env python3
"""Rename the existing OIDC client in place, preserving UUID, roles and URLs."""

import argparse
import json
import os
import re
import tempfile
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request


def read_env(path: Path) -> dict[str, str]:
    values = {}
    for line in path.read_text().splitlines():
        if "=" not in line or line.lstrip().startswith("#"):
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("\"'")
    return values


def migrate(args: argparse.Namespace) -> None:
    env_path = Path(args.env_file)
    values = read_env(env_path)
    root = args.url.rstrip("/")
    parsed = urllib.parse.urlsplit(root)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("Keycloak URL must use HTTP or HTTPS")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("Use a base URL without embedded credentials, query or fragment")
    if parsed.scheme == "http" and parsed.hostname not in {"localhost", "127.0.0.1", "::1", "keycloak"}:
        raise ValueError("Remote Keycloak administration requires HTTPS; use a local tunnel for HTTP")
    user = os.environ.get("KEYCLOAK_ADMIN_USER", values.get("KEYCLOAK_ADMIN_USER"))
    password = os.environ.get("KEYCLOAK_ADMIN_PASSWORD", values.get("KEYCLOAK_ADMIN_PASSWORD"))
    if not user or not password or password.startswith("change-me"):
        raise ValueError("Configured Keycloak administrator credentials are required")
    token_body = urllib.parse.urlencode({
        "grant_type": "password", "client_id": "admin-cli",
        "username": user, "password": password,
    }).encode()
    request = urllib.request.Request(
        f"{root}/realms/master/protocol/openid-connect/token", data=token_body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        token = json.load(response)["access_token"]
    base = f"{root}/admin/realms/{urllib.parse.quote(args.realm, safe='')}/clients"

    def api(url: str, body: dict | None = None):
        request = urllib.request.Request(
            url, method="GET" if body is None else "PUT",
            data=None if body is None else json.dumps(body).encode(),
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            data = response.read()
            return json.loads(data) if data else None

    old = api(base + "?" + urllib.parse.urlencode({"clientId": args.from_client}))
    new = api(base + "?" + urllib.parse.urlencode({"clientId": args.to_client}))
    if len(old) > 1 or len(new) > 1 or (old and new):
        raise ValueError("Ambiguous client mapping; refusing to replace an existing client")
    if not old and not new:
        raise ValueError("Neither source nor target client exists")
    configured = values.get("OIDC_CLIENT_ID")
    if configured not in {args.from_client, args.to_client}:
        raise ValueError("OIDC_CLIENT_ID differs from both selected client IDs")
    client = api(base + "/" + urllib.parse.quote((old or new)[0]["id"], safe=""))
    if not args.apply:
        print(f"Would rename client {args.from_client} to {args.to_client}; UUID and URLs stay unchanged.")
        return
    backup = Path(args.backup_dir)
    backup.mkdir(mode=0o700, parents=True, exist_ok=False)
    backup.chmod(0o700)
    for name, content in [("client.json", json.dumps(client, indent=2)), ("deployment.env", env_path.read_text())]:
        with open(backup / name, "x", opener=lambda path, flags: os.open(path, flags, 0o600)) as file:
            file.write(content)
    if old:
        client["clientId"] = args.to_client
        api(base + "/" + urllib.parse.quote(client["id"], safe=""), client)
    # Preserve every unrelated configuration entry, including the public domain.
    text = env_path.read_text()
    lines = [f"OIDC_CLIENT_ID={args.to_client}" if re.match(r"^\s*OIDC_CLIENT_ID\s*=", line) else line for line in text.splitlines()]
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=env_path.parent,
            prefix=env_path.name + ".content-hub.", suffix=".tmp", delete=False,
        ) as file:
            tmp = Path(file.name)
            file.write("\n".join(lines) + "\n")
        tmp.replace(env_path)
    finally:
        if tmp is not None:
            tmp.unlink(missing_ok=True)
    print(f"Client renamed in place and OIDC_CLIENT_ID updated. Backup: {backup}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://localhost:8080")
    parser.add_argument("--realm", default="iqb")
    parser.add_argument("--env-file", default=".env")
    parser.add_argument("--from-client", default="contentpool")
    parser.add_argument("--to-client", default="contenthub")
    parser.add_argument("--backup-dir", required=True)
    parser.add_argument("--apply", action="store_true", help="Apply the previewed change during maintenance")
    args = parser.parse_args()
    if args.from_client == args.to_client:
        parser.error("Source and target client IDs must differ")
    try:
        migrate(args)
    except (OSError, ValueError, KeyError, urllib.error.URLError) as error:
        parser.exit(1, f"Client migration failed: {error}\n")


if __name__ == "__main__":
    main()
