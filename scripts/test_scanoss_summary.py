#!/usr/bin/env python3

import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "scanoss_summary", Path(__file__).with_name("summarize-scanoss.py")
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ScanossSummaryTest(unittest.TestCase):
    def test_counts_files_not_multiple_matches(self):
        report = {
            "a.ts": [{"id": "snippet"}, {"id": "file"}],
            "b.ts": [{"id": "none"}],
        }
        summary = module.summarize(report)
        self.assertIn("Files in the response: 2", summary)
        self.assertIn("Files with matches requiring review: 1", summary)

    def test_no_match_is_not_legal_clearance(self):
        summary = module.summarize({"a.ts": [{"id": "none"}]})
        self.assertIn("Files with matches requiring review: 0", summary)
        self.assertIn("not legal approval", summary)

    def test_empty_error_and_unknown_responses_fail_closed(self):
        for report in ({}, [], {"a.ts": []}, {"error": "unavailable"},
                       {"a.ts": [{"id": "error"}]}, {"a.ts": [None]}):
            with self.subTest(report=report), self.assertRaises(ValueError):
                module.summarize(report)


if __name__ == "__main__":
    unittest.main()
