import { Capacitor } from '@capacitor/core';
import { AdMob } from '@capacitor-community/admob';

const APP_ID = process.env.REACT_APP_ADMOB_APP_ID;
const REWARDED_INTERSTITIAL_ID = process.env.REACT_APP_ADMOB_REWARDED_INTERSTITIAL_UNIT_ID || process.env.REACT_APP_ADMOB_REWARDED_UNIT_ID;
const BANNER_ID = process.env.REACT_APP_ADMOB_BANNER_UNIT_ID;
const NATIVE_ADVANCED_ID = process.env.REACT_APP_ADMOB_NATIVE_ADVANCED_UNIT_ID;

export async function initAdMob() {
  try {
    const platform = Capacitor?.getPlatform?.() || 'web';
    if (platform !== 'android') return;
    await AdMob.initialize({
      appId: APP_ID,
      requestTrackingAuthorization: false,
      initializeForTesting: false,
    });
  } catch (_) {}
}

export async function showRewardedInterstitial() {
  try {
    const platform = Capacitor?.getPlatform?.() || 'web';
    if (platform !== 'android') return false;
    if (!REWARDED_INTERSTITIAL_ID) return false;
    await AdMob.createRewardedInterstitialAd({ adId: REWARDED_INTERSTITIAL_ID });
    const res = await AdMob.showRewardedInterstitialAd();
    return !!res?.adReward || !!res?.reward || true;
  } catch (_) {
    return false;
  }
}

export async function showBanner() {
  try {
    const platform = Capacitor?.getPlatform?.() || 'web';
    if (platform !== 'android') return;
    if (!BANNER_ID) return;
    await AdMob.showBanner({
      adId: BANNER_ID,
      position: 'BOTTOM_CENTER',
      size: 'ADAPTIVE_BANNER',
    });
  } catch (_) {}
}

export async function hideBanner() {
  try {
    const platform = Capacitor?.getPlatform?.() || 'web';
    if (platform !== 'android') return;
    await AdMob.hideBanner();
  } catch (_) {}
}

export async function showNativeAdvanced(opts = {}) {
  try {
    const platform = Capacitor?.getPlatform?.() || 'web';
    if (platform !== 'android') return false;
    if (!NATIVE_ADVANCED_ID) return false;
    const fn = AdMob?.showNativeAd;
    if (!fn) return false;
    await fn({ adId: NATIVE_ADVANCED_ID, position: opts.position || 'BOTTOM', adSize: opts.size || 'MEDIUM' });
    return true;
  } catch (_) {
    return false;
  }
}

