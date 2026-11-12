#!/usr/bin/env python3
"""Create and validate complete, revision-bound local scan evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import runpy
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSET_NAME = "local-compliance-evidence.zip"
SBOMS = ("backend-runtime.cdx.json", "frontend-runtime.cdx.json",
         "keycloak-altcha-runtime.json", "keycloak-altcha-platform.json")
SCANOSS = "scanoss-code-provenance"
SCANCODE = "source-license-scan"
REQUIRED = {
    "revision.txt", "source-files.json",
    f"{SCANOSS}/results.json", f"{SCANOSS}/fingerprints.wfp",
    f"{SCANOSS}/mode.txt", f"{SCANOSS}/status.txt", f"{SCANOSS}/exit-code.txt",
    f"{SCANOSS}/tool-version.txt", f"{SCANOSS}/scanned-files.txt",
    f"{SCANOSS}/excluded-files.txt", f"{SCANOSS}/revision.txt",
    f"{SCANCODE}/source-license-scan.json", f"{SCANCODE}/exit-code.txt",
    f"{SCANCODE}/tool-version.txt", f"{SCANCODE}/revision.txt",
    "dependency-sboms/revision.txt",
    *(f"dependency-sboms/{name}" for name in SBOMS),
}
OPTIONAL = {f"{SCANOSS}/scan.log", f"{SCANCODE}/scan.log",
            "dependency-sboms/generation.log"}
MAX_ARCHIVE = 64 * 1024 * 1024
MAX_EXPANDED = 256 * 1024 * 1024


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(path.read_text())


def git(root, *args):
    return subprocess.check_output(["git", *args], cwd=root)


def source_contents(root, commit):
    require(re.fullmatch(r"[0-9a-f]{40}", commit), "Invalid source commit")
    entries = git(root, "ls-tree", "-rz", "--full-tree", commit).split(b"\0")
    objects = []
    paths = []
    for entry in filter(None, entries):
        metadata, path = entry.split(b"\t", 1)
        mode, kind, object_id = metadata.split()
        require(kind == b"blob" and mode in {b"100644", b"100755"},
                "Local evidence currently requires regular tracked files (no submodules/symlinks)")
        paths.append(path.decode())
        objects.append(object_id)
    require(objects, "No tracked files to scan")
    data = subprocess.check_output(
        ["git", "cat-file", "--batch"], cwd=root, input=b"\n".join(objects) + b"\n")
    result = {}
    offset = 0
    for path in paths:
        end = data.index(b"\n", offset)
        size = int(data[offset:end].split()[2])
        result[path] = data[end + 1:end + 1 + size]
        offset = end + 2 + size
    require(result, "No tracked files to scan")
    return result


def inventory(contents):
    return {path: {"sha256": digest(data), "md5": hashlib.md5(data).hexdigest(),
                   "size": len(data)} for path, data in sorted(contents.items())}


def fingerprint_files(directory):
    result = {}
    for line in (directory / SCANOSS / "fingerprints.wfp").read_text().splitlines():
        if line.startswith("file="):
            md5, size, path = line[5:].split(",", 2)
            require(path not in result, "Duplicate SCANOSS fingerprint path")
            result[path] = {"md5": md5, "size": int(size)}
    require(result, "SCANOSS fingerprint inventory is empty")
    return result


def validate(directory, root, commit):
    """Check scope/content against Git, as well as scanner exit codes and errors."""
    for name in REQUIRED:
        require((directory / name).is_file(), f"Missing local evidence: {name}")
    for prefix in ("", f"{SCANOSS}/", f"{SCANCODE}/", "dependency-sboms/"):
        require((directory / f"{prefix}revision.txt").read_text().strip() == commit,
                "Local evidence has a different revision")
    expected = inventory(source_contents(root, commit))
    require(read_json(directory / "source-files.json") == expected,
            "Source inventory does not match the exact Git commit")
    for scanner in (SCANOSS, SCANCODE):
        require((directory / scanner / "exit-code.txt").read_text().strip() == "0",
                f"{scanner}: unsuccessful scan")
    require((directory / SCANOSS / "mode.txt").read_text().strip() == "full" and
            (directory / SCANOSS / "status.txt").read_text().strip() ==
            "Scan completed successfully.", "SCANOSS scan is incomplete")
    fingerprints = fingerprint_files(directory)
    for path, details in fingerprints.items():
        require(path in expected and all(expected[path][key] == value
                                        for key, value in details.items()),
                f"SCANOSS fingerprint differs from source: {path}")
    listed = (directory / SCANOSS / "scanned-files.txt").read_text().splitlines()
    excluded = (directory / SCANOSS / "excluded-files.txt").read_text().splitlines()
    require(listed == sorted(fingerprints) and excluded == sorted(set(expected) - set(listed)),
            "SCANOSS scanned/excluded file inventories are incomplete")
    report = read_json(directory / SCANOSS / "results.json")
    require(set(report) == set(fingerprints), "SCANOSS responses are incomplete")
    runpy.run_path(str(ROOT / "scripts/summarize-scanoss.py"))["summarize"](report)
    scan = read_json(directory / SCANCODE / "source-license-scan.json")
    headers = scan.get("headers", [])
    require(len(headers) == 1 and headers[0].get("tool_name") == "scancode-toolkit" and
            not headers[0].get("errors"), "ScanCode scan failed or has invalid headers")
    options = headers[0].get("options", {})
    require(all(options.get(key) is True for key in
                ("--license", "--copyright", "--package", "--info")),
            "ScanCode must include license, copyright, package and file information")
    files = {}
    for entry in scan.get("files", []):
        require(not entry.get("scan_errors"), f"ScanCode error: {entry.get('path')}")
        if entry.get("type") == "file":
            path = entry["path"]
            require(path not in files, "Duplicate ScanCode file path")
            checksum = entry.get("sha256")
            # ScanCode intentionally omits hashes for empty files.
            if (checksum is None and path in expected and expected[path]["size"] == 0
                    and entry.get("size") == 0):
                checksum = digest(b"")
            files[path] = checksum
    require(files == {path: value["sha256"] for path, value in expected.items()},
            "ScanCode file coverage/content does not match the complete source commit")
    for name in SBOMS:
        bom = read_json(directory / "dependency-sboms" / name)
        require(isinstance(bom, dict) and isinstance(bom.get("components"), list)
                and bom["components"], f"Empty or invalid dependency SBOM: {name}")


def package(directory, output, root, commit):
    validate(directory, root, commit)
    names = REQUIRED | {name for name in OPTIONAL if (directory / name).is_file()}
    manifest = {
        "schema_version": 1, "source_commit": commit,
        "source_tree": git(root, "rev-parse", f"{commit}^{{tree}}").decode().strip(),
        "scope": "all-tracked-files; SCANOSS default exclusions listed explicitly",
        "files": {name: digest((directory / name).read_bytes()) for name in sorted(names)},
    }
    require(not output.exists(), "Evidence archive already exists; do not overwrite reviewed evidence")
    with zipfile.ZipFile(output, "x", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps(manifest, indent=2) + "\n")
        for name in sorted(names):
            archive.write(directory / name, name)
    require(output.stat().st_size <= MAX_ARCHIVE, "Evidence archive exceeds size limit")
    return digest(output.read_bytes())


def unpack(archive_path, destination, root, commit):
    """Read only whitelisted files, without extracting paths or executing content."""
    require(archive_path.stat().st_size <= MAX_ARCHIVE, "Evidence archive exceeds size limit")
    with zipfile.ZipFile(archive_path) as archive:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        require(len(names) == len(set(names)), "Duplicate evidence archive members")
        require(set(names) <= REQUIRED | OPTIONAL | {"manifest.json"} and
                REQUIRED | {"manifest.json"} <= set(names), "Unexpected/missing archive members")
        require(sum(entry.file_size for entry in entries) <= MAX_EXPANDED,
                "Expanded evidence exceeds size limit")
        require(all(not entry.is_dir() and (entry.external_attr >> 16) & 0o170000
                    in {0, 0o100000} for entry in entries), "Evidence must contain regular files")
        manifest = json.loads(archive.read("manifest.json"))
        require(isinstance(manifest, dict) and manifest.get("schema_version") == 1
                and manifest.get("source_commit") == commit,
                "Evidence manifest has a different revision or schema")
        require(manifest.get("source_tree") ==
                git(root, "rev-parse", f"{commit}^{{tree}}").decode().strip(),
                "Evidence source tree mismatch")
        require(isinstance(manifest.get("files"), dict) and
                manifest["files"].keys() == set(names) - {"manifest.json"},
                "Manifest does not cover every evidence file")
        destination.mkdir(parents=True, exist_ok=True)
        for name in names:
            data = archive.read(name)
            if name != "manifest.json":
                require(digest(data) == manifest["files"][name], f"Evidence checksum mismatch: {name}")
            path = destination / name
            require(not path.exists(), f"Evidence destination already exists: {name}")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
    validate(destination, root, commit)


def run_logged(command, directory, cwd):
    with (directory / "scan.log").open("w") as log:
        result = subprocess.run(command, cwd=cwd, stdout=log, stderr=subprocess.STDOUT)
    (directory / "exit-code.txt").write_text(f"{result.returncode}\n")
    result.check_returncode()


def scan(output, root):
    commit = git(root, "rev-parse", "HEAD").decode().strip()
    require(not git(root, "status", "--porcelain", "--untracked-files=no").strip(),
            "Commit tracked changes before scanning")
    output.mkdir(parents=True, exist_ok=False)
    output = output.resolve()
    contents = source_contents(root, commit)
    (output / "source-files.json").write_text(json.dumps(inventory(contents), indent=2) + "\n")
    (output / "revision.txt").write_text(commit + "\n")
    for name in (SCANOSS, SCANCODE, "dependency-sboms"):
        (output / name).mkdir()
        (output / name / "revision.txt").write_text(commit + "\n")
    oss = output / SCANOSS
    code = output / SCANCODE
    (oss / "mode.txt").write_text("full\n")
    (oss / "status.txt").write_text("Scan prepared but not completed.\n")
    for directory, command, version in (
        (oss, ["scanoss-py", "version"], "1.54.2"),
        (code, ["scancode", "--version"], "32.5.0"),
    ):
        reported = subprocess.check_output(command, text=True)
        (directory / "tool-version.txt").write_text(reported)
        require(version in reported, f"Install the pinned scanner version: {version}")
    with tempfile.TemporaryDirectory(prefix="content-pool-local-scan-") as temporary:
        source = Path(temporary) / "source"
        source.mkdir()
        for name, data in contents.items():
            path = source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        print(f"Scanning clean source commit {commit}; logs: {output}", flush=True)
        run_logged(["scanoss-py", "scan", "--skip-settings-file", "--threads", "1",
                    "--timeout", "60", "--retry", "0", "--apiurl", "https://api.osskb.org",
                    "--wfp-output", str(oss / "fingerprints.wfp"),
                    "--output", str(oss / "results.json"), str(source)], oss, source)
        fingerprints = fingerprint_files(output)
        (oss / "scanned-files.txt").write_text("".join(f"{p}\n" for p in sorted(fingerprints)))
        (oss / "excluded-files.txt").write_text("".join(
            f"{p}\n" for p in sorted(set(contents) - set(fingerprints))))
        report = read_json(oss / "results.json")
        runpy.run_path(str(ROOT / "scripts/summarize-scanoss.py"))["summarize"](report)
        require(set(report) == set(fingerprints), "SCANOSS responses are incomplete")
        (oss / "status.txt").write_text("Scan completed successfully.\n")
        run_logged([sys.executable, str(source / "scripts/scancode_all_tracked.py"),
                    "--license", "--copyright", "--package", "--info",
                    "--strip-root", "--processes", "2", "--json-pp",
                    str(code / "source-license-scan.json"), str(source)], code, source)
        sboms = output / "dependency-sboms"
        with (sboms / "generation.log").open("w") as log:
            subprocess.run(["bash", str(source / "scripts/generate-dependency-sboms.sh"),
                            str(sboms)], cwd=source, stdout=log, stderr=subprocess.STDOUT,
                           check=True)
        subprocess.run([sys.executable, str(source / "scripts/check-dependency-licenses.py"),
                        "--policy", str(source / "compliance/dependency-license-policy.json"),
                        *(str(sboms / name) for name in SBOMS[:3])], check=True)
    checksum = package(output, output / ASSET_NAME, root, commit)
    print(f"Complete local evidence: {output / ASSET_NAME}\nSHA256: {checksum}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    command = commands.add_parser("scan")
    command.add_argument("--output-dir", type=Path, required=True)
    command = commands.add_parser("package")
    command.add_argument("--evidence-dir", type=Path, required=True)
    command.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == "scan":
            scan(args.output_dir, ROOT)
        else:
            commit = git(ROOT, "rev-parse", "HEAD").decode().strip()
            print(package(args.evidence_dir, args.output, ROOT, commit))
    except (ValueError, KeyError, TypeError, OSError, zipfile.BadZipFile,
            subprocess.CalledProcessError) as error:
        print(f"Local compliance evidence incomplete: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
