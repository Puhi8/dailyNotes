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

if grep -q '"androidVersionCode"' "$PACKAGE_JSON"; then
  perl -0pi -e 's/"androidVersionCode":\s*[0-9]+/"androidVersionCode": '"$version_code"'/g' "$PACKAGE_JSON"
else
  perl -0pi -e 's/("version":\s*"[^"]+",)/$1\n  "androidVersionCode": '"$version_code"',/' "$PACKAGE_JSON"
fi

if [[ -f "$FDROID_METADATA" ]]; then
  perl -0pi -e "s/^    versionName: .*/    versionName: '$version_name'/mg" "$FDROID_METADATA"
  perl -0pi -e "s/^    versionCode: .*/    versionCode: $version_code/mg" "$FDROID_METADATA"
  perl -0pi -e "s/^    commit: .*/    commit: v$version_name/mg" "$FDROID_METADATA"
  perl -0pi -e "s/^CurrentVersion: .*/CurrentVersion: '$version_name'/mg" "$FDROID_METADATA"
  perl -0pi -e "s/^CurrentVersionCode: .*/CurrentVersionCode: $version_code/mg" "$FDROID_METADATA"
fi

echo "Set frontend package version to $version_name"
echo "Derived Android versionCode: $version_code"
echo "Release tag to use: v$version_name"
