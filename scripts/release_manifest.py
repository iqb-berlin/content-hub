#!/usr/bin/env python3
"""Create, validate, and inspect Content Hub release manifests."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


RELEASE_RE = re.compile(r"^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.([1-9]\d*))?$")
DIGEST_IMAGE_RE = re.compile(r"^[^\s@]+@sha256:[0-9a-f]{64}$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
MIGRATION_CLASSES = {"none", "backward-compatible", "manual"}


class ManifestError(ValueError):
    pass


def load_manifest(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ManifestError(f"cannot read manifest {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise ManifestError("manifest root must be an object")
    return data


def parse_release(value: str) -> tuple[int, int, int, int | None]:
    match = RELEASE_RE.fullmatch(value)
    if not match:
        raise ManifestError(
            f"invalid release '{value}'; expected vMAJOR.MINOR.PATCH or vMAJOR.MINOR.PATCH-rc.N"
        )
    major, minor, patch, rc = match.groups()
    return int(major), int(minor), int(patch), int(rc) if rc else None


def is_prerelease(value: str) -> bool:
    return parse_release(value)[3] is not None


def validate_manifest(
    data: dict[str, Any], expected_release: str | None = None, environment: str | None = None
) -> None:
    if data.get("schemaVersion") != 1:
        raise ManifestError("schemaVersion must be 1")

    release = data.get("release")
    if not isinstance(release, str):
        raise ManifestError("release must be a string")
    parse_release(release)
    if expected_release and release != expected_release:
        raise ManifestError(f"manifest release {release} does not match requested {expected_release}")
    if environment not in {None, "staging", "production"}:
        raise ManifestError("environment must be staging or production")
    if environment == "production" and is_prerelease(release):
        raise ManifestError("release candidates cannot be deployed to production")

    application_version = data.get("applicationVersion")
    if not isinstance(application_version, str) or not re.fullmatch(
        r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", application_version
    ):
        raise ManifestError("applicationVersion must be stable SemVer without a v prefix")
    if application_version != release.removeprefix("v").split("-rc.", 1)[0]:
        raise ManifestError("applicationVersion must match the release major.minor.patch")

    commit = data.get("sourceCommit")
    if not isinstance(commit, str) or not COMMIT_RE.fullmatch(commit):
        raise ManifestError("sourceCommit must be a full lowercase Git commit SHA")

    built_at = data.get("builtAt")
    if not isinstance(built_at, str):
        raise ManifestError("builtAt must be an ISO-8601 string")
    try:
        timestamp = datetime.fromisoformat(built_at.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ManifestError("builtAt must be an ISO-8601 string") from exc
    if timestamp.tzinfo is None:
        raise ManifestError("builtAt must include a timezone")

    images = data.get("images")
    if not isinstance(images, dict):
        raise ManifestError("images must be an object")
    for name in ("backend", "frontend"):
        image = images.get(name)
        if not isinstance(image, str) or not DIGEST_IMAGE_RE.fullmatch(image):
            raise ManifestError(f"images.{name} must be a repository@sha256 digest reference")

    runtime = data.get("runtime")
    if not isinstance(runtime, dict):
        raise ManifestError("runtime must be an object")
    if (
        not isinstance(runtime.get("archive"), str)
        or not runtime["archive"]
        or Path(runtime["archive"]).name != runtime["archive"]
    ):
        raise ManifestError("runtime.archive must be a safe file name")
    if not re.fullmatch(r"[0-9a-f]{64}", str(runtime.get("sha256", ""))):
        raise ManifestError("runtime.sha256 must be a lowercase SHA-256 digest")

    migrations = data.get("migrations")
    if not isinstance(migrations, dict) or migrations.get("classification") not in MIGRATION_CLASSES:
        raise ManifestError(
            "migrations.classification must be none, backward-compatible, or manual"
        )

    required = data.get("requiredConfiguration")
    if (
        not isinstance(required, list)
        or not all(isinstance(item, str) and re.fullmatch(r"[A-Z][A-Z0-9_]*", item) for item in required)
        or len(required) != len(set(required))
    ):
        raise ManifestError("requiredConfiguration must contain unique environment variable names")


def nested_get(data: dict[str, Any], field: str) -> Any:
    value: Any = data
    for part in field.split("."):
        if not isinstance(value, dict) or part not in value:
            raise ManifestError(f"field not found: {field}")
        value = value[part]
    return value


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def command_validate(args: argparse.Namespace) -> None:
    data = load_manifest(Path(args.manifest))
    validate_manifest(data, args.expected_release, args.environment)
    if args.runtime_archive:
        archive = Path(args.runtime_archive)
        actual = sha256_file(archive)
        expected = nested_get(data, "runtime.sha256")
        if actual != expected:
            raise ManifestError(
                f"runtime archive checksum mismatch: expected {expected}, got {actual}"
            )


def command_get(args: argparse.Namespace) -> None:
    data = load_manifest(Path(args.manifest))
    value = nested_get(data, args.field)
    if isinstance(value, (dict, list)):
        print(json.dumps(value, separators=(",", ":")))
    elif isinstance(value, bool):
        print("true" if value else "false")
    else:
        print(value)


def command_create(args: argparse.Namespace) -> None:
    data = {
        "schemaVersion": 1,
        "release": args.release,
        "applicationVersion": args.application_version,
        "sourceCommit": args.commit,
        "builtAt": args.built_at,
        "images": {"backend": args.backend_image, "frontend": args.frontend_image},
        "runtime": {"archive": args.runtime_archive, "sha256": args.runtime_sha256},
        "migrations": {"classification": args.migration_classification},
        "requiredConfiguration": args.required_configuration,
    }
    if args.candidate:
        data["candidate"] = args.candidate
    validate_manifest(data)
    Path(args.output).write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def command_promote(args: argparse.Namespace) -> None:
    data = load_manifest(Path(args.manifest))
    validate_manifest(data)
    candidate = data["release"]
    if not is_prerelease(candidate):
        raise ManifestError("only a release candidate can be promoted")
    stable = args.release
    stable_parts = parse_release(stable)
    candidate_parts = parse_release(candidate)
    if stable_parts[3] is not None or stable_parts[:3] != candidate_parts[:3]:
        raise ManifestError("stable release must match the candidate major.minor.patch")
    data["candidate"] = candidate
    data["release"] = stable
    validate_manifest(data)
    Path(args.output).write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def command_compare(args: argparse.Namespace) -> None:
    current = parse_release(args.current)
    target = parse_release(args.target)
    current_key = (*current[:3], 1 if current[3] is None else 0, current[3] or 0)
    target_key = (*target[:3], 1 if target[3] is None else 0, target[3] or 0)
    print("older" if target_key < current_key else "same" if target_key == current_key else "newer")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate = subparsers.add_parser("validate")
    validate.add_argument("--manifest", required=True)
    validate.add_argument("--expected-release")
    validate.add_argument("--environment", choices=("staging", "production"))
    validate.add_argument("--runtime-archive")
    validate.set_defaults(func=command_validate)

    get = subparsers.add_parser("get")
    get.add_argument("--manifest", required=True)
    get.add_argument("--field", required=True)
    get.set_defaults(func=command_get)

    create = subparsers.add_parser("create")
    create.add_argument("--release", required=True)
    create.add_argument("--application-version", required=True)
    create.add_argument("--commit", required=True)
    create.add_argument("--built-at", required=True)
    create.add_argument("--backend-image", required=True)
    create.add_argument("--frontend-image", required=True)
    create.add_argument("--runtime-archive", required=True)
    create.add_argument("--runtime-sha256", required=True)
    create.add_argument("--migration-classification", choices=sorted(MIGRATION_CLASSES), required=True)
    create.add_argument("--required-configuration", action="append", default=[])
    create.add_argument("--candidate")
    create.add_argument("--output", required=True)
    create.set_defaults(func=command_create)

    promote = subparsers.add_parser("promote")
    promote.add_argument("--manifest", required=True)
    promote.add_argument("--release", required=True)
    promote.add_argument("--output", required=True)
    promote.set_defaults(func=command_promote)

    compare = subparsers.add_parser("compare")
    compare.add_argument("--current", required=True)
    compare.add_argument("--target", required=True)
    compare.set_defaults(func=command_compare)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        args.func(args)
    except ManifestError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
