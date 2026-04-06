#!/usr/bin/env bash
set -euo pipefail

REPO="Puhi8/dailyNotes"
APP="dailynotes"

if [[ $# -gt 0 ]]; then
  echo "This script takes no arguments." >&2
  echo "Run it as: bash install-api.sh" >&2
  exit 1
fi

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

normalize_os() {
  case "${1,,}" in
    linux) echo "linux" ;;
    darwin|macos|macosx|osx) echo "darwin" ;;
    windows|mingw*|msys*|cygwin*) echo "windows" ;;
    *)
      echo "Unsupported OS: $1" >&2
      exit 1
      ;;
  esac
}

normalize_arch() {
  case "${1,,}" in
    amd64|x86_64) echo "amd64" ;;
    arm64|aarch64) echo "arm64" ;;
    *)
      echo "Unsupported architecture: $1" >&2
      exit 1
      ;;
  esac
}

detect_os() {
  normalize_os "$(uname -s)"
}

detect_arch() {
  normalize_arch "$(uname -m)"
}

download_file() {
  local url="$1"
  local output="$2"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o "$output" "$url"
    return
  fi

  if command -v wget >/dev/null 2>&1; then
    wget -qO "$output" "$url"
    return
  fi

  echo "Missing required command: curl or wget" >&2
  exit 1
}

OS="$(detect_os)"
ARCH="$(detect_arch)"

ARCHIVE_EXT="tar.gz"
ASSET_BINARY_NAME="${APP}-${OS}-${ARCH}"
INSTALLED_BINARY_NAME="$APP"

if [[ "$OS" == "windows" ]]; then
  ARCHIVE_EXT="zip"
  ASSET_BINARY_NAME="${ASSET_BINARY_NAME}.exe"
  INSTALLED_BINARY_NAME="${APP}.exe"
fi

ASSET_NAME="${APP}-${OS}-${ARCH}.${ARCHIVE_EXT}"
ASSET_URL="https://github.com/${REPO}/releases/latest/download/${ASSET_NAME}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

TARGET_PATH="./${INSTALLED_BINARY_NAME}"
ARCHIVE_PATH="${TMP_DIR}/${ASSET_NAME}"

download_file "$ASSET_URL" "$ARCHIVE_PATH"

if [[ "$OS" == "windows" ]]; then
  require_cmd unzip
  unzip -p "$ARCHIVE_PATH" "$ASSET_BINARY_NAME" > "$TARGET_PATH"
else
  require_cmd tar
  tar -xzf "$ARCHIVE_PATH" -C "$TMP_DIR" "$ASSET_BINARY_NAME"
  mv "$TMP_DIR/$ASSET_BINARY_NAME" "$TARGET_PATH"
fi

chmod +x "$TARGET_PATH" 2>/dev/null || true

echo "Installed ${TARGET_PATH}"
