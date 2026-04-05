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
ANDROID_BUILD_CMD="${ANDROID_BUILD_CMD:-./gradlew assembleRelease}"
ANDROID_APK_PATH="${ANDROID_APK_PATH:-$ANDROID_DIR/app/build/outputs/apk/release/app-release-unsigned.apk}"
ANDROID_ASSET_NAME="${ANDROID_ASSET_NAME:-${APP}-${VERSION}.apk}"
ANDROID_LATEST_ASSET_NAME="${ANDROID_LATEST_ASSET_NAME:-${APP}-android.apk}"
ANDROID_JAVA_HOME="${ANDROID_JAVA_HOME:-}"
ANDROID_SDK_HOME="${ANDROID_SDK_HOME:-}"
GHCR_USERNAME="${GHCR_USERNAME:-}"
GHCR_TOKEN="${GHCR_TOKEN:-${CR_PAT:-${GITHUB_TOKEN:-}}}"

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
  local status_output

  if status_output="$(gh auth status 2>&1)"; then
    return 0
  fi

  printf '%s\n' "$status_output"
  echo "GitHub CLI must be authenticated before releasing."
  echo "Run: gh auth login -h github.com"
  exit 1
}

gh_auth_account() {
  gh auth status 2>&1 | awk '
    match($0, /account [^[:space:]]+/) {
      print substr($0, RSTART + 8, RLENGTH - 8)
      exit
    }
  '
}

gh_auth_has_scope() {
  local scope="$1"

  gh auth status 2>&1 | awk -v scope="$scope" '
    /Token scopes:/ {
      if (index($0, scope) > 0) {
        found = 1
      }
    }
    END {
      exit(found ? 0 : 1)
    }
  '
}

docker_image_registry() {
  printf '%s\n' "${DOCKER_IMAGE%%/*}"
}

