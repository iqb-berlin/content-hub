#!/usr/bin/env python3
"""Fail when a CycloneDX dependency SBOM violates the reviewed license policy."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class PolicyError(ValueError):
    """Raised when policy or SBOM input is invalid or non-compliant."""


@dataclass(frozen=True)
class CheckResult:
    checked_components: int
    used_overrides: frozenset[str]
    used_exceptions: frozenset[str]


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise PolicyError(f"cannot read {path}: {error}") from error
    if not isinstance(value, dict):
        raise PolicyError(f"{path} must contain a JSON object")
    return value


def strip_outer_parentheses(expression: str) -> str:
    expression = expression.strip()
    while expression.startswith("(") and expression.endswith(")"):
        depth = 0
        encloses_all = True
        for index, character in enumerate(expression):
            if character == "(":
                depth += 1
            elif character == ")":
                depth -= 1
                if depth < 0:
                    raise PolicyError(f"unbalanced license expression: {expression}")
                if depth == 0 and index != len(expression) - 1:
                    encloses_all = False
                    break
        if depth != 0:
            raise PolicyError(f"unbalanced license expression: {expression}")
        if not encloses_all:
            break
        expression = expression[1:-1].strip()
    return expression


def split_top_level(expression: str, operator: str) -> list[str]:
    delimiter = f" {operator} "
    parts: list[str] = []
    depth = 0
    start = 0
    index = 0
    while index < len(expression):
        character = expression[index]
        if character == "(":
            depth += 1
        elif character == ")":
            depth -= 1
            if depth < 0:
                raise PolicyError(f"unbalanced license expression: {expression}")
        elif depth == 0 and expression.startswith(delimiter, index):
            parts.append(expression[start:index].strip())
            index += len(delimiter)
            start = index
            continue
        index += 1
    if depth != 0:
        raise PolicyError(f"unbalanced license expression: {expression}")
    if parts:
        parts.append(expression[start:].strip())
    return parts


def expression_is_allowed(
    expression: str, allowed: set[str], aliases: dict[str, str]
) -> bool:
    expression = strip_outer_parentheses(aliases.get(expression.strip(), expression))
    if not expression:
        raise PolicyError("empty term in license expression")
    alternatives = split_top_level(expression, "OR")
    if alternatives:
        decisions = [expression_is_allowed(part, allowed, aliases) for part in alternatives]
        return any(decisions)
    requirements = split_top_level(expression, "AND")
    if requirements:
        decisions = [expression_is_allowed(part, allowed, aliases) for part in requirements]
        return all(decisions)
    return aliases.get(expression, expression) in allowed


def component_licenses(component: dict[str, Any]) -> list[str]:
    expressions: list[str] = []
    licenses = component.get("licenses", [])
    if not isinstance(licenses, list):
        raise PolicyError("component licenses must be a list")
    for choice in licenses:
        if not isinstance(choice, dict):
            raise PolicyError("component license choice must be an object")
        expression = choice.get("expression")
        if isinstance(expression, str) and expression.strip():
            expressions.append(expression.strip())
            continue
        license_data = choice.get("license")
        if not isinstance(license_data, dict):
            continue
        identifier = license_data.get("id") or license_data.get("name")
        if isinstance(identifier, str) and identifier.strip():
            expressions.append(identifier.strip())
    return expressions


def check_sboms(
    policy: dict[str, Any], sboms: list[dict[str, Any]], require_all_rules_used: bool
) -> CheckResult:
    allowed_values = policy.get("allowed_licenses", [])
    allowed = set(allowed_values) if isinstance(allowed_values, list) else set()
    aliases = policy.get("license_aliases", {})
    overrides = policy.get("component_license_overrides", {})
    exceptions = policy.get("reviewed_exceptions", {})
    if not allowed or not all(isinstance(value, str) for value in allowed_values):
        raise PolicyError("allowed_licenses must be a non-empty string list")
    if not isinstance(aliases, dict) or not all(
        isinstance(key, str) and isinstance(value, str)
        for key, value in aliases.items()
    ):
        raise PolicyError("license_aliases must map strings to strings")
    if not isinstance(overrides, dict) or not isinstance(exceptions, dict):
        raise PolicyError("component overrides and exceptions must be objects")

    failures: list[str] = []
    used_overrides: set[str] = set()
    used_exceptions: set[str] = set()
    checked = 0

    for sbom_index, sbom in enumerate(sboms, 1):
        components = sbom.get("components")
        if not isinstance(components, list):
            raise PolicyError("each SBOM must contain a components list")
        if not components:
            failures.append(f"SBOM {sbom_index} contains no dependency components")
            continue
        for component in components:
            if not isinstance(component, dict):
                raise PolicyError("each SBOM component must be an object")
            checked += 1
            purl = component.get("purl")
            name = component.get("name", "unnamed component")
            version = component.get("version", "unknown version")
            label = f"{name}@{version}"
            expressions = component_licenses(component)

            if isinstance(purl, str) and purl in overrides and not expressions:
                override = overrides[purl]
                if not isinstance(override, dict) or not isinstance(
                    override.get("expression"), str
                ) or not isinstance(override.get("source"), str):
                    raise PolicyError(
                        f"license override for {purl} needs expression and source"
                    )
                expressions.append(override["expression"])
                used_overrides.add(purl)

            # A flat CycloneDX license list does not establish an OR choice.
            # Explicit SPDX OR expressions are handled inside expression_is_allowed.
            if expressions and all(
                expression_is_allowed(value, allowed, aliases) for value in expressions
            ):
                continue

            if isinstance(purl, str) and purl in exceptions:
                exception = exceptions[purl]
                if not isinstance(exception, dict) or not isinstance(
                    exception.get("reason"), str
                ) or not exception["reason"].strip():
                    raise PolicyError(f"reviewed exception for {purl} needs a reason")
                expected = exception.get("expected_licenses")
                if not isinstance(expected, list) or not all(
                    isinstance(value, str) for value in expected
                ):
                    raise PolicyError(
                        f"reviewed exception for {purl} needs expected_licenses"
                    )
                if sorted(expressions) != sorted(expected):
                    failures.append(
                        f"{label} ({purl}): reviewed exception expected "
                        f"{expected}, observed {expressions}"
                    )
                    continue
                used_exceptions.add(purl)
                continue

            observed = ", ".join(expressions) if expressions else "no license metadata"
            failures.append(f"{label} ({purl or 'no purl'}): {observed}")

    if require_all_rules_used:
        unused_overrides = set(overrides) - used_overrides
        unused_exceptions = set(exceptions) - used_exceptions
        if unused_overrides:
            failures.append(
                "unused license overrides: " + ", ".join(sorted(unused_overrides))
            )
        if unused_exceptions:
            failures.append(
                "unused reviewed exceptions: " + ", ".join(sorted(unused_exceptions))
            )

    if failures:
        raise PolicyError("dependency license policy failed:\n- " + "\n- ".join(failures))

    return CheckResult(checked, frozenset(used_overrides), frozenset(used_exceptions))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--policy", type=Path, required=True)
    parser.add_argument("sboms", type=Path, nargs="+")
    args = parser.parse_args()

    try:
        policy = load_json(args.policy)
        sboms = [load_json(path) for path in args.sboms]
        result = check_sboms(policy, sboms, require_all_rules_used=True)
    except PolicyError as error:
        print(error, file=sys.stderr)
        return 1

    print(
        f"Dependency license policy passed for {result.checked_components} components; "
        f"{len(result.used_overrides)} metadata overrides and "
        f"{len(result.used_exceptions)} reviewed exceptions used"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
