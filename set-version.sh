#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_VERSION_HELPER="$ROOT_DIR/frontend/scripts/android-version.sh"
PACKAGE_JSON="$ROOT_DIR/frontend/package.json"
FDROID_METADATA="$ROOT_DIR/.fdroid.yml"

version_name="${1:-}"
version_name="${version_name#v}"

if [[ -z "$version_name" ]]; then
  echo "Usage: $0 <version>" >&2
  exit 1
fi

if [[ ! "$version_name" =~ ^[0-9]+(\.[0-9]+){0,3}([-+][0-9A-Za-z.-]+)?$ ]]; then
  echo "Unsupported version format: ${1:-}" >&2
  exit 1
fi

perl -0pi -e 's/"version":\s*"[^"]+"/"version": "'"$version_name"'"/' "$PACKAGE_JSON"

version_code="$("$ANDROID_VERSION_HELPER" print-code "$version_name")"

if [[ -f "$FDROID_METADATA" ]]; then
  export VERSION_NAME="$version_name"
  export VERSION_CODE="$version_code"
  export VERSION_TAG="v$version_name"
  perl -0pi -e 's/^    versionName: .*/    versionName: '\''$ENV{VERSION_NAME}'\''/mg' "$FDROID_METADATA"
  perl -0pi -e 's/^    versionCode: .*/    versionCode: $ENV{VERSION_CODE}/mg' "$FDROID_METADATA"
  perl -0pi -e 's/^    commit: .*/    commit: $ENV{VERSION_TAG}/mg' "$FDROID_METADATA"
  perl -0pi -e 's/^CurrentVersion: .*/CurrentVersion: '\''$ENV{VERSION_NAME}'\''/mg' "$FDROID_METADATA"
  perl -0pi -e 's/^CurrentVersionCode: .*/CurrentVersionCode: $ENV{VERSION_CODE}/mg' "$FDROID_METADATA"
fi

echo "Set frontend package version to $version_name"
echo "Derived Android versionCode: $version_code"
echo "Release tag to use: v$version_name"
