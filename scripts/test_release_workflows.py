#!/usr/bin/env python3

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"


class ReleaseWorkflowTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.candidate = (WORKFLOWS / "release-candidate.yml").read_text()
        cls.staging = (WORKFLOWS / "promote-release.yml").read_text()
        cls.exception = (WORKFLOWS / "promote-production-exception.yml").read_text()
        cls.core = (WORKFLOWS / "promote-release-core.yml").read_text()
        cls.cleanup = (WORKFLOWS / "cleanup-failed-release-candidate.yml").read_text()
        cls.exception_template = (
            ROOT / ".github" / "ISSUE_TEMPLATE" / "production-release-exception.md"
        ).read_text()

    def test_candidate_tags_are_published_only_after_both_scans(self) -> None:
        self.assertEqual(self.candidate.count("${{ needs.validate.outputs.release }}-build"), 2)
        publish = self.candidate.index("name: Publish verified image tags")
        self.assertLess(self.candidate.index("name: Scan published backend image"), publish)
        self.assertLess(self.candidate.index("name: Scan published frontend image"), publish)
        self.assertNotIn("name: Reject an existing candidate image", self.candidate)

    def test_candidate_builds_can_be_reused_safely(self) -> None:
        self.assertEqual(self.candidate.count("name: Resolve existing candidate build"), 2)
        self.assertEqual(self.candidate.count("org.opencontainers.image.revision"), 3)
        self.assertEqual(self.candidate.count("org.opencontainers.image.version"), 3)
        self.assertEqual(self.candidate.count("org.opencontainers.image.created"), 3)
        self.assertEqual(self.candidate.count("timeout-minutes: 45"), 2)

    def test_staging_and_exception_promotions_are_separate(self) -> None:
        core_call = "uses: ./.github/workflows/promote-release-core.yml"
        self.assertIn(core_call, self.staging)
        self.assertIn("validation_mode: staging", self.staging)
        self.assertNotIn("production-exception", self.staging)
        self.assertIn(core_call, self.exception)
        self.assertIn("validation_mode: production-exception", self.exception)
        self.assertIn("environment: production", self.core)

    def test_production_exception_requires_a_completed_issue_record(self) -> None:
        marker = "<!-- content-hub-production-release-exception -->"
        self.assertIn("scripts/production_exception.py validate", self.core)
        self.assertIn(marker, self.exception_template)
        preconditions = self.exception_template.split(
            "## Required production preconditions", 1
        )[1].split("## Post-deployment verification", 1)[0]
        self.assertIn("- [ ]", preconditions)

    def test_failed_candidate_cleanup_is_strictly_scoped(self) -> None:
        self.assertIn("delete-failed-candidate", self.cleanup)
        self.assertIn("! git ls-remote --exit-code --tags", self.cleanup)
        self.assertIn("! gh release view", self.cleanup)
        self.assertIn("Refusing to delete", self.cleanup)
        self.assertIn("packages: write", self.cleanup)


if __name__ == "__main__":
    unittest.main()
