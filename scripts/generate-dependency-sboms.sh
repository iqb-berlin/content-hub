#!/usr/bin/env bash
set -euo pipefail

output_dir="${1:-dist/compliance}"
mkdir -p "$output_dir"
output_dir="$(cd "$output_dir" && pwd)"

npx --yes @cyclonedx/cyclonedx-npm@6.0.0 \
  --package-lock-only --omit dev --output-reproducible \
  --output-file "$output_dir/backend-runtime.cdx.json" \
  backend/package.json
npx --yes @cyclonedx/cyclonedx-npm@6.0.0 \
  --package-lock-only --omit dev --output-reproducible \
  --output-file "$output_dir/frontend-runtime.cdx.json" \
  frontend/package.json
mvn --batch-mode --no-transfer-progress \
  -f keycloak/extensions/altcha/pom.xml \
  org.cyclonedx:cyclonedx-maven-plugin:2.9.3:makeBom \
  -DoutputFormat=json \
  -DoutputDirectory="$output_dir" \
  -DoutputName=keycloak-altcha-runtime \
  -DincludeTestScope=false \
  -DincludeProvidedScope=false
# Keep the platform/provided dependencies visible for human review, separately
# from the libraries actually shipped in the shaded provider JAR.
mvn --batch-mode --no-transfer-progress \
  -f keycloak/extensions/altcha/pom.xml \
  org.cyclonedx:cyclonedx-maven-plugin:2.9.3:makeBom \
  -DoutputFormat=json \
  -DoutputDirectory="$output_dir" \
  -DoutputName=keycloak-altcha-platform \
  -DincludeTestScope=false \
  -DincludeProvidedScope=true
