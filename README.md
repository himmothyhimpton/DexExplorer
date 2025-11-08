# Dex Audit

[![Android Build](https://github.com/himmothyhimpton/flux-capacitor/actions/workflows/android-build.yml/badge.svg?branch=main)](https://github.com/himmothyhimpton/flux-capacitor/actions/workflows/android-build.yml)

Privacy Audit & Leak Test — a React + FastAPI app that inspects site privacy headers, detects Onion-Location mirrors, checks Tor availability, and probes client WebRTC/IP exposure before you open links.

## Overview

This application consists of:
- **Backend**: FastAPI server providing privacy audit APIs, Tor checks, and connection discovery
- **Frontend**: React application with a Privacy Audit card and connectivity UI
- **Android App**: Capacitor-based mobile build with diagnostics and privacy tests

## Android Build

This project can be built into an Android app using GitHub Actions:

1. The workflow automatically builds when code is pushed to the main branch
2. APK is generated and available as an artifact in GitHub Actions
3. Users can download and install the APK directly on their Android devices

For detailed local setup instructions, see [Android Setup](android-setup.md).

View CI runs: https://github.com/himmothyhimpton/flux-capacitor/actions

## Privacy Policy (for Google Play)

You need a public URL for your Privacy Policy. Two easy options:

- Backend route: run/deploy the FastAPI server and use `https://your-server-domain/privacy`.
- GitHub Pages: use the included `docs/privacy.html`.

### Enable GitHub Pages
1. Push the repo to GitHub (e.g., `https://github.com/himmothyhimpton/flux-capacitor`).
2. In GitHub: Settings → Pages → Source: "Deploy from a branch".
3. Select Branch: `main`, Folder: `/docs`, then Save.
4. Your policy will be available at `https://<your-username>.github.io/<repo-name>/privacy.html`.

For the provided repo, the link will be:
- `https://himmothyhimpton.github.io/flux-capacitor/privacy.html`

Add this URL in Play Console → App content → Privacy policy.

## AdMob Setup

Set these env vars in `frontend/.env`:
- `REACT_APP_ADMOB_APP_ID=ca-app-pub-xxxxxxxxxxxxxxxx~yyyyyyyyyy`
- `REACT_APP_ADMOB_REWARDED_UNIT_ID=ca-app-pub-xxxxxxxxxxxxxxxx/zzzzzzzzzz`
- Optional: `REACT_APP_ADMOB_DEBUG_AUTO_UNLOCK=true` to bypass the gate during dev.

See `frontend/README.admob.md` for details.

### CI AdMob App ID Secret
The CI injects the AdMob App ID into the Android manifest during the build.

- In GitHub: Settings → Secrets and variables → Actions → New repository secret
- Name: `ADMOB_APP_ID`
- Value: your App ID (format `ca-app-pub-xxxxxxxxxxxxxxxx~yyyyyyyyyy`)

If the secret is missing, the CI uses Google’s sample App ID for testing only.

## Development

### Backend
```bash
cd backend
pip install -r requirements.txt
python server.py
```

### Frontend
```bash
cd frontend
npm install
npm start
```

### Dark Web Mode (Ahmia Auto‑Redirect)
- Clicking the `Dark Web` option now immediately opens the secure browser overlay and auto‑connects using Tor requirements, then loads Ahmia (`https://ahmia.fi/`) without intermediate prompts.

### Orbot & Tor Setup (Android)
- Orbot (Tor daemon) is required for `.onion` browsing and Tor‑routed connectivity.
- Follow the guide: `docs/orbot-setup.html` locally, or run the backend and visit `http://localhost:8000/orbot-setup`.
- Steps:
  - Install Orbot from Google Play or F‑Droid.
  - Launch Orbot and wait until status shows Connected.
  - Install the official Tor Browser from Google Play; it will route via Tor automatically when Orbot is connected.
  - For other apps (e.g., Bitwarden, Element), enable the Orbot VPN profile or set proxy in their network settings.
- Notes:
  - The Tor Project recommends Tor Browser for web browsing through Tor due to strong privacy protections.
  - Orbot uses a VPN profile but is not a traditional VPN service.
  - The app surfaces a contextual “Orbot setup guide” link when Tor is required but not active.
- A loading indicator is shown during connection; existing rewards gate and connection safeguards remain in place.
- Normal mode continues to use DuckDuckGo by default and supports an Incognito toggle for persistence control.

## GitHub Workflow

The project includes a GitHub workflow that:
1. Builds the frontend React application
2. Sets up Capacitor for Android
3. Packages the backend into the Android assets
4. Builds an Android APK
5. Makes the APK available for download
