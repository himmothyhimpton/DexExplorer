import { Capacitor } from '@capacitor/core';

function isAndroid() {
  try {
    const platform = Capacitor?.getPlatform?.() || 'web';
    return platform === 'android';
  } catch {
    return false;
  }
}

function normalizeBase(url) {
  if (!url || typeof url !== 'string') return null;
  let u = url.trim();
  if (!/^https?:\/\//i.test(u)) return null; // require explicit scheme
  // strip trailing /api and trailing slash
  u = u.replace(/\/?api\/?$/i, '').replace(/\/+$/,'');
  return u;
}

function getOverride() {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem('DEX_BACKEND_URL') : null;
    const n = normalizeBase(raw);
    return n;
  } catch {
    return null;
  }
}

export function resolveBackendUrl() {
  const override = getOverride();
  if (override) return override;

  const fromEnv = process.env.REACT_APP_BACKEND_URL;
  if (fromEnv && fromEnv.trim().length > 0) {
    const n = normalizeBase(fromEnv.trim());
    if (n) return n;
  }

  // On Android, "localhost" points to the device/emulator itself.
  // Use 10.0.2.2 to reach the host machine from the Android emulator.
  if (isAndroid()) {
    return 'http://10.0.2.2:8000';
  }

  // Default for web/desktop dev
  return 'http://localhost:8000';
}

export function getApiBase() {
  const base = resolveBackendUrl();
  return `${base}/api`;
}

export function saveBackendOverride(url) {
  const n = normalizeBase(url);
  if (!n) throw new Error('Please enter a valid URL starting with http:// or https://');
  if (typeof window !== 'undefined') localStorage.setItem('DEX_BACKEND_URL', n);
  return `${n}/api`;
}

export function clearBackendOverride() {
  if (typeof window !== 'undefined') localStorage.removeItem('DEX_BACKEND_URL');
  return getApiBase();
}
