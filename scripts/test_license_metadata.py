#!/usr/bin/env python3
"""Check that missing theme notices cannot pass the release metadata check."""

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
THEME = Path("keycloak/themes/iqb-theme")


class ThemeLicenseMetadataTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        files = ["LICENSE", "scripts/check-license-metadata.py"]
        for project in ("backend", "frontend"):
            files.extend(f"{project}/{name}" for name in
                         ("LICENSE", "package.json", "package-lock.json"))
        files.extend(str(p.relative_to(ROOT)) for p in
                     (ROOT / "keycloak/extensions/altcha/licenses").iterdir())
        files.append("keycloak/extensions/altcha/pom.xml")
        files.extend(str(THEME / name) for name in
                     ("LICENSE.txt", "NOTICE.md", "login/login.ftl", "login/template.ftl"))
        for name in files:
            destination = self.root / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, destination)

    def check(self):
        return subprocess.run(
            [sys.executable, str(self.root / "scripts/check-license-metadata.py")],
            text=True, capture_output=True, check=False,
        )

    def test_complete_notices_pass(self):
        result = self.check()
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_changed_theme_license_is_rejected(self):
        (self.root / THEME / "LICENSE.txt").write_text("incomplete license\n")
        self.assertNotEqual(self.check().returncode, 0)

    def test_missing_provenance_notice_is_rejected(self):
        (self.root / THEME / "NOTICE.md").unlink()
        self.assertNotEqual(self.check().returncode, 0)

    def test_either_missing_template_modification_notice_is_rejected(self):
        for name in ("login.ftl", "template.ftl"):
            file = self.root / THEME / "login" / name
            original = file.read_text()
            with self.subTest(template=name):
                file.write_text(original.partition("-->")[2])
                self.assertNotEqual(self.check().returncode, 0)
                file.write_text(original)


if __name__ == "__main__":
    unittest.main()
