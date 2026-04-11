# Daily Notes

Offline-first daily notes and tracking app with an optional backup API.

## Quick Start

### [Download the latest Android APK](https://github.com/Puhi8/dailyNotes/releases/latest/download/dailynotes-android.apk)

### Docker compose

```yaml
services:
  dailynotes:
    image: ghcr.io/puhi8/dailynotes:latest
    restart: unless-stopped
    ports:
      - "5789:5789"
    volumes:
      - dailynotes-data:/data

volumes:
  dailynotes-data:
```

### Download binary

Download the latest compiled backend binary in current directory (there is no windows version).

```bash
curl -fsSL https://raw.githubusercontent.com/Puhi8/dailyNotes/main/install-api.sh | bash
```

Run it with:

```bash
./dailynotes ./data
```

## First Login

On first backend start, a password file is created at `<data-dir>/password`.

Use that password on the Login page. After login, you can change remote credentials in:
`Settings -> Server -> Remote credentials` or just modifying the password file.

## Local Dev

Backend:

```bash
cd api
go run ./cmd/api ../data # Listens on port 5789
```

Frontend:

```bash
cd frontend
npm install
npm run dev # Listens on port 9998
```

## Build It Yourself

Prerequisites: Go, Node.js/npm, JDK 21+, Android SDK, and ImageMagick for Android launcher icon generation.

Build the API:

```bash
cd api
go build -trimpath -ldflags='-s -w' -o ../dailynotes ./cmd/api
```

Build the Android APK:

```bash
cd frontend
npm install
npm run android:build
```

The APK is written to:

```text
frontend/android/app/build/outputs/apk/release/app-release.apk
```

Build an unsigned F-Droid-style APK:

```bash
cd frontend
npm install
npm run android:build:fdroid
```

The F-Droid recipe in `.fdroid.yml` keeps `frontend/android/` generated instead of
committed. Official F-Droid review may still ask for the generated Android
project to be committed.
