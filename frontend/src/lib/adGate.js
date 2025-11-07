import { Capacitor } from '@capacitor/core';
import { initAdMob, showRewardedInterstitial } from './admob';

export async function ensureRewardGate() {
  try {
    if (process.env.REACT_APP_ADMOB_DEBUG_AUTO_UNLOCK === 'true') {
      if (typeof window !== 'undefined') localStorage.setItem('reward_unlocked', '1');
      return true;
    }
    if (typeof window !== 'undefined' && localStorage.getItem('reward_unlocked') === '1') {
      return true;
    }

    const platform = Capacitor?.getPlatform?.() || 'web';
    if (platform === 'android') {
      await initAdMob();
      const ok = await showRewardedInterstitial();
      if (ok) {
        localStorage.setItem('reward_unlocked', '1');
        return true;
      }
      return false;
    }

    const ok = typeof window !== 'undefined' ? window.confirm('Watch a short ad to unlock advanced features?') : false;
    if (ok) {
      localStorage.setItem('reward_unlocked', '1');
      return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

export function resetRewardGate() {
  try {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('reward_unlocked');
    }
  } catch (_) {}
}
