#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="${API_DIR:-$ROOT_DIR/api}"
FRONTEND_DIR="${FRONTEND_DIR:-$ROOT_DIR/frontend}"

APP="${APP:-dailynotes}"
REPO="${REPO:-Puhi8/dailyNotes}"
REMOTE="${GIT_REMOTE:-github}"
DIST_DIR="${DIST_DIR:-$ROOT_DIR/dist}"
USAGE="Usage: $0 v1.2.3"

if [[ "$DIST_DIR" != /* ]]; then
  DIST_DIR="$ROOT_DIR/$DIST_DIR"
fi

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "$USAGE"
  exit 1
fi
if [[ $# -gt 1 ]]; then
  echo "This script always builds and releases everything."
  echo "$USAGE"
  exit 1
fi

BUILD_CMD="${BUILD_CMD:-go build -trimpath -ldflags='-s -w' -o}"
BUILD_PATH="${BUILD_PATH:-./cmd/api}"
DOCKER_IMAGE="${DOCKER_IMAGE:-ghcr.io/puhi8/dailynotes}"
DOCKER_PLATFORM="${DOCKER_PLATFORM:-linux/amd64}"
FRONTEND_DEPLOY_CMD="${FRONTEND_DEPLOY_CMD:-npm run deploy}"

ANDROID_ASSET_NAME="${ANDROID_ASSET_NAME:-${APP}-android.apk}"
ANDROID_APK_PATH="${ANDROID_APK_PATH:-$DIST_DIR/$ANDROID_ASSET_NAME}"
ANDROID_VERSION_HELPER="${ANDROID_VERSION_HELPER:-$FRONTEND_DIR/scripts/android-version.sh}"

GHCR_USERNAME="${GHCR_USERNAME:-${GITHUB_ACTOR:-}}"
GHCR_TOKEN="${GHCR_TOKEN:-${CR_PAT:-${GITHUB_TOKEN:-}}}"

TARGETS=(
  "linux amd64"
  "linux arm64"
  "darwin amd64"
  "darwin arm64"
)

die() {
  echo "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

run_cmd_in_dir() {
  local dir="$1"
  local cmd="$2"
  (
    cd "$dir"
    bash -lc "$cmd"
  )
}

check_git_state() {
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "Not inside a git repo"
  if [[ -n "$(git status --porcelain)" ]]; then echo "Warning: working tree is dirty; continuing anyway."; fi
}

check_github_auth() {
  gh auth status >/dev/null 2>&1 || die "GitHub CLI is not authenticated. Run: gh auth login -h github.com"
}

check_and_install_frontend_deps() {
  if [[ "$FRONTEND_DEPLOY_CMD" != "npm run deploy" ]]; then return 0; fi
  run_cmd_in_dir "$FRONTEND_DIR" "npm ls gh-pages >/dev/null 2>&1 || (
    echo 'Running npm install because dependency gh-pages was not found'
    npm install
  )"
}

local_tag_commit() {
  git rev-parse "$VERSION^{commit}" 2>/dev/null
}

remote_tag_commit() {
  git ls-remote --refs --tags "$REMOTE" "refs/tags/$VERSION^{}" "refs/tags/$VERSION" | awk 'NR == 1 { print $1 }'
}

check_tag() {
  local head local_commit remote_commit
  head="$(git rev-parse HEAD)"
  if local_commit="$(local_tag_commit)"; then
    [[ "$local_commit" == "$head" ]] || die "Tag exists locally but points to $local_commit, not HEAD $head"
    echo "Reusing existing local tag $VERSION at $head"
  fi

  if git remote get-url "$REMOTE" >/dev/null 2>&1; then
    remote_commit="$(remote_tag_commit)"
    if [[ -n "$remote_commit" ]]; then
      [[ "$remote_commit" == "$head" ]] || die "Tag exists on remote but points to $remote_commit, not HEAD $head"
      echo "Reusing existing remote tag $VERSION at $head"
    fi
  fi
}

ensure_local_tag() {
  local_tag_commit >/dev/null || git tag -a "$VERSION" -m "$APP $VERSION"
}

collect_release_assets() {
  local file
  RELEASE_ASSETS=()
  shopt -s nullglob
  for file in "$DIST_DIR"/*; do [[ -f "$file" ]] && RELEASE_ASSETS+=("$file"); done
  shopt -u nullglob
  [[ ${#RELEASE_ASSETS[@]} -gt 0 ]] || die "No release assets found in $DIST_DIR"
}

resolve_release_android_version() {
  [[ -x "$ANDROID_VERSION_HELPER" ]] || die "Android version helper not executable: $ANDROID_VERSION_HELPER"

  ANDROID_VERSION_NAME="$("$ANDROID_VERSION_HELPER" print-name "$VERSION")"
  ANDROID_VERSION_CODE="${ANDROID_VERSION_CODE:-$("$ANDROID_VERSION_HELPER" print-code "$ANDROID_VERSION_NAME")}"
  export ANDROID_VERSION_NAME
  export ANDROID_VERSION_CODE
}

login_docker_registry() {
  local registry owner username token
  registry="${DOCKER_IMAGE%%/*}"
  [[ "$registry" == "ghcr.io" ]] || return 0
  owner="${DOCKER_IMAGE#*/}"
  owner="${owner%%/*}"
  username="${GHCR_USERNAME:-$owner}"
  token="$GHCR_TOKEN"

  if [[ -z "$token" ]]; then
    check_github_auth
    token="$(gh auth token 2>/dev/null)" || die "Unable to read GitHub token for GHCR login."
  fi

  echo "Logging into $registry as $username..."
  printf '%s\n' "$token" | docker login "$registry" -u "$username" --password-stdin >/dev/null || die "Docker login failed for $registry"
}

