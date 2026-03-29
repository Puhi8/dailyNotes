# Frontend

## Development
- Install dependencies: `npm install`
- Start the dev server: `npm run dev`

## API base URL
- Set `VITE_API_BASE_URL` (defaults to `http://localhost:5789`)

## Local data (offline-first)
- Daily data is stored on-device in IndexedDB (`dailynotes-device` DB, `kv` store).
- Existing `localStorage` data is migrated automatically on first load.
- Remote API is optional and used only for backup/auth/sync features.

## Protected routes
- Set `VITE_SECURE_PIN` to enable the PIN unlock for `/settings`, `/yesterday`, `/notes`

## Android (Capacitor)
- Build the web bundle: `npm run build`
- Sync native plugins: `npm run android:sync`
- Open Android Studio: `npm run android:open`
- Build directly: `npm run android:build`

## Windows (Electron via Capacitor)
- Build the web bundle: `npm run build`
- Add Electron platform once: `npm run electron:add`
- Sync Electron platform: `npm run electron:sync`
- Install Electron deps: `npm --prefix electron install`
- Build the Windows executable: `npm run windows:build`
