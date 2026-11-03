#!/usr/bin/env python3

import json
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("release_manifest.py")
COMMIT = "a" * 40
BACKEND = "ghcr.io/iqb-berlin/content-hub-backend@sha256:" + "b" * 64
FRONTEND = "ghcr.io/iqb-berlin/content-hub-frontend@sha256:" + "c" * 64


class ReleaseManifestTest(unittest.TestCase):
    def run_tool(self, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["python3", str(SCRIPT), *args],
            check=check,
            text=True,
            capture_output=True,
        )

    def create_manifest(self, directory: Path, release: str = "v0.2.0-rc.1") -> tuple[Path, Path]:
        archive = directory / "runtime.tar.gz"
        archive.write_bytes(b"runtime")
        import hashlib

        checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
        manifest = directory / "release-manifest.json"
        self.run_tool(
            "create",
            "--release",
            release,
            "--application-version",
            "0.2.0",
            "--commit",
            COMMIT,
            "--built-at",
            "2026-07-22T10:00:00Z",
            "--backend-image",
            BACKEND,
            "--frontend-image",
            FRONTEND,
            "--runtime-archive",
            archive.name,
            "--runtime-sha256",
            checksum,
            "--migration-classification",
            "backward-compatible",
            "--output",
            str(manifest),
        )
        return manifest, archive

    def test_validates_archive_and_staging_candidate(self):
        with tempfile.TemporaryDirectory() as raw:
            manifest, archive = self.create_manifest(Path(raw))
            self.run_tool(
                "validate",
                "--manifest",
                str(manifest),
                "--expected-release",
                "v0.2.0-rc.1",
                "--environment",
                "staging",
                "--runtime-archive",
                str(archive),
            )

    def test_rejects_candidate_in_production(self):
        with tempfile.TemporaryDirectory() as raw:
            manifest, _ = self.create_manifest(Path(raw))
            result = self.run_tool(
                "validate",
                "--manifest",
                str(manifest),
                "--environment",
                "production",
                check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("cannot be deployed to production", result.stderr)

    def test_rejects_checksum_mismatch(self):
        with tempfile.TemporaryDirectory() as raw:
            manifest, archive = self.create_manifest(Path(raw))
            archive.write_bytes(b"changed")
            result = self.run_tool(
                "validate",
                "--manifest",
                str(manifest),
                "--runtime-archive",
                str(archive),
                check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("checksum mismatch", result.stderr)

    def test_rejects_unsafe_archive_name(self):
        with tempfile.TemporaryDirectory() as raw:
            manifest, _ = self.create_manifest(Path(raw))
            data = json.loads(manifest.read_text())
            data["runtime"]["archive"] = "../runtime.tar.gz"
            manifest.write_text(json.dumps(data))
            result = self.run_tool("validate", "--manifest", str(manifest), check=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("safe file name", result.stderr)

    def test_promotes_without_changing_image_digests(self):
        with tempfile.TemporaryDirectory() as raw:
            directory = Path(raw)
            manifest, _ = self.create_manifest(directory)
            stable = directory / "stable.json"
            self.run_tool(
                "promote",
                "--manifest",
                str(manifest),
                "--release",
                "v0.2.0",
                "--output",
                str(stable),
            )
            data = json.loads(stable.read_text())
            self.assertEqual(data["candidate"], "v0.2.0-rc.1")
            self.assertEqual(data["images"], {"backend": BACKEND, "frontend": FRONTEND})

    def test_semver_comparison_orders_candidates_before_stable(self):
        self.assertEqual(
            self.run_tool("compare", "--current", "v0.2.0-rc.1", "--target", "v0.2.0-rc.2").stdout.strip(),
            "newer",
        )
        self.assertEqual(
            self.run_tool("compare", "--current", "v0.2.0-rc.2", "--target", "v0.2.0").stdout.strip(),
            "newer",
        )


if __name__ == "__main__":
    unittest.main()
