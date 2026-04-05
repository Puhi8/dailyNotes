# Daily Notes

Daily Notes is an offline-first notes and daily-tracking app with an optional single-user backup API.

It is split into:
- a React frontend (`frontend`)
- a Go backend (`cmd/api`) backed by SQLite
- a legacy data migration tool (`cmd/migrate_legacy`)

## Highlights

- Offline-first local data storage on the device.
- Optional remote backup sync (`/backup/snapshot`) with conflict-aware pull support in the frontend.
- Device unlock support in the app flow (PIN + optional biometrics on native builds).
- Single-user-per-database backend model.

## Quick Start (Local Development)

### 1) Run backend

```bash
go run ./cmd/api <data-dir>
```

Example:

```bash
go run ./cmd/api ./backup
```

Backend listens on `0.0.0.0:5789`.

### 2) Run frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend dev server runs on `http://localhost:9998` by default.

## First Login

On first backend start, a password file is created automatically:
- path: `<data-dir>/password`
- value: random 2-10 character code

Use that password on the Login page. After login, you can change remote credentials from:
`Settings -> Server -> Remote credentials`

Legacy `<data-dir>/passcode` is no longer used.

## Run with Docker

Build image:

```bash
docker build -t dailynotes-api .
```

Run container with persistent data:

```bash
docker run --name dailynotes-api \
  -p 5789:5789 \
  -v dailynotes-data:/data \
  dailynotes-api
```

Container notes:
- API binary starts as `/app/dailynotes-api /data`.
- Database and generated password file are stored in `/data`.

## Configuration

### Backend environment variables

- `DAILYNOTES_CORS_ORIGIN`: allowed CORS origins (`*`, CSV, or host/origin list).
- `DAILYNOTES_TLS_CERT_FILE`: path to TLS certificate file.
- `DAILYNOTES_TLS_KEY_FILE`: path to TLS private key file.

To enable TLS, set both TLS variables.

### Frontend environment variables

- `VITE_API_BASE_URL`: backend base URL (defaults to `http://localhost:5789`).
- `VITE_ROUTER_MODE`: set to `hash` for static hosts like GitHub Pages.
- `VITE_PUBLIC_BASE_PATH`: optional base path for subpath deploys such as `/repo-name/`.

## Build

Backend:

```bash
go build ./cmd/api
```

Frontend production bundle:

```bash
cd frontend
npm run build
```

GitHub Pages-friendly frontend build:

```bash
cd frontend
VITE_ROUTER_MODE=hash npm run build
```