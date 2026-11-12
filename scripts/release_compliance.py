#!/usr/bin/env python3
"""Collect revision-bound scan evidence and validate a human release review."""

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
from typing import Any

import local_compliance as local


ROOT = Path(__file__).resolve().parents[1]
MARKER = "<!-- content-pool-license-review -->"
CHECKS = ("contributor_rights", "assets", "distribution_notices", "software_scope")
RESOLUTIONS = {"standard-pattern", "licensed-reuse", "independent-origin", "removed"}


class ComplianceError(ValueError):
    pass


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise ComplianceError(f"{path}: expected a JSON object")
    return value


def require(condition: Any, message: str) -> None:
    if not condition:
        raise ComplianceError(message)


def finding_id(kind: str, value: dict[str, Any]) -> str:
    encoded = json.dumps(value, sort_keys=True, ensure_ascii=True).encode()
    return f"{kind}:{hashlib.sha256(encoded).hexdigest()[:24]}"


def source_path(raw: str) -> str:
    for prefix in ("scanoss-source/", "content-pool-source/"):
        if prefix in raw:
            return raw.split(prefix, 1)[1]
    return raw.removeprefix("./")


def findings(scanoss: dict[str, Any], scancode: dict[str, Any]) -> dict[str, Any]:
    # Reuse the same report-shape validation as the PR workflow.
    runpy.run_path(str(ROOT / "scripts/summarize-scanoss.py"))["summarize"](scanoss)
    result: dict[str, Any] = {}
    for raw_path, matches in scanoss.items():
        for match in matches:
            if match["id"] == "none":
                continue
            details = {key: match.get(key) for key in (
                "id", "url", "file", "version", "lines", "oss_lines", "licenses"
            )}
            details["path"] = source_path(raw_path)
            result[finding_id("scanoss", details)] = details

    headers = scancode.get("headers")
    files = scancode.get("files")
    require(isinstance(headers, list) and headers, "ScanCode header is missing")
    require(isinstance(files, list) and files, "ScanCode file inventory is missing")
    for header in headers:
        require(not header.get("errors"), "ScanCode reported scan errors")
        require(header.get("tool_name") == "scancode-toolkit", "Unexpected ScanCode tool")
    for entry in files:
        require(not entry.get("scan_errors"), f"ScanCode error: {entry.get('path')}")
        expression = entry.get("detected_license_expression_spdx")
        if entry.get("type") == "file" and expression:
            details = {"path": source_path(entry["path"]), "licenses": expression}
            result[finding_id("scancode", details)] = details

    # Historical unresolved sources must not disappear merely because a later
    # database stops returning a match. All 57 technical assessments need human
    # confirmation, including the seven unavailable sources.
    baseline = read_json(ROOT / "docs/scanoss-review-2026-09-10.json")
    for entry in baseline["findings"]:
        result[f"baseline:{entry['id']}"] = {
            "path": entry["path"], "source": entry["source_url"],
            "technical_assessment": entry["assessment"],
            "historical_status": entry["status"],
        }
    return result


def validate_review(
    issue: dict[str, Any], repository: str, issue_url: str, commit: str,
    required_findings: dict[str, Any], scanoss_run: int | None = None,
    compliance_run: int | None = None, local_evidence: dict[str, Any] | None = None,
) -> dict[str, Any]:
    require(re.fullmatch(r"[0-9a-f]{40}", commit), "Invalid source commit")
    prefix = f"https://github.com/{repository}/issues/"
    require(issue_url.startswith(prefix) and re.fullmatch(
        r"[1-9][0-9]*", issue_url.removeprefix(prefix)
    ), "Review must be an issue in the release repository")
    require(issue.get("html_url") == issue_url, "Review issue identity mismatch")
    require(issue.get("state") == "closed" and issue.get("state_reason") == "completed",
            "Human license review must be closed as completed")
    require(isinstance(issue.get("closed_at"), str) and
            isinstance(issue.get("updated_at"), str) and
            issue["updated_at"] <= issue["closed_at"],
            "Review changed after completion; reopen and have the reviewer complete it again")
    require(issue.get("author_association") in {"OWNER", "MEMBER", "COLLABORATOR"},
            "Review issue must be owned by a repository maintainer")
    closer = issue.get("closed_by") or {}
    require(closer.get("type") == "User", "A human maintainer must close the review")
    body = issue.get("body") or ""
    require(MARKER in body, "Not a ContentPool license review")
    records = re.findall(r"```json\s*\n(.*?)\n```", body, re.DOTALL)
    require(len(records) == 1, "Review must contain exactly one JSON record")
    record = json.loads(records[0])
    require(isinstance(record, dict), "Review record must be an object")
    require(record.get("source_commit") == commit, "Review is for a different commit")
    require(record.get("reviewer") == closer.get("login"),
            "Named reviewer must be the human who completed the issue")
    if local_evidence is not None:
        require(record.get("local_evidence") == local_evidence and
                "scanoss_run_id" not in record and "compliance_run_id" not in record,
                "Review is for different local evidence or mixes evidence modes")
    else:
        require(type(scanoss_run) is int and scanoss_run > 0 and
                type(compliance_run) is int and compliance_run > 0 and
                "local_evidence" not in record and
                record.get("scanoss_run_id") == scanoss_run and
                record.get("compliance_run_id") == compliance_run,
                "Review is for different scan runs")
    checks = record.get("checks", {})
    require(isinstance(checks, dict) and all(checks.get(key) is True for key in CHECKS),
            "Rights, assets, distribution notices and scope checks must be complete")
    decisions = record.get("decisions")
    require(isinstance(decisions, dict), "Per-finding review decisions are missing")
    for key, details in required_findings.items():
        decision = decisions.get(key)
        require(isinstance(decision, dict), f"Missing review decision: {key}")
        require(decision.get("resolution") in RESOLUTIONS, f"Unresolved finding: {key}")
        for field in ("reason", "evidence"):
            require(isinstance(decision.get(field), str) and
                    len(decision[field].strip()) >= 10, f"{key}: meaningful {field} required")
        if decision["resolution"] == "licensed-reuse":
            require(isinstance(decision.get("license"), str) and
                    decision["license"].strip(), f"{key}: applicable license is missing")
        if decision["resolution"] == "removed":
            require(not (ROOT / details["path"]).exists(),
                    f"{key}: file still exists; document the replacement's origin instead")
    return record


