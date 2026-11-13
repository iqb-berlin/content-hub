#!/usr/bin/env python3

import importlib.util
import sys
import unittest
from pathlib import Path


spec = importlib.util.spec_from_file_location(
    "dependency_license_policy",
    Path(__file__).with_name("check-dependency-licenses.py"),
)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


def component(purl: str, expression: str | None = None) -> dict:
    value = {
        "name": purl.rsplit("/", 1)[-1].split("@", 1)[0],
        "version": purl.rsplit("@", 1)[-1],
        "purl": purl,
    }
    if expression is not None:
        value["licenses"] = [{"expression": expression}]
    return value


class DependencyLicensePolicyTest(unittest.TestCase):
    def setUp(self) -> None:
        self.policy = {
            "allowed_licenses": ["Apache-2.0", "MIT", "Zlib"],
            "license_aliases": {"Apache License 2.0": "Apache-2.0"},
            "component_license_overrides": {},
            "reviewed_exceptions": {},
        }

    def check(self, *components: dict, require_all_rules_used: bool = False):
        return module.check_sboms(
            self.policy,
            [{"components": list(components)}],
            require_all_rules_used=require_all_rules_used,
        )

    def test_accepts_allowed_alias_and_combined_expressions(self) -> None:
        result = self.check(
            component("pkg:npm/a@1.0.0", "Apache License 2.0"),
            component("pkg:npm/b@1.0.0", "(GPL-3.0-only OR MIT)"),
            component("pkg:npm/c@1.0.0", "MIT AND Zlib"),
        )
        self.assertEqual(result.checked_components, 3)

    def test_rejects_disallowed_or_missing_license(self) -> None:
        for candidate in (
            component("pkg:npm/a@1.0.0", "GPL-3.0-only"),
            component("pkg:npm/a@1.0.0"),
        ):
            with self.subTest(candidate=candidate), self.assertRaises(module.PolicyError):
                self.check(candidate)

    def test_flat_license_list_does_not_imply_a_choice(self) -> None:
        candidate = component("pkg:npm/mixed@1.0.0")
        candidate["licenses"] = [
            {"license": {"id": "MIT"}},
            {"license": {"id": "GPL-3.0-only"}},
        ]
        with self.assertRaises(module.PolicyError):
            self.check(candidate)
        candidate["licenses"][1] = {"license": {"id": "Zlib"}}
        self.assertEqual(self.check(candidate).checked_components, 1)

    def test_allowed_entry_does_not_hide_malformed_expression(self) -> None:
        candidate = component("pkg:npm/mixed@1.0.0", "MIT")
        candidate["licenses"].append({"expression": "GPL-3.0-only OR ()"})
        with self.assertRaises(module.PolicyError):
            self.check(candidate)

    def test_rejects_malformed_license_expression(self) -> None:
        with self.assertRaises(module.PolicyError):
            self.check(component("pkg:npm/a@1.0.0", "MIT OR ()"))

    def test_rejects_empty_sbom_and_invalid_allowed_license_shape(self) -> None:
        with self.assertRaises(module.PolicyError):
            self.check()
        self.policy["allowed_licenses"] = "MIT"
        with self.assertRaises(module.PolicyError):
            self.check(component("pkg:npm/a@1.0.0", "MIT"))

    def test_rejects_one_empty_sbom_among_nonempty_sboms(self) -> None:
        with self.assertRaises(module.PolicyError):
            module.check_sboms(
                self.policy,
                [
                    {"components": []},
                    {"components": [component("pkg:npm/a@1.0.0", "MIT")]},
                ],
                require_all_rules_used=False,
            )

    def test_exact_version_override_is_reviewed_and_required(self) -> None:
        purl = "pkg:npm/legacy@1.0.0"
        self.policy["component_license_overrides"][purl] = {
            "expression": "MIT",
            "source": "https://registry.example/legacy/1.0.0",
        }
        result = self.check(component(purl), require_all_rules_used=True)
        self.assertEqual(result.used_overrides, frozenset({purl}))
        with self.assertRaises(module.PolicyError):
            self.check(component("pkg:npm/legacy@1.0.1"), require_all_rules_used=True)

    def test_exact_reviewed_exception_does_not_hide_new_versions(self) -> None:
        purl = "pkg:npm/unlicensed@1.0.0"
        self.policy["reviewed_exceptions"][purl] = {
            "expected_licenses": [],
            "reason": "reviewed current risk",
        }
        result = self.check(component(purl), require_all_rules_used=True)
        self.assertEqual(result.used_exceptions, frozenset({purl}))
        with self.assertRaises(module.PolicyError):
            self.check(component("pkg:npm/unlicensed@1.0.1"), require_all_rules_used=True)
        with self.assertRaises(module.PolicyError):
            self.check(component(purl, "GPL-3.0-only"), require_all_rules_used=True)

    def test_override_cannot_hide_newly_reported_license(self) -> None:
        purl = "pkg:npm/legacy@1.0.0"
        self.policy["component_license_overrides"][purl] = {
            "expression": "MIT",
            "source": "https://registry.example/legacy/1.0.0",
        }
        with self.assertRaises(module.PolicyError):
            self.check(component(purl, "GPL-3.0-only"), require_all_rules_used=True)


if __name__ == "__main__":
    unittest.main()
