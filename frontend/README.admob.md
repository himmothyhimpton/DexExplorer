# Google Mobile Ads SDK Integration

This app integrates Google Mobile Ads SDK via Capacitor for:
- Rewarded Interstitial (for the unlock gate)
- Banner (adaptive, bottom)
- Native Advanced (when supported; falls back to banner)

## IDs

- App ID: `ca-app-pub-4730576212175841~6585663640`
- Rewarded Interstitial Unit: `ca-app-pub-4730576212175841/8282082216`
- Banner Unit: `ca-app-pub-4730576212175841/1948608155`
- Native Advanced Unit: `ca-app-pub-4730576212175841/2990227083`

These are set in `frontend/.env`:

```
REACT_APP_ADMOB_APP_ID=ca-app-pub-4730576212175841~6585663640
REACT_APP_ADMOB_REWARDED_UNIT_ID=ca-app-pub-4730576212175841/2298826475
REACT_APP_ADMOB_REWARDED_INTERSTITIAL_UNIT_ID=ca-app-pub-4730576212175841/8282082216
REACT_APP_ADMOB_BANNER_UNIT_ID=ca-app-pub-4730576212175841/1948608155
REACT_APP_ADMOB_NATIVE_ADVANCED_UNIT_ID=ca-app-pub-4730576212175841/2990227083
REACT_APP_ADMOB_DEBUG_AUTO_UNLOCK=false
```

## Install and Platform Setup (Android)

1. Install packages:
   - `npm install @capacitor/android @capacitor-community/admob`
2. Add Android platform:
   - `npx cap add android`
3. Sync native:
   - `npx cap sync android`
4. Ensure App ID meta-data exists in `AndroidManifest.xml` (or initialize via code):
   - In the `application` tag:
     ```xml
     <meta-data
         android:name="com.google.android.gms.ads.APPLICATION_ID"
         android:value="ca-app-pub-4730576212175841~6585663640"/>
     ```
   - The code also calls `AdMob.initialize({ appId })` on app start.
5. Open Android Studio and run the app.

## How It Works

- On app start, `src/lib/admob.js` initializes AdMob.
- Home screen shows a Native Advanced ad if supported, otherwise an adaptive banner at the bottom.
- The Connect action calls a gate helper (`src/lib/adGate.js`) that presents a Rewarded Interstitial on Android.
- On web, a simple confirmation simulates the gate to keep dev smooth.
- After reward, `localStorage.reward_unlocked = '1'` enables Connect without re-watching.

## Testing Tips

- Use test devices or test ads when developing; set `initializeForTesting: true` and pass test device IDs if needed.
- Verify the reward callback fires and the gate unlocks.
- If ads fail frequently during dev, temporarily set `REACT_APP_ADMOB_DEBUG_AUTO_UNLOCK=true` to bypass the gate while you diagnose.

## Policy Compliance

- Review AdMob policies: https://support.google.com/admob/answer/6128543
- Do not incentivize misleading behavior; clearly explain that watching an ad unlocks a feature.
- Avoid placing ads in disruptive positions; use rewarded format for voluntary unlocks.
- Ensure privacy disclosures and consent flows where required (GDPR/CCPA).

## Next Steps

- Configure test devices or use Google-provided test unit IDs during development.
- Consider frequency capping and graceful failure (e.g., allow limited free connects if ad fails).
- Add analytics on ad load/show/fail to monitor revenue and UX.

## CI Build Notes

- The GitHub Action at `.github/workflows/android-build.yml` installs `@capacitor-community/admob`, syncs Android, and injects the AdMob App ID into `AndroidManifest.xml` during the build.
- It builds a debug APK and uploads it as an artifact named `app-debug`. Download from the Actions run to test on device.

## Local Build Prereqs

- Ensure Node.js and npm (or Yarn) are installed and on PATH.
- From `frontend/`, run: `npm install`, then `npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor-community/admob`, `npm run build`, `npx cap add android`, and `npx cap sync android`.
- Open `frontend/android` in Android Studio, confirm `AndroidManifest.xml` contains the AdMob App ID meta-data, then build and run.
