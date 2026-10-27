#!/usr/bin/env python3
"""Verify the repository's Apache-2.0 license declarations."""

from __future__ import annotations

import hashlib
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXPECTED_LICENSE_SHA256 = (
    "c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4"
)
SPDX_ID = "Apache-2.0"


def fail(message: str) -> None:
    print(f"License metadata check failed: {message}", file=sys.stderr)
    raise SystemExit(1)


license_digest = hashlib.sha256((ROOT / "LICENSE").read_bytes()).hexdigest()
if license_digest != EXPECTED_LICENSE_SHA256:
    fail("LICENSE is not the canonical Apache License 2.0 text")

for project in ("backend", "frontend"):
    if (ROOT / project / "LICENSE").read_bytes() != (ROOT / "LICENSE").read_bytes():
        fail(f"{project}/LICENSE differs from the canonical project license")
    package = json.loads((ROOT / project / "package.json").read_text())
    package_lock = json.loads((ROOT / project / "package-lock.json").read_text())
    if package.get("license") != SPDX_ID:
        fail(f"{project}/package.json does not declare {SPDX_ID}")
    if package_lock.get("packages", {}).get("", {}).get("license") != SPDX_ID:
        fail(f"{project}/package-lock.json does not declare {SPDX_ID}")

pom = ET.parse(ROOT / "keycloak/extensions/altcha/pom.xml")
namespace = {"m": "http://maven.apache.org/POM/4.0.0"}
license_node = pom.find("m:licenses/m:license", namespace)
if license_node is None:
    fail("Keycloak extension pom.xml has no license declaration")
name = license_node.findtext("m:name", namespaces=namespace)
url = license_node.findtext("m:url", namespaces=namespace)
if name != "Apache License, Version 2.0":
    fail("Keycloak extension pom.xml has the wrong license name")
if url != "https://www.apache.org/licenses/LICENSE-2.0.txt":
    fail("Keycloak extension pom.xml has the wrong license URL")

notices = ROOT / "keycloak/extensions/altcha/licenses"
manifest = json.loads((notices / "manifest.json").read_text())
for component in manifest["components"]:
    version = pom.findtext(
        f"m:properties/m:{component['version_property']}", namespaces=namespace
    )
    if version != component["version"]:
        fail(f"bundled notice for {component['artifact']} needs a version review")
    digest = hashlib.sha256((notices / component["file"]).read_bytes()).hexdigest()
    if digest != component["sha256"]:
        fail(f"bundled notice for {component['artifact']} has changed")

print("Apache-2.0 metadata and version-specific bundled notices are consistent")
