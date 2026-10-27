#!/usr/bin/env python3
"""Exercise local evidence trust boundaries and the release collector end to end."""

import copy
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
import warnings
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import local_compliance as local
import release_compliance as release


class LocalComplianceTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.root = self.directory / "repo"
        self.root.mkdir()
        for name in ("LICENSE", "docs/scanoss-review-2026-09-10.json",
                     "compliance/dependency-license-policy.json",
                     "scripts/check-dependency-licenses.py", "scripts/summarize-scanoss.py"):
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(release.ROOT / name, target)
        (self.root / "specimen.py").write_text("print('independently authored fixture')\n")
        (self.root / "empty").touch()
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        subprocess.run(["git", "add", "."], cwd=self.root, check=True)
        subprocess.run(["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.org",
                        "commit", "-qm", "fixture"], cwd=self.root, check=True)
        self.commit = local.git(self.root, "rev-parse", "HEAD").decode().strip()
        self.evidence = self.directory / "evidence"
        self.evidence.mkdir()
        for name in local.REQUIRED:
            path = self.evidence / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("")
        for name in ("revision.txt", f"{local.SCANOSS}/revision.txt",
                     f"{local.SCANCODE}/revision.txt", "dependency-sboms/revision.txt"):
            (self.evidence / name).write_text(self.commit + "\n")
        self.sources = local.inventory(local.source_contents(self.root, self.commit))
        self.write("source-files.json", self.sources)
        self.write(f"{local.SCANOSS}/results.json", {"specimen.py": [{"id": "none"}]})
        specimen = self.sources["specimen.py"]
        (self.evidence / local.SCANOSS / "fingerprints.wfp").write_text(
            f"file={specimen['md5']},{specimen['size']},specimen.py\n")
        for name, value in (("mode.txt", "full"), ("status.txt", "Scan completed successfully."),
                            ("exit-code.txt", "0"), ("tool-version.txt", "1.54.2"),
                            ("scanned-files.txt", "specimen.py")):
            (self.evidence / local.SCANOSS / name).write_text(value + "\n")
        (self.evidence / local.SCANOSS / "excluded-files.txt").write_text(
            "".join(f"{p}\n" for p in sorted(set(self.sources) - {"specimen.py"})))
        (self.evidence / local.SCANCODE / "exit-code.txt").write_text("0\n")
        (self.evidence / local.SCANCODE / "tool-version.txt").write_text("32.5.0\n")
        self.scancode = {
            "headers": [{"tool_name": "scancode-toolkit", "errors": [], "options":
                         dict.fromkeys(("--license", "--copyright", "--package", "--info"), True)}],
            "files": [{"type": "file", "path": p, "sha256": data["sha256"] if data["size"] else None,
                       "size": data["size"], "scan_errors": [],
                       "detected_license_expression_spdx": "Apache-2.0" if p == "LICENSE" else None}
                      for p, data in self.sources.items()],
        }
        self.write(f"{local.SCANCODE}/source-license-scan.json", self.scancode)
        policy = release.read_json(release.ROOT / "compliance/dependency-license-policy.json")
        overrides = [{"name": "fixture", "version": "1", "purl": purl}
                     for purl in policy["component_license_overrides"]]
        for index, name in enumerate(local.SBOMS):
            self.write(f"dependency-sboms/{name}", {"components": overrides if index == 0 else [{
                "name": "fixture", "version": "1", "licenses": [{"license": {"id": "MIT"}}],
            }]})
        self.archive = self.directory / local.ASSET_NAME

    def write(self, name, value):
        (self.evidence / name).write_text(json.dumps(value))

    def package(self):
        return local.package(self.evidence, self.archive, self.root, self.commit)

    def test_complete_bundle_roundtrip_is_bound_to_git_contents(self):
        checksum = self.package()
        destination = self.directory / "unpacked"
        local.unpack(self.archive, destination, self.root, self.commit)
        self.assertEqual(checksum, local.digest(self.archive.read_bytes()))
        self.assertEqual(json.loads((destination / "source-files.json").read_text()), self.sources)

    def test_incomplete_failed_or_wrong_source_reports_cannot_be_packaged(self):
        mutations = [
            (f"{local.SCANOSS}/exit-code.txt", "1"),
            (f"{local.SCANOSS}/status.txt", "API rate limited; incomplete"),
            (f"{local.SCANOSS}/revision.txt", "b" * 40),
            (f"{local.SCANOSS}/results.json", "{}"),
            (f"{local.SCANOSS}/excluded-files.txt", ""),
            (f"{local.SCANOSS}/fingerprints.wfp", "file=" + "0" * 32 + ",1,specimen.py\n"),
            ("source-files.json", "{}"),
        ]
        for name, value in mutations:
            path = self.evidence / name
            original = path.read_text()
            with self.subTest(name=name), self.assertRaises(ValueError):
                path.write_text(value)
                self.package()
            path.write_text(original)
        for changes in ({"scan_errors": ["timeout"]}, {"sha256": "0" * 64}):
            altered = copy.deepcopy(self.scancode)
            altered["files"][0].update(changes)
            self.write(f"{local.SCANCODE}/source-license-scan.json", altered)
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.package()
        altered = copy.deepcopy(self.scancode)
        altered["files"].pop()
        self.write(f"{local.SCANCODE}/source-license-scan.json", altered)
        with self.assertRaises(ValueError):
            self.package()

    def test_unrequested_scancode_operations_or_missing_report_block(self):
        self.scancode["headers"][0]["options"]["--license"] = False
        self.write(f"{local.SCANCODE}/source-license-scan.json", self.scancode)
        with self.assertRaises(ValueError):
            self.package()
        (self.evidence / "dependency-sboms" / local.SBOMS[0]).unlink()
        with self.assertRaises(ValueError):
            self.package()

    def rewrite_archive(self, transform):
        with zipfile.ZipFile(self.archive) as original:
            entries = [(entry, original.read(entry)) for entry in original.infolist()]
        with zipfile.ZipFile(self.archive, "w") as changed:
            for entry, data in entries:
                changed.writestr(entry, transform(entry.filename, data))

    def test_tampering_wrong_commit_and_source_tree_are_rejected(self):
        self.package()
        original = self.archive.read_bytes()
        with self.assertRaises(ValueError):
            local.unpack(self.archive, self.directory / "wrong", self.root, "b" * 40)
        self.rewrite_archive(lambda name, data: json.dumps(
            json.loads(data) | {"source_tree": "b" * 40}).encode()
            if name == "manifest.json" else data)
        with self.assertRaisesRegex(ValueError, "tree mismatch"):
            local.unpack(self.archive, self.directory / "wrong-tree", self.root, self.commit)
        self.archive.write_bytes(original)
        self.rewrite_archive(lambda name, data: b"changed" if name.endswith("results.json") else data)
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            local.unpack(self.archive, self.directory / "tampered", self.root, self.commit)

    def test_unsafe_duplicate_and_oversize_archive_members_are_rejected(self):
        self.package()
        original = self.archive.read_bytes()
        for name in ("../escape", "/absolute", "revision.txt"):
            self.archive.write_bytes(original)
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                with zipfile.ZipFile(self.archive, "a") as archive:
                    archive.writestr(name, "bad")
            with self.subTest(name=name), self.assertRaises(ValueError):
                local.unpack(self.archive, self.directory / "unsafe", self.root, self.commit)
        self.archive.write_bytes(original)
        with patch.object(local, "MAX_EXPANDED", 1), self.assertRaises(ValueError):
            local.unpack(self.archive, self.directory / "too-big", self.root, self.commit)

    def test_collect_accepts_local_evidence_only_with_checksum_bound_human_review(self):
        checksum = self.package()
        required = release.findings({"specimen.py": [{"id": "none"}]}, self.scancode)
        reference = {"release_tag": f"compliance-{self.commit}", "asset_name": local.ASSET_NAME,
                     "sha256": checksum}
        record = {"source_commit": self.commit, "reviewer": "maintainer",
                  "local_evidence": reference, "checks": dict.fromkeys(release.CHECKS, True),
                  "decisions": {key: {"resolution": "standard-pattern",
                                      "reason": "Reviewed fixture comparison manually",
                                      "evidence": "https://example.org/verified-comparison"}
                                for key in required}}
        issue = {"html_url": "https://github.com/example/project/issues/1", "state": "closed",
                 "state_reason": "completed", "author_association": "MEMBER",
                 "closed_by": {"type": "User", "login": "maintainer"},
                 "closed_at": "2026-10-27T12:00:00Z", "updated_at": "2026-10-27T12:00:00Z",
                 "body": release.MARKER + "\n```json\n" + json.dumps(record) + "\n```"}
        release_data = {"tag_name": reference["release_tag"], "prerelease": True,
                        "assets": [{"name": local.ASSET_NAME, "size": self.archive.stat().st_size}]}
        real_run = subprocess.run

        def download(command, **kwargs):
            if command[:3] == ["gh", "release", "download"]:
                shutil.copyfile(self.archive, Path(command[-1]) / local.ASSET_NAME)
                return
            return real_run(command, **kwargs)

        destination = self.directory / "collected"
        args = SimpleNamespace(repository="example/project", commit=self.commit,
                               review_issue=issue["html_url"], output_dir=destination)
        with patch.object(release, "ROOT", self.root), \
                patch.object(release, "gh_json", side_effect=[issue, release_data]), \
                patch.object(subprocess, "run", side_effect=download):
            release.collect(args)
        self.assertEqual(release.read_json(destination / "review-record.json"), record)
        self.assertTrue((destination / local.ASSET_NAME).is_file())
        for changes in ({"sha256": "0" * 64}, {"release_tag": "arbitrary"},
                        {"asset_name": "../../untrusted"}):
            changed_record = record | {"local_evidence": reference | changes}
            with self.subTest(changes=changes), patch.object(release, "ROOT", self.root), \
                    patch.object(release, "gh_json", return_value=release_data), \
                    patch.object(subprocess, "run", side_effect=download), self.assertRaises(ValueError):
                target = self.directory / ("rejected-" + next(iter(changes)))
                target.mkdir()
                release.download_local(changed_record, "example/project", self.commit, target)
        record["scanoss_run_id"] = 10
        issue["body"] = release.MARKER + "\n```json\n" + json.dumps(record) + "\n```"
        with self.assertRaises(ValueError):
            release.validate_review(issue, "example/project", issue["html_url"], self.commit,
                                    required, local_evidence=reference)

    def test_failed_scan_stops_before_next_tool_or_packaging(self):
        output = self.directory / "failed-scan"
        real_output = subprocess.check_output

        def versions(command, **kwargs):
            if command[0] == "scanoss-py":
                return "1.54.2"
            if command[0] == "scancode":
                return "32.5.0"
            return real_output(command, **kwargs)

        real_run = subprocess.run
        calls = []

        def fail_scan(command, **kwargs):
            if command[0] == "scanoss-py":
                calls.append(command)
                return subprocess.CompletedProcess(command, 1)
            return real_run(command, **kwargs)

        with patch.object(subprocess, "check_output", side_effect=versions), \
                patch.object(subprocess, "run", side_effect=fail_scan):
            with self.assertRaises(subprocess.CalledProcessError):
                local.scan(output, self.root)
        self.assertEqual(len(calls), 1)
        self.assertEqual((output / local.SCANOSS / "exit-code.txt").read_text(), "1\n")
        self.assertFalse((output / local.ASSET_NAME).exists())
        self.assertNotEqual((output / local.SCANOSS / "status.txt").read_text().strip(),
                            "Scan completed successfully.")

    def test_local_review_cli_produces_pending_record_and_rejects_mixed_modes(self):
        self.package()
        draft = self.directory / "draft.md"
        command = ["release_compliance.py", "draft-review", "--commit", self.commit,
                   "--local-evidence", str(self.archive), "--output", str(draft)]
        with patch.object(sys, "argv", command), patch.object(release, "ROOT", self.root):
            self.assertEqual(release.main(), 0)
        record = json.loads(draft.read_text().split("```json\n")[1].split("\n```")[0])
        self.assertEqual(record["local_evidence"]["sha256"], local.digest(self.archive.read_bytes()))
        self.assertFalse(any(record["checks"].values()))
        self.assertEqual(record["reviewer"], "")
        self.assertTrue(all(value["resolution"] == "pending"
                            for value in record["decisions"].values()))
        self.assertNotIn("scanoss_run_id", record)
        with patch.object(sys, "argv", command + ["--scanoss-run-id", "10"]):
            self.assertEqual(release.main(), 1)


if __name__ == "__main__":
    unittest.main()
