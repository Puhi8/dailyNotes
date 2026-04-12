## Build It Yourself

Prerequisites: Go, Node.js/npm, JDK 21+, Android SDK, and ImageMagick for Android launcher icon generation.

Build the API:

```bash
cd api
go build -trimpath -ldflags='-s -w' -o ../dailynotes ./cmd/api
```

Build the Android APK (export to `./dist` dir):

```bash
cd frontend
npm install
npm run android:build
```

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
