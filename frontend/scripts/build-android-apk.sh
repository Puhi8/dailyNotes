#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="${ANDROID_DIR:-$ROOT_DIR/android}"
ANDROID_JAVA_HOME="${ANDROID_JAVA_HOME:-}"
ANDROID_SDK_HOME="${ANDROID_SDK_HOME:-}"
ANDROID_APKSIGNER="${ANDROID_APKSIGNER:-}"

ANDROID_UNSIGNED_APK_PATH="${ANDROID_UNSIGNED_APK_PATH:-$ANDROID_DIR/app/build/outputs/apk/release/app-release-unsigned.apk}"
ANDROID_SIGNED_APK_PATH="${ANDROID_SIGNED_APK_PATH:-$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk}"
ANDROID_KEYSTORE_PATH="${ANDROID_KEYSTORE_PATH:-$HOME/.android/debug.keystore}"
ANDROID_KEYSTORE_PASS="${ANDROID_KEYSTORE_PASS:-android}"
ANDROID_KEY_ALIAS="${ANDROID_KEY_ALIAS:-androiddebugkey}"
ANDROID_KEY_PASS="${ANDROID_KEY_PASS:-android}"

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

resolve_apksigner() {
  local apksigner

  if [[ -n "$ANDROID_APKSIGNER" ]]; then
    [[ -x "$ANDROID_APKSIGNER" ]] || die "Android apksigner not executable: $ANDROID_APKSIGNER"
    printf '%s\n' "$ANDROID_APKSIGNER"
    return 0
  fi

  apksigner="$(find "$ANDROID_SDK_HOME/build-tools" -maxdepth 2 -name apksigner 2>/dev/null | sort | tail -n 1)"
  [[ -n "$apksigner" ]] || die "Could not find apksigner under $ANDROID_SDK_HOME/build-tools"
  printf '%s\n' "$apksigner"
}

JAVA_HOME="$(resolve_android_java_home)"
ANDROID_SDK_HOME="$(resolve_android_sdk_home)"
export JAVA_HOME
export ANDROID_HOME="$ANDROID_SDK_HOME"
export ANDROID_SDK_ROOT="$ANDROID_SDK_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_SDK_HOME/platform-tools:$PATH"

[[ -f "$ANDROID_DIR/gradlew" ]] || die "No Gradle wrapper found at $ANDROID_DIR/gradlew"
[[ -d "$ANDROID_SDK_HOME/build-tools" ]] || die "No usable Android SDK found. Set ANDROID_SDK_HOME, ANDROID_HOME, or ANDROID_SDK_ROOT."
[[ -f "$ANDROID_KEYSTORE_PATH" ]] || die "Android keystore not found: $ANDROID_KEYSTORE_PATH"
write_android_local_properties "$ANDROID_SDK_HOME"

apksigner="$(resolve_apksigner)"

(
  cd "$ANDROID_DIR"
  chmod +x gradlew
  ./gradlew assembleRelease
)

[[ -f "$ANDROID_UNSIGNED_APK_PATH" ]] || die "APK not found: $ANDROID_UNSIGNED_APK_PATH"

rm -f "$ANDROID_SIGNED_APK_PATH"
"$apksigner" sign \
  --ks "$ANDROID_KEYSTORE_PATH" \
  --ks-key-alias "$ANDROID_KEY_ALIAS" \
  --ks-pass "pass:$ANDROID_KEYSTORE_PASS" \
  --key-pass "pass:$ANDROID_KEY_PASS" \
  --out "$ANDROID_SIGNED_APK_PATH" \
  "$ANDROID_UNSIGNED_APK_PATH"

"$apksigner" verify "$ANDROID_SIGNED_APK_PATH" >/dev/null || die "Signed APK verification failed"

echo "Built installable APK: $ANDROID_SIGNED_APK_PATH"
