#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_ICON="${ROOT_DIR}/public/icon.png"
RES_DIR="${ROOT_DIR}/android/app/src/main/res"

if [[ ! -f "$SOURCE_ICON" ]]; then
  echo "Source icon not found: $SOURCE_ICON" >&2
  exit 1
fi

if [[ ! -d "$RES_DIR" ]]; then
  echo "Android resources directory not found: $RES_DIR" >&2
  exit 1
fi

if command -v magick >/dev/null 2>&1; then
  IMAGE_TOOL=(magick)
elif command -v convert >/dev/null 2>&1; then
  IMAGE_TOOL=(convert)
else
  echo "ImageMagick is required to sync Android icons." >&2
  exit 1
fi

render_square_icon() {
  local size="$1"
  local output="$2"

  "${IMAGE_TOOL[@]}" "$SOURCE_ICON" \
    -resize "${size}x${size}" \
    -background none \
    -gravity center \
    -extent "${size}x${size}" \
    "PNG32:${output}"
}

render_round_icon() {
  local size="$1"
  local output="$2"
  local center=$((size / 2))

  "${IMAGE_TOOL[@]}" "$SOURCE_ICON" \
    -resize "${size}x${size}" \
    -background none \
    -gravity center \
    -extent "${size}x${size}" \
    \( -size "${size}x${size}" xc:none -fill white -draw "circle ${center},${center} ${center},1" \) \
    -compose CopyOpacity \
    -composite \
    "PNG32:${output}"
}

render_foreground_icon() {
  local canvas_size="$1"
  local output="$2"
  local inner_size=$((canvas_size * 2 / 3))

  "${IMAGE_TOOL[@]}" "$SOURCE_ICON" \
    -resize "${inner_size}x${inner_size}" \
    -background none \
    -gravity center \
    -extent "${canvas_size}x${canvas_size}" \
    "PNG32:${output}"
}

declare -a launcher_sizes=(
  "mipmap-mdpi 48 108"
  "mipmap-hdpi 72 162"
  "mipmap-xhdpi 96 216"
  "mipmap-xxhdpi 144 324"
  "mipmap-xxxhdpi 192 432"
)

for spec in "${launcher_sizes[@]}"; do
  read -r density icon_size foreground_size <<<"$spec"
  density_dir="${RES_DIR}/${density}"

  render_square_icon "$icon_size" "${density_dir}/ic_launcher.png"
  render_round_icon "$icon_size" "${density_dir}/ic_launcher_round.png"
  render_foreground_icon "$foreground_size" "${density_dir}/ic_launcher_foreground.png"
done

echo "Synced Android launcher icons from ${SOURCE_ICON}"
