#!/usr/bin/env python3

import argparse
import json
import re
import sys
from typing import Any


MARKER = "<!-- content-hub-production-release-exception -->"
PRECONDITIONS_HEADING = "## Required production preconditions"


class ProductionExceptionError(ValueError):
    pass


def validate_issue(repository: str, issue_url: str, issue: dict[str, Any]) -> int:
    prefix = f"https://github.com/{repository}/issues/"
    if repository == "iqb-berlin/content-hub":
        issue_url = issue_url.replace("https://github.com/iqb-berlin/content-pool-next/issues/", prefix, 1)
    if not issue_url.startswith(prefix):
        raise ProductionExceptionError(
            f"production exception evidence must be an issue in {repository}"
        )
    raw_number = issue_url.removeprefix(prefix)
    if not re.fullmatch(r"[1-9][0-9]*", raw_number):
        raise ProductionExceptionError("production exception issue URL is invalid")
    if issue.get("state") != "OPEN":
        raise ProductionExceptionError("production exception issue must remain open")
    body = issue.get("body")
    if not isinstance(body, str) or not any(marker in body for marker in (MARKER, "<!-- content-pool-production-release-exception -->")):
        raise ProductionExceptionError(
            "issue is not a production release exception record"
        )
    if PRECONDITIONS_HEADING not in body:
        raise ProductionExceptionError(
            "production exception preconditions section is missing"
        )
    preconditions = body.split(PRECONDITIONS_HEADING, 1)[1].split("\n## ", 1)[0]
    if not re.search(r"^- \[[xX]\] ", preconditions, flags=re.MULTILINE):
        raise ProductionExceptionError(
            "production exception preconditions contain no completed checks"
        )
    if re.search(r"^- \[ \] ", preconditions, flags=re.MULTILINE):
        raise ProductionExceptionError("production exception preconditions are incomplete")
    return int(raw_number)


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    validate = subparsers.add_parser("validate")
    validate.add_argument("--repository", required=True)
    validate.add_argument("--issue-url", required=True)
    args = parser.parse_args()
    try:
        issue = json.load(sys.stdin)
        number = validate_issue(args.repository, args.issue_url, issue)
    except (json.JSONDecodeError, ProductionExceptionError) as error:
        print(error, file=sys.stderr)
        return 1
    print(f"Production exception issue {number} is complete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