build_binaries() {
  local target goos goarch bin

  echo "Building binaries..."
  rm -rf "$DIST_DIR"
  mkdir -p "$DIST_DIR"

  for target in "${TARGETS[@]}"; do
    read -r goos goarch <<<"$target"
    bin="$DIST_DIR/${APP}-${goos}-${goarch}"
    echo " - $goos/$goarch"
    (
      cd "$API_DIR"
      CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" bash -lc "$BUILD_CMD \"$bin\" \"$BUILD_PATH\""
    )
  done
}

package_binaries() {
  local target goos goarch base
  echo "Packaging..."
  (
    cd "$DIST_DIR"
    for target in "${TARGETS[@]}"; do
      read -r goos goarch <<<"$target"
      base="${APP}-${goos}-${goarch}"
      tar -czf "${base}.tar.gz" "$base"
      rm -f "$base"
    done
  )
}

build_android() {
  echo "Building Android APK..."
  mkdir -p "$DIST_DIR"
  resolve_release_android_version
  echo "Using Android versionName: $ANDROID_VERSION_NAME"
  echo "Using Android versionCode: $ANDROID_VERSION_CODE"
  (
    cd "$FRONTEND_DIR"
    ANDROID_VERSION_NAME="$ANDROID_VERSION_NAME" \
      ANDROID_VERSION_CODE="$ANDROID_VERSION_CODE" \
      ANDROID_SIGNED_APK_PATH="$ANDROID_APK_PATH" \
      npm run android:build
  )
  echo "APK copied to:"
  echo "  $DIST_DIR/$ANDROID_ASSET_NAME"
}

deploy_frontend() {
  echo "Deploying frontend to GitHub Pages..."
  run_cmd_in_dir "$FRONTEND_DIR" "$FRONTEND_DEPLOY_CMD"
}

docker_build() {
  echo "Building and publishing Docker image..."
  docker buildx build --platform "$DOCKER_PLATFORM" --tag "${DOCKER_IMAGE}:${VERSION}" --tag "${DOCKER_IMAGE}:latest" --push .
  echo "Docker image published:"
  echo "  ${DOCKER_IMAGE}:${VERSION}"
  echo "  ${DOCKER_IMAGE}:latest"
}

create_release() {
  [[ -n "$REPO" ]] || die "REPO is required for GitHub Releases"
  echo "Creating release..."
  collect_release_assets
  ensure_local_tag
  git push "$REMOTE" "$VERSION"
  gh release create "$VERSION" "${RELEASE_ASSETS[@]}" --repo "$REPO" --title "$APP $VERSION" --generate-notes --verify-tag
}

require_cmd git
require_cmd gh
require_cmd npx
require_cmd npm
require_cmd docker
require_cmd go
require_cmd tar

check_git_state
check_github_auth
login_docker_registry
check_and_install_frontend_deps
check_tag

echo "==== Releasing $APP $VERSION ===="

build_binaries
package_binaries
build_android
deploy_frontend
docker_build
create_release

echo "Done releasing $APP $VERSION"
