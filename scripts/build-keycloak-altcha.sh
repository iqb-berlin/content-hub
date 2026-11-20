#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
MODULE_POM="${ROOT_DIR}/keycloak/extensions/altcha/pom.xml"
PROVIDERS_DIR="${ROOT_DIR}/keycloak/providers"
TARGET_JAR="${ROOT_DIR}/keycloak/extensions/altcha/target/content-hub-keycloak-altcha.jar"
OUTPUT_JAR="${PROVIDERS_DIR}/content-hub-keycloak-altcha.jar"

mkdir -p "$PROVIDERS_DIR"

if command -v mvn >/dev/null 2>&1; then
  mvn -f "$MODULE_POM" clean package
elif command -v docker >/dev/null 2>&1; then
  docker run --rm \
    -u "$(id -u):$(id -g)" \
    -e MAVEN_CONFIG=/tmp/.m2 \
    -v "${ROOT_DIR}:/workspace" \
    -w /workspace \
    maven:3.9-eclipse-temurin-17 \
    mvn -f keycloak/extensions/altcha/pom.xml clean package
else
  echo "Missing mvn or docker. Install Maven 3.9+ or Docker to build the Keycloak ALTCHA provider." >&2
  exit 1
fi

install -m 0644 "$TARGET_JAR" "$OUTPUT_JAR"
rm -f "${PROVIDERS_DIR}/content-pool-keycloak-altcha.jar"
echo "Built Keycloak ALTCHA provider: ${OUTPUT_JAR}"
