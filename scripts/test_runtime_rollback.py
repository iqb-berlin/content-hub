"""Exercise the real restore/rollback entry points with a stateful Docker fixture."""

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
BACKEND = "ghcr.io/example/backend@sha256:" + "a" * 64
FRONTEND = "ghcr.io/example/frontend@sha256:" + "b" * 64

DOCKER = r'''#!/usr/bin/env python3
import json, os, sys, tarfile
from pathlib import Path
args = sys.argv[1:]
root = Path(os.environ["ROLLBACK_FIXTURE"])
legacy = "  content-pool-db:" in Path("docker-compose.server.yml").read_text()
with (root / "docker.jsonl").open("a") as output:
    output.write(json.dumps({"args": args, "legacy": legacy}) + "\n")
if args[:2] == ["compose", "version"]:
    sys.exit(0)
if args[0] == "compose":
    prefix = "content-pool" if legacy else "content-hub"
    if "config" in args:
        if "--services" in args:
            print("\n".join([prefix + "-api", prefix + "-db", "nginx", "keycloak", "keycloak-db"]))
        sys.exit(0)
    if "ps" in args:
        print(args[-1] + "-id")
        sys.exit(0)
    if "stop" in args:
        if os.environ.get("ROLLBACK_STOP_FAIL") == "true":
            sys.exit(1)
        if "content-hub-db" in args:
            (root / "current-db-active").unlink(missing_ok=True)
        sys.exit(0)
    if "up" in args:
        if legacy and (root / "current-db-active").exists():
            print("refusing two PostgreSQL services on the same volume", file=sys.stderr)
            sys.exit(1)
        sys.exit(0)
    if "pull" in args and os.environ.get("ROLLBACK_PULL_FAIL") == "true":
        sys.exit(1)
    if "run" in args:
        sys.stdin.buffer.read()
        sys.exit(0)
if args[0] == "inspect":
    if "State.Running" in args[-1]:
        print("true")
    elif "com.docker.compose.project" in args[-1]:
        print("legacy-content-pool")
    elif "com.docker.compose.service" in args[-1]:
        print("content-pool-db" if legacy else "content-hub-db")
    elif "Mounts" in args[-1]:
        values = dict(line.split("=", 1) for line in Path(".env").read_text().splitlines() if "=" in line)
        print(values["CONTENT_HUB_DB_VOLUME"])
    else:
        print("sha256:" + "a" * 64)
    sys.exit(0)
if args[:2] == ["image", "inspect"]:
    if "--format" in args:
        print("ghcr.io/example/backend@sha256:" + "a" * 64)
    sys.exit(0)
if args[0] == "exec":
    if "pg_dump" in args:
        sys.stdout.buffer.write(b"database dump fixture")
    elif "pg_restore" in args:
        sys.stdin.buffer.read()
    elif "tar" in args:
        with tarfile.open(fileobj=sys.stdout.buffer, mode="w|gz"):
            pass
    else:
        raise SystemExit("unexpected exec: " + repr(args))
    sys.exit(0)
raise SystemExit("unexpected Docker invocation: " + repr(args))
'''


class RuntimeRollbackTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="content-hub-rollback-test-")
        self.directory = Path(self.temp.name)
        self.app = self.directory / "application"
        self.old = self.directory / "legacy-runtime"
        for directory in [self.app / "scripts", self.app / "bin", self.old]:
            directory.mkdir(parents=True)
        for name in ["restore.sh", "update.sh", "deploy-common.sh", "release_manifest.py"]:
            shutil.copy2(ROOT / "scripts" / name, self.app / "scripts" / name)
        self.legacy_env = (
            "POSTGRES_USER=content_pool\nPOSTGRES_DB=content_pool\n"
            "KEYCLOAK_DB_USER=keycloak\nKEYCLOAK_DB_NAME=keycloak\n"
            "COMPOSE_PROJECT_NAME=legacy-content-pool\n"
        )
        self.legacy_compose = (
            "services:\n  content-pool-db:\n"
            "    volumes: [content-pool-db-data:/var/lib/postgresql/data]\n"
            "  content-pool-api: {}\n  nginx: {}\n  keycloak: {}\n  keycloak-db: {}\n"
            "volumes:\n  content-pool-db-data: {}\n"
        )
        self.current_compose = self.legacy_compose.replace("content-pool", "content-hub")
        (self.old / ".env").write_text(self.legacy_env)
        (self.old / "docker-compose.server.yml").write_text(self.legacy_compose)
        (self.app / "docker-compose.server.yml").write_text(self.current_compose)
        (self.app / ".env").write_text(
            self.legacy_env + "DEPLOYMENT_ENV=production\nRELEASE_VERSION=v0.7.0\n"
            "DB_SYNCHRONIZE=false\nDB_RUN_MIGRATIONS=true\n"
            "CORS_ORIGIN=https://iqb-contentpool.de\n"
            "OIDC_PUBLIC_ISSUER_URL=https://iqb-contentpool.de/realms/iqb\n"
            "OIDC_REDIRECT_URI=https://iqb-contentpool.de/auth/callback\n"
            "CONTENT_HUB_DB_VOLUME=legacy-content-pool_content-pool-db-data\n"
            f"CONTENT_HUB_BACKEND_IMAGE={BACKEND}\nCONTENT_HUB_FRONTEND_IMAGE={FRONTEND}\n"
        )
        self.active = self.app / "current-db-active"
        self.active.touch()
        docker = self.app / "bin" / "docker"
        docker.write_text(DOCKER)
        docker.chmod(0o755)
        self.environment = dict(
            os.environ,
            PATH=str(self.app / "bin") + os.pathsep + os.environ["PATH"],
            ROLLBACK_FIXTURE=str(self.app),
        )

    def tearDown(self):
        self.temp.cleanup()

    def archive(self, path, names):
        with tarfile.open(path, "w:gz") as archive:
            for name in names:
                archive.add(self.old / name, arcname=name)

    def checksums(self, directory, names):
        (directory / "SHA256SUMS").write_text("".join(
            hashlib.sha256((directory / name).read_bytes()).hexdigest() + "  " + name + "\n"
            for name in names
        ))

    def command(self, kind):
        if kind in {"manifest", "failed-update"}:
            release = self.app / "release"
            release.mkdir()
            if kind == "failed-update":
                (self.old / "docker-compose.server.yml").write_text(self.current_compose + "# replacement runtime\n")
            self.archive(release / "runtime.tgz", ["docker-compose.server.yml"])
            digest = hashlib.sha256((release / "runtime.tgz").read_bytes()).hexdigest()
            version = "v0.7.1" if kind == "failed-update" else "v0.6.0"
            subprocess.run([
                sys.executable, str(ROOT / "scripts/release_manifest.py"), "create",
                "--release", version, "--application-version", version[1:],
                "--commit", "a" * 40, "--built-at", "2026-10-30T10:00:00Z",
                "--backend-image", BACKEND, "--frontend-image", FRONTEND,
                "--runtime-archive", "runtime.tgz", "--runtime-sha256", digest,
                "--migration-classification", "backward-compatible",
                "--output", str(release / "release-manifest.json"),
            ], check=True, capture_output=True, text=True)
            self.checksums(release, ["runtime.tgz", "release-manifest.json"])
            command = ["bash", "scripts/update.sh", "--mode", "server", "--environment", "production",
                       "--release" if kind == "failed-update" else "--rollback-to", version,
                       "--manifest", str(release / "release-manifest.json"),
                       "--no-keycloak-user-check", "--no-health-check", "--yes"]
            if kind != "failed-update":
                command.append("--no-pull")
            return command
        if kind == "restore":
            backup = self.app / "backup"
            backup.mkdir()
            self.archive(backup / "config.tgz", [".env", "docker-compose.server.yml"])
            self.archive(backup / "uploads.tgz", [])
            (backup / "manifest.txt").write_text("mode=server\n")
            for name in ["content-pool-db.dump", "keycloak-db.dump"]:
                (backup / name).write_bytes(b"database dump fixture")
            self.checksums(backup, ["manifest.txt", "config.tgz", "uploads.tgz", "content-pool-db.dump", "keycloak-db.dump"])
            return ["bash", "scripts/restore.sh", "--from-backup", str(backup), "--yes", "--no-health-check"]

        baseline = self.app / "baselines" / "v0.6.0"
        baseline.mkdir(parents=True)
        self.archive(baseline / "runtime.tgz", [".env", "docker-compose.server.yml"])
        (baseline / "manifest.json").write_text(json.dumps({
            "schemaVersion": 1, "type": "legacy-baseline", "release": "v0.6.0",
            "environment": "production", "composeProject": "legacy-content-pool",
            "images": {"backend": BACKEND, "frontend": FRONTEND},
            "runtime": {"archive": "runtime.tgz", "sha256": hashlib.sha256((baseline / "runtime.tgz").read_bytes()).hexdigest()},
        }))
        self.checksums(baseline, ["manifest.json", "runtime.tgz"])
        return ["bash", "scripts/update.sh", "--mode", "server", "--environment", "production", "--rollback-to", "v0.6.0", "--no-keycloak-user-check", "--no-pull", "--no-health-check", "--yes"]

    def run_command(self, kind, stop_fails=False):
        environment = self.environment.copy()
        if stop_fails:
            environment["ROLLBACK_STOP_FAIL"] = "true"
        return subprocess.run(self.command(kind), cwd=self.app, env=environment, text=True, capture_output=True)

    def calls(self):
        return [json.loads(line) for line in (self.app / "docker.jsonl").read_text().splitlines()]

    def assert_safe_rollback(self, kind):
        result = self.run_command(kind)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        calls = self.calls()
        old_start = next(i for i, call in enumerate(calls) if "up" in call["args"] and call["legacy"])
        stops = [call for call in calls[:old_start] if "stop" in call["args"] and not call["legacy"]]
        self.assertTrue(any("content-hub-db" in call["args"] for call in stops))
        self.assertTrue(any("content-hub-api" in call["args"] for call in stops))
        self.assertFalse(self.active.exists())

    def assert_failed_stop_preserves_runtime(self, kind):
        before = (self.app / ".env").read_text()
        result = self.run_command(kind, stop_fails=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.app / "docker-compose.server.yml").read_text(), self.current_compose)
        self.assertEqual((self.app / ".env").read_text(), before)
        self.assertTrue(self.active.exists())
        self.assertFalse(any(call["legacy"] for call in self.calls()))

    def test_restore_stops_current_database_before_starting_legacy_database(self):
        self.assert_safe_rollback("restore")

    def test_baseline_stops_current_database_before_starting_legacy_database(self):
        self.assert_safe_rollback("baseline")

    def test_restore_retains_current_runtime_when_stop_fails(self):
        self.assert_failed_stop_preserves_runtime("restore")

    def test_baseline_retains_current_runtime_when_stop_fails(self):
        self.assert_failed_stop_preserves_runtime("baseline")

    def test_manifest_rollback_stops_current_database_before_legacy_start(self):
        self.assert_safe_rollback("manifest")

    def test_manifest_rollback_retains_current_runtime_when_stop_fails(self):
        self.assert_failed_stop_preserves_runtime("manifest")

    def test_manifest_rollback_rejects_an_unmapped_database_volume(self):
        env = self.app / ".env"
        before = env.read_text().replace("legacy-content-pool_content-pool-db-data", "fresh-content-hub-db-data")
        env.write_text(before)
        result = self.run_command("manifest")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("use the saved baseline or a full restore", result.stderr)
        self.assertEqual((self.app / "docker-compose.server.yml").read_text(), self.current_compose)
        self.assertEqual(env.read_text(), before)
        self.assertTrue(self.active.exists())
        self.assertFalse(any(call["legacy"] for call in self.calls()))

    def test_automatic_rollback_does_not_restore_configuration_when_stop_fails(self):
        environment = dict(self.environment, ROLLBACK_PULL_FAIL="true", ROLLBACK_STOP_FAIL="true")
        result = subprocess.run(self.command("failed-update"), cwd=self.app, env=environment, text=True, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("rollback configuration was not replaced", result.stderr)
        self.assertIn("# replacement runtime", (self.app / "docker-compose.server.yml").read_text())
        self.assertFalse(any("up" in call["args"] for call in self.calls()))
        self.assertTrue(self.active.exists())


if __name__ == "__main__":
    unittest.main()