docker_image_owner() {
  local image_path

  image_path="${DOCKER_IMAGE#*/}"
  if [[ "$image_path" == "$DOCKER_IMAGE" || "$image_path" != */* ]]; then
    return 1
  fi

  printf '%s\n' "${image_path%%/*}"
}

ensure_docker_registry_auth() {
  local registry image_owner username token

  registry="$(docker_image_registry)"
  [[ "$registry" == "ghcr.io" ]] || return 0

  image_owner="$(docker_image_owner || true)"
  username="${GHCR_USERNAME:-${GITHUB_ACTOR:-}}"
  token="$GHCR_TOKEN"

  if [[ -z "$token" ]]; then
    check_github_auth
    if ! gh_auth_has_scope "write:packages"; then
      echo "GitHub CLI token is missing the write:packages scope required for GHCR pushes."
      echo "Run: gh auth refresh -h github.com -s write:packages"
      echo "Or set GHCR_TOKEN and GHCR_USERNAME before running the release."
      exit 1
    fi

    token="$(gh auth token 2>/dev/null)" || {
      echo "Unable to read a GitHub token for GHCR login."
      exit 1
    }
    username="${username:-$(gh_auth_account)}"
  fi

  username="${username:-$image_owner}"
  [[ -n "$username" ]] || {
    echo "Unable to determine the GHCR username for $DOCKER_IMAGE."
    echo "Set GHCR_USERNAME or GITHUB_ACTOR before running the release."
    exit 1
  }

  echo "Logging into $registry as $username..."
  printf '%s\n' "$token" | docker login "$registry" -u "$username" --password-stdin >/dev/null
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

ensure_android_project() {
  if [[ -d "$ANDROID_DIR" ]]; then
    return 0
  fi

  require_cmd npx
  echo "Android project not found at $ANDROID_DIR; running npx cap add android..."
  (
    cd "$FRONTEND_DIR"
    npx cap add android
  )
}

java_major_version() {
  local version
  version="$("$1" -version 2>&1 | awk '/^javac / { print $2; exit }')"
  version="${version%\"}"
  version="${version#\"}"
  if [[ "$version" =~ ^1\.([0-9]+) ]]; then
    echo "${BASH_REMATCH[1]}"
    return 0
  fi
  if [[ "$version" =~ ^([0-9]+) ]]; then
    echo "${BASH_REMATCH[1]}"
    return 0
  fi
  return 1
}

resolve_android_java_home() {
  local candidate major
  local -a candidates=()

  if [[ -n "$ANDROID_JAVA_HOME" ]]; then
    candidates+=("$ANDROID_JAVA_HOME")
  fi
  if [[ -n "${JAVA_HOME:-}" ]]; then
    candidates+=("$JAVA_HOME")
  fi
  candidates+=("$HOME/.android-studio/jbr")

  if [[ -d /usr/lib/jvm ]]; then
    while IFS= read -r candidate; do
      candidates+=("$candidate")
    done < <(find /usr/lib/jvm -mindepth 1 -maxdepth 1 -type d | sort)
  fi

  for candidate in "${candidates[@]}"; do
    [[ -n "$candidate" ]] || continue
    [[ -x "$candidate/bin/java" && -x "$candidate/bin/javac" ]] || continue
    major="$(java_major_version "$candidate/bin/javac")" || continue
    if (( major >= 21 )); then
      echo "$candidate"
      return 0
    fi
  done

  echo "No usable JDK 21+ found for Android build."
  echo "Set ANDROID_JAVA_HOME or JAVA_HOME to a full JDK 21+ install."
  echo "Android Studio JBR usually works, for example: $HOME/.android-studio/jbr"
  exit 1
}

resolve_android_sdk_home() {
  local candidate
  local -a candidates=()

  if [[ -n "$ANDROID_SDK_HOME" ]]; then
    candidates+=("$ANDROID_SDK_HOME")
  fi
  if [[ -n "${ANDROID_HOME:-}" ]]; then
    candidates+=("$ANDROID_HOME")
  fi
  if [[ -n "${ANDROID_SDK_ROOT:-}" ]]; then
    candidates+=("$ANDROID_SDK_ROOT")
  fi

  candidates+=(
    "$HOME/Android/Sdk"
    "$HOME/Android/sdk"
    "$HOME/Library/Android/sdk"
    "$HOME/AppData/Local/Android/Sdk"
    "$HOME/.android/sdk"
  )

  for candidate in "${candidates[@]}"; do
    [[ -n "$candidate" ]] || continue
    if [[ -d "$candidate/platforms" && -d "$candidate/build-tools" ]]; then
      echo "$candidate"
      return 0
    fi
  done

  echo "No usable Android SDK found."
  echo "Set ANDROID_SDK_HOME, ANDROID_HOME, or ANDROID_SDK_ROOT to your SDK path."
  exit 1
}

write_android_local_properties() {
  local android_sdk_home="$1"
  local local_properties_path="$ANDROID_DIR/local.properties"
  local escaped_sdk_dir

  escaped_sdk_dir="${android_sdk_home//\\/\\\\}"
  escaped_sdk_dir="${escaped_sdk_dir//:/\\:}"

  printf 'sdk.dir=%s\n' "$escaped_sdk_dir" > "$local_properties_path"
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
  local android_java_home
  local android_sdk_home

  echo "Building Android APK..."
  mkdir -p "$DIST_DIR"
  ensure_android_project
  android_java_home="$(resolve_android_java_home)"
  android_sdk_home="$(resolve_android_sdk_home)"
  write_android_local_properties "$android_sdk_home"
  echo "Using Android JDK: $android_java_home"
  echo "Using Android SDK: $android_sdk_home"
  (
    cd "$FRONTEND_DIR"
    JAVA_HOME="$android_java_home" \
    ANDROID_HOME="$android_sdk_home" \
    ANDROID_SDK_ROOT="$android_sdk_home" \
    PATH="$android_java_home/bin:$android_sdk_home/platform-tools:$PATH" \
    npm run android:sync
  )
  if [[ ! -f "$ANDROID_DIR/gradlew" ]]; then
    echo "No Gradle wrapper found at $ANDROID_DIR/gradlew"
    exit 1
  fi
  (
    cd "$ANDROID_DIR"
    chmod +x gradlew
    JAVA_HOME="$android_java_home" \
    ANDROID_HOME="$android_sdk_home" \
    ANDROID_SDK_ROOT="$android_sdk_home" \
    PATH="$android_java_home/bin:$android_sdk_home/platform-tools:$PATH" \
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
  ensure_docker_registry_auth
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
