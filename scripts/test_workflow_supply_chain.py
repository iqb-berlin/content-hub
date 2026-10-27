#!/usr/bin/env python3

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"
IMMUTABLE_ACTION = re.compile(r"^[^\s#]+@[0-9a-f]{40}(?:\s+#\s+\S+)?$")


class WorkflowSupplyChainTest(unittest.TestCase):
    def test_external_actions_use_full_commit_shas(self) -> None:
        mutable: list[str] = []
        workflows = sorted((*WORKFLOWS.glob("*.yml"), *WORKFLOWS.glob("*.yaml")))
        for workflow in workflows:
            for number, line in enumerate(workflow.read_text().splitlines(), 1):
                match = re.match(r"\s*(?:-\s*)?uses:\s*(.+)$", line)
                if not match or match.group(1).startswith("./"):
                    continue
                if not IMMUTABLE_ACTION.fullmatch(match.group(1)):
                    mutable.append(f"{workflow.relative_to(ROOT)}:{number}: {line.strip()}")
        self.assertEqual(mutable, [], "mutable external Actions refs:\n" + "\n".join(mutable))

    def test_dependabot_covers_repository_dependency_ecosystems(self) -> None:
        config = (ROOT / ".github" / "dependabot.yml").read_text()
        entries = re.findall(
            r"^\s*- package-ecosystem: (\S+)\n\s+directory: (\S+)$",
            config,
            re.MULTILINE,
        )
        expected = [
            ("npm", "/backend"),
            ("npm", "/frontend"),
            ("maven", "/keycloak/extensions/altcha"),
            ("pip", "/compliance"),
            ("github-actions", "/"),
            ("docker-compose", "/"),
            ("docker", "/backend"),
            ("docker", "/frontend"),
            ("docker", "/nginx"),
        ]
        self.assertCountEqual(entries, expected)

    def test_dependency_license_policy_is_part_of_release_gate(self) -> None:
        ci = (WORKFLOWS / "ci.yml").read_text()
        security_job = ci.split("  security:", 1)[1].split("  release-gate:", 1)[0]
        release_gate = ci.split("  release-gate:", 1)[1]
        self.assertIn("scripts/generate-dependency-sboms.sh", security_job)
        self.assertIn("scripts/check-dependency-licenses.py", security_job)
        self.assertIn("      - security", release_gate)


if __name__ == "__main__":
    unittest.main()
