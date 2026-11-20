#!/usr/bin/env python3

import unittest

from production_exception import MARKER, ProductionExceptionError, validate_issue


REPOSITORY = "iqb-berlin/content-hub"
ISSUE_URL = f"https://github.com/{REPOSITORY}/issues/109"


def issue(body: str, state: str = "OPEN") -> dict[str, str]:
    return {"state": state, "body": body}


COMPLETE_BODY = f"""{MARKER}

## Required production preconditions

- [x] Release owner recorded
- [X] Backups validated

## Post-deployment verification

- [ ] Version endpoint checked
"""


class ProductionExceptionTest(unittest.TestCase):
    def test_accepts_complete_open_repository_issue(self) -> None:
        self.assertEqual(validate_issue(REPOSITORY, ISSUE_URL, issue(COMPLETE_BODY)), 109)

    def test_rejects_issue_from_another_repository(self) -> None:
        with self.assertRaisesRegex(ProductionExceptionError, "must be an issue"):
            validate_issue(REPOSITORY, "https://github.com/example/repo/issues/109", issue(COMPLETE_BODY))

    def test_rejects_missing_marker(self) -> None:
        with self.assertRaisesRegex(ProductionExceptionError, "not a production"):
            validate_issue(REPOSITORY, ISSUE_URL, issue(COMPLETE_BODY.replace(MARKER, "")))

    def test_rejects_closed_issue(self) -> None:
        with self.assertRaisesRegex(ProductionExceptionError, "remain open"):
            validate_issue(REPOSITORY, ISSUE_URL, issue(COMPLETE_BODY, state="CLOSED"))

    def test_rejects_incomplete_preconditions(self) -> None:
        body = COMPLETE_BODY.replace("- [X] Backups validated", "- [ ] Backups validated")
        with self.assertRaisesRegex(ProductionExceptionError, "incomplete"):
            validate_issue(REPOSITORY, ISSUE_URL, issue(body))

    def test_ignores_unchecked_post_deployment_checks(self) -> None:
        self.assertEqual(validate_issue(REPOSITORY, ISSUE_URL, issue(COMPLETE_BODY)), 109)


if __name__ == "__main__":
    unittest.main()
