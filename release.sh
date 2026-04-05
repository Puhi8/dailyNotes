#!/usr/bin/env bash
set -euo pipefail

########################################
# Config (override via env)
########################################
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="${FRONTEND_DIR:-$ROOT_DIR/frontend}"
ANDROID_DIR="${ANDROID_DIR:-$FRONTEND_DIR/android}"

APP="${APP:-dailynotes}"
REPO="${REPO:-Puhi8/dailyNotes}"
REMOTE="${GIT_REMOTE:-github}"
DIST_DIR="${DIST_DIR:-dist}"
USAGE="Usage: $0 v1.2.3"

if [[ $# -lt 1 ]]; then
  echo "$USAGE"
  exit 1
fi

VERSION="$1"

BUILD_CMD="${BUILD_CMD:-go build -trimpath -ldflags='-s -w' -o}"
BUILD_PATH="${BUILD_PATH:-./cmd/api}"
DOCKER_IMAGE="${DOCKER_IMAGE:-ghcr.io/puhi8/dailynotes}"
DOCKER_PLATFORM="${DOCKER_PLATFORM:-linux/amd64}"
FRONTEND_DEPLOY_CMD="${FRONTEND_DEPLOY_CMD:-npm run deploy}"
ANDROID_BUILD_CMD="${ANDROID_BUILD_CMD:-./gradlew assembleDebug}"
ANDROID_APK_PATH="${ANDROID_APK_PATH:-$ANDROID_DIR/app/build/outputs/apk/debug/app-debug.apk}"
ANDROID_ASSET_NAME="${ANDROID_ASSET_NAME:-${APP}-${VERSION}.apk}"
ANDROID_LATEST_ASSET_NAME="${ANDROID_LATEST_ASSET_NAME:-${APP}-android.apk}"

TARGETS=(
  "linux amd64"
  "linux arm64"
  "darwin amd64"
  "darwin arm64"
  "windows amd64"
  "windows arm64"
)

########################################
# Helpers
########################################
require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1"
    exit 1
  }
}

check_github_auth() {
  gh auth status >/dev/null 2>&1 || {
    echo "GitHub CLI is not authenticated. Run: gh auth login"
    exit 1
  }
}

check_frontend_deps() {
  if [[ "$FRONTEND_DEPLOY_CMD" == "npm run deploy" ]]; then
    (
      cd "$FRONTEND_DIR"
      npm ls gh-pages >/dev/null 2>&1
    ) || {
      echo "Missing frontend deploy dependency: gh-pages"
      echo "Run: (cd \"$FRONTEND_DIR\" && npm install)"
      exit 1
    }
  fi
}

write_checksum() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" > "${file}.sha256"
  else
    shasum -a 256 "$file" > "${file}.sha256"
  fi
}

check_git() {
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
    echo "Not inside a git repo"
    exit 1
  }
  [[ -z "$(git status --porcelain)" ]] || {
    echo "Working tree not clean"
    exit 1
  }
}

tag_exists_locally() {
  git show-ref --verify --quiet "refs/tags/$VERSION"
}

remote_tag_commit() {
  local remote_ref remote_status

  if remote_ref="$(git ls-remote --exit-code --tags "$REMOTE" "refs/tags/$VERSION^{}")"; then
    printf '%s\n' "$remote_ref" | awk 'NR == 1 { print $1 }'
    return 0
  else
    remote_status=$?
  fi
  if [[ $remote_status -ne 2 ]]; then
    echo "Failed to query tags from remote '$REMOTE'"
    exit 1
  fi

  if remote_ref="$(git ls-remote --exit-code --tags "$REMOTE" "refs/tags/$VERSION")"; then
    printf '%s\n' "$remote_ref" | awk 'NR == 1 { print $1 }'
    return 0
  else
    remote_status=$?
  fi
  if [[ $remote_status -ne 2 ]]; then
    echo "Failed to query tags from remote '$REMOTE'"
    exit 1
  fi

  return 1
}

check_tag() {
  local head_commit local_tag_commit_value remote_commit

  head_commit="$(git rev-parse HEAD)"
  if tag_exists_locally; then
    local_tag_commit_value="$(git rev-list -n 1 "$VERSION")"
    if [[ "$local_tag_commit_value" != "$head_commit" ]]; then
      echo "Tag exists locally but points to $local_tag_commit_value, not HEAD $head_commit"
      exit 1
    fi
    echo "Reusing existing local tag $VERSION at $head_commit"
  fi

  if git remote get-url "$REMOTE" >/dev/null 2>&1; then
    if remote_commit="$(remote_tag_commit)"; then
      if [[ "$remote_commit" != "$head_commit" ]]; then
        echo "Tag exists on remote but points to $remote_commit, not HEAD $head_commit"
        exit 1
      fi
      echo "Reusing existing remote tag $VERSION at $head_commit"
    fi
  fi
}

ensure_local_tag() {
  if tag_exists_locally; then
    return 0
  fi

  git tag -a "$VERSION" -m "$APP $VERSION"
}

collect_release_assets() {
  RELEASE_ASSETS=()
  if [[ -d "$DIST_DIR" ]]; then
    while IFS= read -r -d '' file; do
      RELEASE_ASSETS+=("$file")
    done < <(find "$DIST_DIR" -maxdepth 1 -type f -print0)
  fi
}

