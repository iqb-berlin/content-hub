#!/usr/bin/env python3
"""Validate a SCANOSS JSON report and summarize matches without legal verdicts."""

import json
import sys
from pathlib import Path


def summarize(report):
    if not isinstance(report, dict) or not report:
        raise ValueError("SCANOSS returned an empty or invalid report")
    matches = 0
    for findings in report.values():
        if not isinstance(findings, list) or not findings:
            raise ValueError("SCANOSS returned invalid file findings")
        for finding in findings:
            if not isinstance(finding, dict) or finding.get("id") not in (
                "none", "file", "snippet"
            ):
                raise ValueError("SCANOSS returned an unexpected finding; inspect the raw report")
        matches += any(finding["id"] != "none" for finding in findings)
    return (
        "# SCANOSS external code matches\n\n"
        f"Files in the response: {len(report)}\n\n"
        f"Files with matches requiring review: {matches}\n\n"
        "Download the scanoss-code-provenance artifact for source URLs, license "
        "metadata and the scanned revision. Review each match before merging: "
        "check the source, applicable license and any attribution obligations. "
        "Matches are not proof of infringement; no matches are not proof of "
        "rights clearance. A successful job means the scan completed, not legal approval.\n"
    )


if __name__ == "__main__":
    print(summarize(json.loads(Path(sys.argv[1]).read_text())), end="")
