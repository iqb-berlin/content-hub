#!/usr/bin/env python3
"""ScanCode entry point for the runner's materialized tracked-file snapshot only.

ScanCode 32.5.0 always omits VCS configuration such as .gitignore during
inventory, even with --include. This snapshot has no Git metadata or symlinks;
clear that inventory exclusion so all tracked bytes reach the normal scanners.
The caller validates complete file coverage and content hashes afterward.
"""

from commoncode import ignore
from scancode.cli import scancode


if __name__ == "__main__":
    ignore.ignores_VCS.clear()
    scancode()
