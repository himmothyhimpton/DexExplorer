# Android Setup Instructions

This document provides instructions for setting up the Android build environment locally.

## Prerequisites

1. Install Android Studio
2. Install JDK 11
3. Install Node.js and npm
4. Install Python 3.9+

## Local Setup

1. Install Capacitor in the frontend project:
```bash
cd frontend
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init "Flux Capacitor" "com.fluxcapacitor.app" --web-dir=build
# Note: replace the app name and bundle ID with your preferred values.
```

2. Build the frontend:
```bash
npm run build
```

3. Add Android platform:
```bash
npx cap add android
```

4. Copy backend to Android assets:
```bash
mkdir -p android/app/src/main/assets/backend
cp -r ../backend/* android/app/src/main/assets/backend/
```

5. Update Android configuration:
```bash
npx cap sync android
```

6. Open in Android Studio:
```bash
npx cap open android
```

## Building APK

1. From Android Studio:
   - Build > Build Bundle(s) / APK(s) > Build APK(s)

2. From command line:
```bash
cd android
./gradlew assembleDebug
```

The APK will be located at `android/app/build/outputs/apk/debug/app-debug.apk`

## Release Signing & Play Store (CI)

To ship to Google Play, configure CI signing and optional automatic upload:

1. Create an upload keystore (once):
```bash
keytool -genkeypair \
  -keystore upload-keystore.jks \
  -storepass "<STORE_PASSWORD>" \
  -keypass "<KEY_PASSWORD>" \
  -alias "<KEY_ALIAS>" \
  -dname "CN=Flux Capacitor, OU=Eng, O=Flux, L=City, S=State, C=US" \
  -keyalg RSA -keysize 2048 -validity 3650
```

2. Base64-encode the keystore for GitHub Actions secret:
```bash
base64 -w 0 upload-keystore.jks > upload-keystore.jks.b64
```

3. Add GitHub Secrets in the repository settings:
- `ANDROID_KEYSTORE_BASE64`: contents of `upload-keystore.jks.b64`
- `ANDROID_KEYSTORE_PASSWORD`: keystore store password
- `ANDROID_KEY_ALIAS`: key alias
- `ANDROID_KEY_ALIAS_PASSWORD`: key password

4. Optional: Play Console upload via CI
- Create a service account in Google Play Console with release management permissions.
- Download the JSON key and set secret: `PLAY_SERVICE_ACCOUNT_JSON` to the file contents.
- CI will upload `app-release.aab` to the `internal` track when the secret is present.

Notes:
- CI sets `versionCode` to `100000 + GITHUB_RUN_NUMBER` and `versionName` to `1.0.<RUN_NUMBER>` to ensure unique versions.
- Local release builds remain unsigned unless signing env vars are provided; CI sets them automatically.