def validate_run(run: dict[str, Any], workflow: str, commit: str) -> None:
    require(run.get("head_sha") == commit, "Scan run has a different source commit")
    require(run.get("path") == f".github/workflows/{workflow}", "Unexpected scan workflow")
    require(run.get("event") in {"schedule", "workflow_dispatch"},
            "Release requires full scans; pull-request delta scans are insufficient")
    require(run.get("status") == "completed" and run.get("conclusion") == "success",
            "Full scan workflow has not completed successfully")


def gh_json(*args: str) -> dict[str, Any]:
    return json.loads(subprocess.check_output(["gh", "api", *args], text=True))


def download_local(record: dict[str, Any], repository: str, commit: str,
                   destination: Path) -> dict[str, Any]:
    reference = record.get("local_evidence")
    require(isinstance(reference, dict) and
            reference.get("release_tag") == f"compliance-{commit}" and
            reference.get("asset_name") == local.ASSET_NAME and
            isinstance(reference.get("sha256"), str) and
            re.fullmatch(r"[0-9a-f]{64}", reference["sha256"]),
            "Invalid local evidence reference")
    require("scanoss_run_id" not in record and "compliance_run_id" not in record,
            "Choose local evidence or workflow runs, not both")
    # Download only a fixed-name asset from this repository, never an arbitrary
    # URL from an issue. The completed human record binds its immutable checksum.
    release = gh_json(f"repos/{repository}/releases/tags/{reference['release_tag']}")
    require(release.get("tag_name") == reference["release_tag"] and
            release.get("prerelease") is True and not release.get("draft"),
            "Local evidence must be published as an evidence prerelease")
    assets = [asset for asset in release.get("assets", [])
              if asset.get("name") == local.ASSET_NAME]
    require(len(assets) == 1 and 0 < assets[0].get("size", 0) <= local.MAX_ARCHIVE,
            "Local evidence asset missing or too large")
    archive = destination / local.ASSET_NAME
    subprocess.run(["gh", "release", "download", reference["release_tag"],
                    "--repo", repository, "--pattern", local.ASSET_NAME,
                    "--dir", str(destination)], check=True)
    require(archive.stat().st_size <= local.MAX_ARCHIVE and
            local.digest(archive.read_bytes()) == reference["sha256"],
            "Local evidence archive differs from the human-reviewed checksum")
    local.unpack(archive, destination, ROOT, commit)
    (destination / "evidence-release.json").write_text(json.dumps(release, indent=2) + "\n")
    return reference


def collect(args: argparse.Namespace) -> None:
    require(re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", args.repository),
            "Invalid repository")
    prefix = f"https://github.com/{args.repository}/issues/"
    require(args.review_issue.startswith(prefix), "Review issue is in a different repository")
    number = args.review_issue.removeprefix(prefix)
    require(re.fullmatch(r"[1-9][0-9]*", number), "Invalid review issue URL")
    actual_commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    require(actual_commit == args.commit, "Checkout does not match the reviewed source commit")
    require(not subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"],
                                        cwd=ROOT, text=True).strip(),
            "Release evidence must be collected from an unchanged checkout")
    issue = gh_json(f"repos/{args.repository}/issues/{number}")
    records = re.findall(r"```json\s*\n(.*?)\n```", issue.get("body") or "", re.DOTALL)
    require(len(records) == 1, "Review must contain one JSON record")
    record = json.loads(records[0])
    destination = args.output_dir
    destination.mkdir(parents=True, exist_ok=False)
    local_reference = None
    if "local_evidence" in record:
        local_reference = download_local(record, args.repository, args.commit, destination)
    else:
        collect_runs(record, args.repository, args.commit, destination)
    scanoss_dir = destination / "scanoss-code-provenance"
    require((scanoss_dir / "mode.txt").read_text().strip() == "full",
            "SCANOSS evidence is not a full scan")
    require((scanoss_dir / "status.txt").read_text().strip() == "Scan completed successfully.",
            "SCANOSS scan is incomplete")
    required_findings = findings(read_json(scanoss_dir / "results.json"), read_json(
        destination / "source-license-scan/source-license-scan.json"))
    reviewed = validate_review(issue, args.repository, args.review_issue, args.commit,
                              required_findings, record.get("scanoss_run_id"),
                              record.get("compliance_run_id"), local_reference)
    sboms = destination / "dependency-sboms"
    subprocess.run([sys.executable, str(ROOT / "scripts/check-dependency-licenses.py"),
                    "--policy", str(ROOT / "compliance/dependency-license-policy.json"),
                    *(str(sboms / name) for name in local.SBOMS[:3])], check=True)
    for name, value in (("review-issue.json", issue), ("review-record.json", reviewed),
                        ("findings.json", required_findings)):
        (destination / name).write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")
    (destination / "revision.txt").write_text(args.commit + "\n")
    (destination / "LICENSE").write_bytes((ROOT / "LICENSE").read_bytes())
    print(f"Human review and full scan evidence verified for {args.commit}")


