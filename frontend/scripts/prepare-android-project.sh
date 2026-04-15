#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="${ANDROID_DIR:-$ROOT_DIR/android}"
ANDROID_VERSION_HELPER="${ANDROID_VERSION_HELPER:-$ROOT_DIR/scripts/android-version.sh}"
ANDROID_MAIN_ACTIVITY_TEMPLATE="${ANDROID_MAIN_ACTIVITY_TEMPLATE:-$ROOT_DIR/scripts/utils/MainActivity.template.java}"
CAPACITOR_TEMPLATE="${CAPACITOR_TEMPLATE:-$ROOT_DIR/node_modules/@capacitor/cli/assets/android-template.tar.gz}"

die() {
  echo "$*" >&2
  exit 1
}

patch_android_version() {
  local build_gradle="$ANDROID_DIR/app/build.gradle"

  [[ -f "$build_gradle" ]] || die "Android app Gradle file not found: $build_gradle"

  restore_generated_gradle_if_needed "$build_gradle"
  remove_google_services_template "$build_gradle"
  remove_google_services_classpath "$ANDROID_DIR/build.gradle"

  perl -0pi -e 's/^([ \t]*)versionCode[^\n]*/$1 . "versionCode $ENV{ANDROID_VERSION_CODE}"/em' "$build_gradle"
  perl -0pi -e 's/^([ \t]*)versionName[^\n]*/$1 . "versionName \"$ENV{ANDROID_VERSION_NAME}\""/em' "$build_gradle"
}

patch_android_privacy_preview() {
  local app_id package_path main_activity

  app_id="$(read_capacitor_app_id)"
  [[ -n "$app_id" ]] || die "Could not read appId from $ROOT_DIR/capacitor.config.ts"
  package_path="${app_id//.//}"
  main_activity="$ANDROID_DIR/app/src/main/java/$package_path/MainActivity.java"

  [[ -f "$main_activity" ]] || die "Android MainActivity not found: $main_activity"
  [[ -f "$ANDROID_MAIN_ACTIVITY_TEMPLATE" ]] || die "Android MainActivity template not found: $ANDROID_MAIN_ACTIVITY_TEMPLATE"

  CAPACITOR_APP_ID="$app_id" perl -pe 's/__CAPACITOR_APP_ID__/$ENV{CAPACITOR_APP_ID}/g' "$ANDROID_MAIN_ACTIVITY_TEMPLATE" > "$main_activity"
}

read_capacitor_app_id() {
  awk -F"'" '/appId:/ { print $2; exit }' "$ROOT_DIR/capacitor.config.ts"
}

restore_generated_gradle_if_needed() {
  local build_gradle="$1"
  local app_id

  grep -Eq 'JsonSlurper|computeAndroidVersionCode|configuredVersionName' "$build_gradle" || return 0
  [[ -f "$CAPACITOR_TEMPLATE" ]] || die "Capacitor Android template not found: $CAPACITOR_TEMPLATE"

  app_id="$(read_capacitor_app_id)"
  [[ -n "$app_id" ]] || die "Could not read appId from $ROOT_DIR/capacitor.config.ts"
  export CAPACITOR_APP_ID="$app_id"

  tar -xOzf "$CAPACITOR_TEMPLATE" app/build.gradle > "$build_gradle"
  perl -0pi -e 's/namespace = "[^"]+"/namespace = "$ENV{CAPACITOR_APP_ID}"/' "$build_gradle"
  perl -0pi -e 's/applicationId "[^"]+"/applicationId "$ENV{CAPACITOR_APP_ID}"/' "$build_gradle"
}

remove_google_services_template() {
  local build_gradle="$1"

  perl -0pi -e 's/\ntry \{\n\s*def servicesJSON = file\(\x27google-services\.json\x27\)\n\s*if \(servicesJSON\.text\) \{\n\s*apply plugin: \x27com\.google\.gms\.google-services\x27\n\s*\}\n\} catch\(Exception e\) \{\n\s*logger\.info\("google-services\.json not found, google-services plugin not applied\. Push Notifications won\x27t work"\)\n\}\n?/\n/s' "$build_gradle"
}

remove_google_services_classpath() {
  local root_build_gradle="$1"

  [[ -f "$root_build_gradle" ]] || return 0
  perl -0pi -e 's/^[ \t]*classpath \x27com\.google\.gms:google-services:[^\x27]+\x27\n//m' "$root_build_gradle"
}

[[ -x "$ANDROID_VERSION_HELPER" ]] || die "Android version helper not executable: $ANDROID_VERSION_HELPER"

ANDROID_VERSION_NAME="${ANDROID_VERSION_NAME:-$("$ANDROID_VERSION_HELPER" print-name)}"
ANDROID_VERSION_CODE="${ANDROID_VERSION_CODE:-$("$ANDROID_VERSION_HELPER" print-code "$ANDROID_VERSION_NAME")}"
export ANDROID_VERSION_NAME
export ANDROID_VERSION_CODE

(
  cd "$ROOT_DIR"
  if [[ ! -d "$ANDROID_DIR" ]]; then
    npx cap add android
  fi

  npm run build
  npx cap sync android
  npm run android:icons
)

patch_android_version
patch_android_privacy_preview

echo "Prepared generated Android project version $ANDROID_VERSION_NAME ($ANDROID_VERSION_CODE)"
