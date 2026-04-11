#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$FRONTEND_DIR/.." && pwd)"
PACKAGE_JSON_PATH="${PACKAGE_JSON_PATH:-$FRONTEND_DIR/package.json}"

die() {
  echo "$*" >&2
  exit 1
}

sanitize_version_name() {
  local raw="${1:-}"
  local version_name

  version_name="${raw#refs/tags/}"
  version_name="${version_name#v}"
  version_name="${version_name%%[[:space:]]*}"

  [[ -n "$version_name" ]] || die "Android version name is empty."
  printf '%s\n' "$version_name"
}

read_package_version() {
  [[ -f "$PACKAGE_JSON_PATH" ]] || return 1
  awk -F'"' '/"version"[[:space:]]*:/ { print $4; exit }' "$PACKAGE_JSON_PATH"
}

read_git_tag_version() {
  git -C "$REPO_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 1
  git -C "$REPO_DIR" tag --points-at HEAD | sort -V | tail -n 1
}

resolve_version_name() {
  local candidate="${1:-}"

  if [[ -n "$candidate" ]]; then
    sanitize_version_name "$candidate"
    return 0
  fi

  if [[ -n "${ANDROID_VERSION_NAME:-}" ]]; then
    sanitize_version_name "$ANDROID_VERSION_NAME"
    return 0
  fi

  candidate="$(read_git_tag_version || true)"
  if [[ -n "$candidate" ]]; then
    sanitize_version_name "$candidate"
    return 0
  fi

  candidate="$(read_package_version || true)"
  if [[ -n "$candidate" ]]; then
    sanitize_version_name "$candidate"
    return 0
  fi

  die "Could not resolve Android version name from input, git tags, or package.json."
}

version_code_from_name() {
  local version_name="$1"
  local numeric_part
  local -a parts=()
  local idx
  local major minor patch build

  numeric_part="${version_name%%[-+]*}"
  IFS='.' read -r -a parts <<< "$numeric_part"
  (( ${#parts[@]} >= 1 && ${#parts[@]} <= 4 )) || die "Android version '$version_name' must have 1 to 4 numeric parts."

  for idx in "${!parts[@]}"; do
    [[ "${parts[$idx]}" =~ ^[0-9]+$ ]] || die "Android version '$version_name' contains a non-numeric part: ${parts[$idx]}"
  done

  while (( ${#parts[@]} < 4 )); do
    parts+=(0)
  done

  major="${parts[0]}"
  minor="${parts[1]}"
  patch="${parts[2]}"
  build="${parts[3]}"

  (( minor <= 99 )) || die "Android version '$version_name' has minor > 99."
  (( patch <= 99 )) || die "Android version '$version_name' has patch > 99."
  (( build <= 99 )) || die "Android version '$version_name' has build > 99."

  printf '%s\n' "$(( major * 1000000 + minor * 10000 + patch * 100 + build ))"
}

usage() {
  cat <<'EOF'
Usage:
  android-version.sh print-name [raw-version]
  android-version.sh print-code [version-name]
  android-version.sh print-both [raw-version]
EOF
}

command_name="${1:-}"

case "$command_name" in
  print-name)
    resolve_version_name "${2:-}"
    ;;
  print-code)
    version_name="$(resolve_version_name "${2:-}")"
    version_code_from_name "$version_name"
    ;;
  print-both)
    version_name="$(resolve_version_name "${2:-}")"
    printf 'ANDROID_VERSION_NAME=%s\n' "$version_name"
    printf 'ANDROID_VERSION_CODE=%s\n' "$(version_code_from_name "$version_name")"
    ;;
  *)
    usage
    exit 1
    ;;
esac