########################################
# Compile binaries
########################################
build_binaries() {
  echo "Building binaries..."
  rm -rf "$DIST_DIR"
  mkdir -p "$DIST_DIR"
  for target in "${TARGETS[@]}"; do
    read -r GOOS GOARCH <<<"$target"
    BIN="${DIST_DIR}/${APP}-${GOOS}-${GOARCH}"
    [[ "$GOOS" == "windows" ]] && BIN="${BIN}.exe"
    echo " - $GOOS/$GOARCH"
    CGO_ENABLED=0 GOOS="$GOOS" GOARCH="$GOARCH" \
      bash -lc "$BUILD_CMD \"$BIN\" \"$BUILD_PATH\""
  done
}

########################################
# Package
########################################
package() {
  echo "Packaging..."
  cd "$DIST_DIR"
  for target in "${TARGETS[@]}"; do
    read -r GOOS GOARCH <<<"$target"
    BASE="${APP}-${GOOS}-${GOARCH}"
    if [[ "$GOOS" == "windows" ]]; then
      zip -q "${BASE}.zip" "${BASE}.exe"
      rm -f "${BASE}.exe"
    else
      tar -czf "${BASE}.tar.gz" "$BASE"
      rm -f "$BASE"
    fi
  done
  if [[ -f "$ROOT_DIR/install-api.sh" ]]; then
    cp "$ROOT_DIR/install-api.sh" ./install-api.sh
    chmod +x ./install-api.sh
  fi
  if command -v sha256sum >/dev/null; then
    sha256sum ./* > checksums.txt
  else
    shasum -a 256 ./* > checksums.txt
  fi
  cd - >/dev/null
}

########################################
# GitHub Pages
########################################
deploy_frontend() {
  echo "Deploying frontend to GitHub Pages..."
  (
    cd "$FRONTEND_DIR"
    bash -lc "$FRONTEND_DEPLOY_CMD"
  )
}

########################################
# Docker
########################################
docker_build() {
  echo "Building and publishing Docker image..."
  docker buildx build \
    --platform "$DOCKER_PLATFORM" \
    --tag "${DOCKER_IMAGE}:${VERSION}" \
    --tag "${DOCKER_IMAGE}:latest" \
    --push \
    .
  echo "Docker image published:"
  echo "  ${DOCKER_IMAGE}:${VERSION}"
  echo "  ${DOCKER_IMAGE}:latest"
}

########################################
# Android APK
########################################
build_android() {
  echo "Building Android APK..."
  mkdir -p "$DIST_DIR"
  (
    cd "$FRONTEND_DIR"
    npm run android:sync
  )
  if [[ ! -f "$ANDROID_DIR/gradlew" ]]; then
    echo "No Gradle wrapper found at $ANDROID_DIR/gradlew"
    exit 1
  fi
  (
    cd "$ANDROID_DIR"
    chmod +x gradlew
    bash -lc "$ANDROID_BUILD_CMD"
  )
  if [[ ! -f "$ANDROID_APK_PATH" ]]; then
    echo "APK not found: $ANDROID_APK_PATH"
    exit 1
  fi

  cp "$ANDROID_APK_PATH" "$DIST_DIR/$ANDROID_ASSET_NAME"
  write_checksum "$DIST_DIR/$ANDROID_ASSET_NAME"
  if [[ "$ANDROID_LATEST_ASSET_NAME" != "$ANDROID_ASSET_NAME" ]]; then
    cp "$ANDROID_APK_PATH" "$DIST_DIR/$ANDROID_LATEST_ASSET_NAME"
    write_checksum "$DIST_DIR/$ANDROID_LATEST_ASSET_NAME"
  fi

  echo "APK copied to:"
  echo "  $DIST_DIR/$ANDROID_ASSET_NAME"
  if [[ "$ANDROID_LATEST_ASSET_NAME" != "$ANDROID_ASSET_NAME" ]]; then
    echo "  $DIST_DIR/$ANDROID_LATEST_ASSET_NAME"
  fi
}

########################################
# Release
########################################
create_release() {
  echo "Creating release..."
  [[ -n "$REPO" ]] || {
    echo "REPO is required for GitHub Releases"
    exit 1
  }
  collect_release_assets
  [[ ${#RELEASE_ASSETS[@]} -gt 0 ]] || {
    echo "No release assets found in $DIST_DIR"
    exit 1
  }
  ensure_local_tag
  git push "$REMOTE" "$VERSION"
  gh release create "$VERSION" \
    "${RELEASE_ASSETS[@]}" \
    --repo "$REPO" \
    --title "$APP $VERSION" \
    --generate-notes \
    --verify-tag
}

########################################
# Main
########################################
main() {
  if [[ $# -gt 1 ]]; then
    echo "This script always builds and releases everything."
    echo "$USAGE"
    exit 1
  fi

  require_cmd git
  require_cmd gh
  require_cmd npm
  require_cmd docker
  require_cmd go
  require_cmd tar
  require_cmd zip

  check_git
  check_github_auth
  check_frontend_deps
  check_tag

  echo "==== Releasing $APP $VERSION ===="

  build_binaries
  package
  build_android
  deploy_frontend
  docker_build
  create_release

  echo "Done releasing $APP $VERSION"
}

main "$@"
