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

    def test_release_sboms_cover_both_images_and_platforms(self) -> None:
        self.assertIn("uses: anchore/sbom-action/download-syft@", self.candidate)
        self.assertIn("syft-version: v1.51.1", self.candidate)
        self.assertIn("for platform in linux/amd64 linux/arm64", self.candidate)
        self.assertIn('"${BACKEND_IMAGE}@${BACKEND_DIGEST}"', self.candidate)
        self.assertIn('"${FRONTEND_IMAGE}@${FRONTEND_DIGEST}"', self.candidate)
        self.assertIn("! -name SHA256SUMS", self.candidate)
        self.assertIn("! -name SHA256SUMS", self.core)

    def test_compliance_is_verified_before_builds_and_preserved_on_promotion(self) -> None:
        validation = self.candidate.split("  backend:", 1)[0]
        self.assertIn("scripts/release_compliance.py collect", validation)
        self.assertIn("inputs.compliance_review", validation)
        self.assertIn("name: verified-compliance-evidence", validation)
        self.assertIn("--name verified-compliance-evidence --dir dist", self.candidate)
        archive_check = self.core.index("test -s dist/compliance-evidence.tar.gz")
        self.assertLess(archive_check, self.core.index("name: Promote image manifests"))

    def test_staging_and_exception_promotions_are_separate(self) -> None:
        core_call = "uses: ./.github/workflows/promote-release-core.yml"
        self.assertIn(core_call, self.staging)
        self.assertIn("validation_mode: staging", self.staging)
        self.assertNotIn("production-exception", self.staging)
        self.assertIn(core_call, self.exception)
        self.assertIn("validation_mode: production-exception", self.exception)
        self.assertIn("environment: production", self.core)

    def test_production_exception_requires_a_completed_issue_record(self) -> None:
        marker = "<!-- content-pool-production-release-exception -->"
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
