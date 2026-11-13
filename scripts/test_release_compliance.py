#!/usr/bin/env python3

import copy
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "release_compliance", Path(__file__).with_name("release_compliance.py")
)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


class ReleaseComplianceTest(unittest.TestCase):
    def setUp(self):
        self.commit = "a" * 40
        self.record = {
            "source_commit": self.commit, "reviewer": "maintainer",
            "scanoss_run_id": 10, "compliance_run_id": 20,
            "checks": dict.fromkeys(module.CHECKS, True),
            "decisions": {"baseline:12": {
                "resolution": "standard-pattern", "reason": "Reviewed assertion boilerplate",
                "evidence": "https://example.org/comparison/12",
            }},
        }
        self.issue = {
            "html_url": "https://github.com/example/project/issues/1",
            "state": "closed", "state_reason": "completed", "author_association": "MEMBER",
            "closed_by": {"type": "User", "login": "maintainer"},
            "closed_at": "2026-10-27T12:00:00Z", "updated_at": "2026-10-27T12:00:00Z",
        }
        self.required = {"baseline:12": {"path": "backend/src/app.module.ts"}}

    def validate(self):
        issue = copy.deepcopy(self.issue)
        issue["body"] = module.MARKER + "\n```json\n" + json.dumps(self.record) + "\n```"
        return module.validate_review(issue, "example/project", issue["html_url"],
                                      self.commit, self.required, 10, 20)

    def test_completed_human_review_for_exact_scans_is_accepted(self):
        self.assertEqual(self.validate()["reviewer"], "maintainer")

    def test_pending_missing_or_unsupported_decisions_block_release(self):
        for decisions in ({}, {"baseline:12": {"resolution": "pending"}},
                          {"baseline:12": {"resolution": "accepted-risk"}}):
            with self.subTest(decisions=decisions):
                self.record["decisions"] = decisions
                with self.assertRaises(module.ComplianceError):
                    self.validate()

    def test_old_revision_or_different_runs_cannot_be_reused(self):
        for key, value in (("source_commit", "b" * 40), ("scanoss_run_id", 11),
                           ("compliance_run_id", 21)):
            with self.subTest(key=key):
                original = self.record[key]
                self.record[key] = value
                with self.assertRaises(module.ComplianceError):
                    self.validate()
                self.record[key] = original

    def test_open_outsider_bot_or_mismatched_reviewer_is_rejected(self):
        variants = [
            {"state": "open"}, {"state_reason": "not_planned"},
            {"author_association": "NONE"},
            {"closed_by": {"type": "Bot", "login": "maintainer"}},
            {"closed_by": {"type": "User", "login": "someone-else"}},
            {"updated_at": "2026-10-27T12:01:00Z"},
        ]
        original = copy.deepcopy(self.issue)
        for changes in variants:
            with self.subTest(changes=changes):
                self.issue = original | changes
                with self.assertRaises(module.ComplianceError):
                    self.validate()

    def test_unchecked_rights_or_missing_license_evidence_is_rejected(self):
        self.record["checks"]["assets"] = False
        with self.assertRaises(module.ComplianceError):
            self.validate()
        self.record["checks"]["assets"] = True
        self.record["decisions"]["baseline:12"]["resolution"] = "licensed-reuse"
        with self.assertRaises(module.ComplianceError):
            self.validate()

    def test_removed_file_claim_cannot_hide_existing_source(self):
        self.record["decisions"]["baseline:12"]["resolution"] = "removed"
        with self.assertRaises(module.ComplianceError):
            self.validate()

    def test_only_successful_full_runs_for_same_revision_are_accepted(self):
        run = {"head_sha": self.commit, "path": ".github/workflows/scanoss.yml",
               "event": "workflow_dispatch", "status": "completed", "conclusion": "success"}
        module.validate_run(run, "scanoss.yml", self.commit)
        for changes in ({"event": "pull_request"}, {"conclusion": "failure"},
                        {"head_sha": "b" * 40}, {"path": ".github/workflows/other.yml"}):
            with self.subTest(changes=changes), self.assertRaises(module.ComplianceError):
                module.validate_run(run | changes, "scanoss.yml", self.commit)

    def test_historical_findings_survive_even_when_scanner_no_longer_matches(self):
        report = {"backend/src/app.module.ts": [{"id": "none"}]}
        scancode = {"headers": [{"tool_name": "scancode-toolkit", "errors": []}],
                    "files": [{"type": "file", "path": "LICENSE", "scan_errors": []}]}
        result = module.findings(report, scancode)
        self.assertEqual(len(result), 57)
        self.assertIn("baseline:12", result)
        scancode["files"][0]["scan_errors"] = ["timeout"]
        with self.assertRaises(module.ComplianceError):
            module.findings(report, scancode)

    def test_collect_preserves_reports_and_human_record_after_validation(self):
        scanoss = {"backend/src/app.module.ts": [{"id": "none"}]}
        scancode = {"headers": [{"tool_name": "scancode-toolkit", "errors": []}],
                    "files": [{"type": "file", "path": "LICENSE", "scan_errors": []}]}
        self.record["decisions"] = {
            key: copy.deepcopy(self.record["decisions"]["baseline:12"])
            for key in module.findings(scanoss, scancode)
        }
        issue = self.issue | {
            "body": module.MARKER + "\n```json\n" + json.dumps(self.record) + "\n```"
        }
        run = {"head_sha": self.commit, "event": "workflow_dispatch",
               "status": "completed", "conclusion": "success"}
        policy = module.read_json(module.ROOT / "compliance/dependency-license-policy.json")
        components = [{"name": "fixture", "version": "1", "purl": purl}
                      for purl in policy["component_license_overrides"]]
        # Exercise the real dependency checker as well as archive collection.
        real_run = module.subprocess.run

        def download(command, **kwargs):
            if command[:3] != ["gh", "run", "download"]:
                return real_run(command, **kwargs)
            name = command[command.index("--name") + 1]
            destination = Path(command[-1])
            destination.mkdir(parents=True)
            (destination / "revision.txt").write_text(self.commit + "\n")
            if name == "scanoss-code-provenance":
                (destination / "results.json").write_text(json.dumps(scanoss))
                (destination / "mode.txt").write_text("full\n")
                (destination / "status.txt").write_text("Scan completed successfully.\n")
            elif name == "source-license-scan":
                (destination / "source-license-scan.json").write_text(json.dumps(scancode))
            else:
                for index, file in enumerate(("backend-runtime.cdx.json",
                                             "frontend-runtime.cdx.json",
                                             "keycloak-altcha-runtime.json")):
                    entries = components if index == 0 else [{
                        "name": "fixture", "version": "1",
                        "licenses": [{"license": {"id": "MIT"}}],
                    }]
                    (destination / file).write_text(json.dumps({"components": entries}))

        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "evidence"
            args = SimpleNamespace(repository="example/project", commit=self.commit,
                                   review_issue=issue["html_url"], output_dir=destination)
            with patch.object(module, "gh_json", side_effect=[
                issue, run | {"path": ".github/workflows/scanoss.yml"},
                run | {"path": ".github/workflows/compliance.yml"},
            ]), patch.object(module.subprocess, "check_output", side_effect=[self.commit, ""]), \
                    patch.object(module.subprocess, "run", side_effect=download):
                module.collect(args)
            self.assertEqual((destination / "revision.txt").read_text().strip(), self.commit)
            self.assertEqual(module.read_json(destination / "review-issue.json"), issue)
            self.assertEqual(len(module.read_json(destination / "findings.json")), 57)


if __name__ == "__main__":
    unittest.main()
