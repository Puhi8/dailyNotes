#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="${ANDROID_DIR:-$ROOT_DIR/android}"
ANDROID_JAVA_HOME="${ANDROID_JAVA_HOME:-}"
ANDROID_SDK_HOME="${ANDROID_SDK_HOME:-}"
ANDROID_GRADLE_USER_HOME="${ANDROID_GRADLE_USER_HOME:-/tmp/dailynotes-gradle}"
ANDROID_UNSIGNED_APK_PATH="${ANDROID_UNSIGNED_APK_PATH:-$ANDROID_DIR/app/build/outputs/apk/release/app-release-unsigned.apk}"
ANDROID_VERSION_HELPER="${ANDROID_VERSION_HELPER:-$ROOT_DIR/scripts/android-version.sh}"
PREPARE_ANDROID_PROJECT="${PREPARE_ANDROID_PROJECT:-$ROOT_DIR/scripts/prepare-android-project.sh}"

die() {
  echo "$*" >&2
  exit 1
}

java_major_version() {
  local java_home="$1"
  local version

  version="$("$java_home/bin/javac" -version 2>&1 | awk '/^javac / { print $2; exit }')"
  version="${version%\"}"
  version="${version#\"}"

  if [[ "$version" =~ ^1\.([0-9]+) ]] || [[ "$version" =~ ^([0-9]+) ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi

  return 1
}

resolve_android_java_home() {
  local candidate major
  local -a candidates=()

  [[ -n "$ANDROID_JAVA_HOME" ]] && candidates+=("$ANDROID_JAVA_HOME")
  [[ -n "${JAVA_HOME:-}" ]] && candidates+=("$JAVA_HOME")
  candidates+=("$HOME/.android-studio/jbr")

  shopt -s nullglob
  for candidate in /usr/lib/jvm/*; do
    candidates+=("$candidate")
  done
  shopt -u nullglob

  for candidate in "${candidates[@]}"; do
    [[ -x "$candidate/bin/java" && -x "$candidate/bin/javac" ]] || continue
    major="$(java_major_version "$candidate")" || continue
    (( major >= 21 )) && {
      printf '%s\n' "$candidate"
      return 0
    }
  done

  die "No usable JDK 21+ found. Set ANDROID_JAVA_HOME or JAVA_HOME."
}

resolve_android_sdk_home() {
  local candidate
  local -a candidates=()

  [[ -n "$ANDROID_SDK_HOME" ]] && candidates+=("$ANDROID_SDK_HOME")
  [[ -n "${ANDROID_HOME:-}" ]] && candidates+=("$ANDROID_HOME")
  [[ -n "${ANDROID_SDK_ROOT:-}" ]] && candidates+=("$ANDROID_SDK_ROOT")

  candidates+=(
    "$HOME/Android/Sdk"
    "$HOME/Android/sdk"
    "$HOME/Library/Android/sdk"
    "$HOME/AppData/Local/Android/Sdk"
    "$HOME/.android/sdk"
  )

  for candidate in "${candidates[@]}"; do
    [[ -d "$candidate/platforms" && -d "$candidate/build-tools" ]] && {
      printf '%s\n' "$candidate"
      return 0
    }
  done

  die "No usable Android SDK found. Set ANDROID_SDK_HOME, ANDROID_HOME, or ANDROID_SDK_ROOT."
}

write_android_local_properties() {
  local sdk_home="$1"
  local escaped_sdk_home

  escaped_sdk_home="${sdk_home//\\/\\\\}"
  escaped_sdk_home="${escaped_sdk_home//:/\\:}"
  printf 'sdk.dir=%s\n' "$escaped_sdk_home" > "$ANDROID_DIR/local.properties"
}

[[ -x "$ANDROID_VERSION_HELPER" ]] || die "Android version helper not executable: $ANDROID_VERSION_HELPER"

JAVA_HOME="$(resolve_android_java_home)"
ANDROID_SDK_HOME="$(resolve_android_sdk_home)"
ANDROID_VERSION_NAME="$("$ANDROID_VERSION_HELPER" print-name "${ANDROID_VERSION_NAME:-}")"
ANDROID_VERSION_CODE="${ANDROID_VERSION_CODE:-$("$ANDROID_VERSION_HELPER" print-code "$ANDROID_VERSION_NAME")}"

export JAVA_HOME
export ANDROID_HOME="$ANDROID_SDK_HOME"
export ANDROID_SDK_ROOT="$ANDROID_SDK_HOME"
export GRADLE_USER_HOME="$ANDROID_GRADLE_USER_HOME"
export ANDROID_VERSION_NAME
export ANDROID_VERSION_CODE
export PATH="$JAVA_HOME/bin:$ANDROID_SDK_HOME/platform-tools:$PATH"

[[ -d "$ANDROID_SDK_HOME/build-tools" ]] || die "No usable Android SDK found. Set ANDROID_SDK_HOME, ANDROID_HOME, or ANDROID_SDK_ROOT."
[[ -x "$PREPARE_ANDROID_PROJECT" ]] || die "Android prepare script not executable: $PREPARE_ANDROID_PROJECT"
mkdir -p "$GRADLE_USER_HOME"

echo "Building unsigned Android APK version $ANDROID_VERSION_NAME ($ANDROID_VERSION_CODE)..."

"$PREPARE_ANDROID_PROJECT"

[[ -f "$ANDROID_DIR/gradlew" ]] || die "No Gradle wrapper found at $ANDROID_DIR/gradlew"
write_android_local_properties "$ANDROID_SDK_HOME"

(
  cd "$ANDROID_DIR"
  chmod +x gradlew
  ./gradlew --no-daemon assembleRelease
)

[[ -f "$ANDROID_UNSIGNED_APK_PATH" ]] || die "Unsigned APK not found: $ANDROID_UNSIGNED_APK_PATH"

echo "Built unsigned APK for F-Droid: $ANDROID_UNSIGNED_APK_PATH"
