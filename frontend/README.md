# Frontend

## Development
- Install dependencies: `npm install`
- Start the dev server: `npm run dev`

## GitHub Pages
- Static hosting works when the production web build uses hash routing.
- Easiest build command:
  `VITE_ROUTER_MODE=hash VITE_PUBLIC_BASE_PATH=/dailyNotes/ npm run build`
- Build for a project site with:
  `VITE_ROUTER_MODE=hash VITE_PUBLIC_BASE_PATH=/your-repo-name/ npm run build`
- Build for a user/org site root with:
  `VITE_ROUTER_MODE=hash VITE_PUBLIC_BASE_PATH=/ npm run build`
- If you deploy from GitHub Actions, `VITE_PUBLIC_BASE_PATH` can usually be omitted because the Vite config derives the project-site base path from `GITHUB_REPOSITORY`.
- In GitHub Pages mode, routes look like `/#/settings`, which avoids server-side 404s on refresh/direct links.

## API base URL
- Set `VITE_API_BASE_URL` (defaults to `http://localhost:5789`)

## Local data (offline-first)
- Daily data is stored in IndexedDB (`dailynotes-device` DB, `kv` store) on supported platforms, including browser builds.
- Existing `localStorage` data is migrated automatically on first load.
- Remote API is optional and used only for backup/auth/sync features.

## Protected routes
- Set `VITE_SECURE_PIN` to enable the PIN unlock for `/settings`, `/yesterday`, `/notes`

## Android (Capacitor)
- Build the web bundle: `npm run build`
- Sync native plugins: `npm run android:sync`
- Open Android Studio: `npm run android:open`
- Build the raw release APK: `npm run android:build`

## Windows (Electron via Capacitor)
- Build the web bundle: `npm run build`
- Add Electron platform once: `npm run electron:add`
- Sync Electron platform: `npm run electron:sync`
- Install Electron deps: `npm --prefix electron install`
- Build the Windows executable: `npm run windows:build`
