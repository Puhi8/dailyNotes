#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_ICON="${ROOT_DIR}/public/icon.png"
SOURCE_MONOCHROME_ICON="${ROOT_DIR}/public/icon-monochrome.xml"
RES_DIR="${ROOT_DIR}/android/app/src/main/res"

if [[ ! -f "$SOURCE_ICON" ]]; then
  echo "Source icon not found: $SOURCE_ICON" >&2
  exit 1
fi

if [[ ! -f "$SOURCE_MONOCHROME_ICON" ]]; then
  echo "Source monochrome icon not found: $SOURCE_MONOCHROME_ICON" >&2
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

write_vector_icons() {
  local drawable_dir="${RES_DIR}/drawable"
  mkdir -p "$drawable_dir"
  cp "$SOURCE_MONOCHROME_ICON" "${drawable_dir}/ic_launcher_foreground_vector.xml"
  cp "$SOURCE_MONOCHROME_ICON" "${drawable_dir}/ic_launcher_monochrome.xml"
}

write_adaptive_icon() {
  local output="$1"
  mkdir -p "$(dirname "$output")"
  cat > "$output" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground_vector" />
    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />
</adaptive-icon>
EOF
}

declare -a launcher_sizes=(
  "mipmap-mdpi 48"
  "mipmap-hdpi 72"
  "mipmap-xhdpi 96"
  "mipmap-xxhdpi 144"
  "mipmap-xxxhdpi 192"
)

for spec in "${launcher_sizes[@]}"; do
  read -r density icon_size <<<"$spec"
  density_dir="${RES_DIR}/${density}"

  render_square_icon "$icon_size" "${density_dir}/ic_launcher.png"
  render_round_icon "$icon_size" "${density_dir}/ic_launcher_round.png"
  rm -f "${density_dir}/ic_launcher_foreground.png"
done

write_vector_icons
write_adaptive_icon "${RES_DIR}/mipmap-anydpi-v26/ic_launcher.xml"
write_adaptive_icon "${RES_DIR}/mipmap-anydpi-v26/ic_launcher_round.xml"

echo "Synced Android launcher icons from ${SOURCE_ICON}"