def collect_runs(record: dict[str, Any], repository: str, commit: str, destination: Path) -> None:
    for field, workflow, artifacts in (
        ("scanoss_run_id", "scanoss.yml", ("scanoss-code-provenance",)),
        ("compliance_run_id", "compliance.yml", ("source-license-scan", "dependency-sboms")),
    ):
        run_id = record.get(field)
        require(type(run_id) is int and run_id > 0, f"Invalid {field}")
        run = gh_json(f"repos/{repository}/actions/runs/{run_id}")
        validate_run(run, workflow, commit)
        (destination / f"{field}.json").write_text(json.dumps(run, indent=2) + "\n")
        for artifact in artifacts:
            target = destination / artifact
            subprocess.run(["gh", "run", "download", str(run_id), "--repo", repository,
                            "--name", artifact, "--dir", str(target)], check=True)
            require((target / "revision.txt").read_text().strip() == commit,
                    f"{artifact}: evidence revision mismatch")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    collect_parser = commands.add_parser("collect")
    collect_parser.add_argument("--repository", required=True)
    collect_parser.add_argument("--commit", required=True)
    collect_parser.add_argument("--review-issue", required=True)
    collect_parser.add_argument("--output-dir", type=Path, required=True)
    draft = commands.add_parser("draft-review")
    draft.add_argument("--commit", required=True)
    draft.add_argument("--local-evidence", type=Path)
    draft.add_argument("--scanoss", type=Path)
    draft.add_argument("--scancode", type=Path)
    draft.add_argument("--scanoss-run-id", type=int)
    draft.add_argument("--compliance-run-id", type=int)
    draft.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == "collect":
            collect(args)
        else:
            require(re.fullmatch(r"[0-9a-f]{40}", args.commit), "Invalid source commit")
            workflow_args = (args.scanoss, args.scancode, args.scanoss_run_id, args.compliance_run_id)
            if args.local_evidence:
                require(not any(value is not None for value in workflow_args),
                        "Choose local evidence or workflow reports, not both")
                with tempfile.TemporaryDirectory() as temporary:
                    directory = Path(temporary)
                    local.unpack(args.local_evidence, directory, ROOT, args.commit)
                    required_findings = findings(read_json(directory / local.SCANOSS / "results.json"),
                                                 read_json(directory / local.SCANCODE /
                                                           "source-license-scan.json"))
                evidence = {"local_evidence": {
                    "release_tag": f"compliance-{args.commit}", "asset_name": local.ASSET_NAME,
                    "sha256": local.digest(args.local_evidence.read_bytes()),
                }}
            else:
                require(all(value is not None for value in workflow_args) and
                        args.scanoss_run_id > 0 and args.compliance_run_id > 0,
                        "Workflow reports require both reports and positive full-run IDs")
                required_findings = findings(read_json(args.scanoss), read_json(args.scancode))
                evidence = {"scanoss_run_id": args.scanoss_run_id,
                            "compliance_run_id": args.compliance_run_id}
            record = {
                "source_commit": args.commit, "reviewer": "",
                **evidence,
                "checks": dict.fromkeys(CHECKS, False),
                "decisions": {key: {"path": value["path"], "resolution": "pending",
                                    "reason": "", "evidence": ""}
                              for key, value in required_findings.items()},
            }
            inventory = args.output.with_suffix(".findings.json")
            inventory.write_text(json.dumps(required_findings, indent=2, ensure_ascii=False) + "\n")
            args.output.write_text(MARKER + "\n\n## Human license and provenance review\n\n"
                                   "All decisions below are pending human review. "
                                   f"Finding details: {inventory.name}.\n\n```json\n" +
                                   json.dumps(record, indent=2, ensure_ascii=False) + "\n```\n")
    except (ComplianceError, ValueError, KeyError, TypeError, OSError, zipfile.BadZipFile,
            subprocess.CalledProcessError) as error:
        print(f"Release compliance incomplete: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
