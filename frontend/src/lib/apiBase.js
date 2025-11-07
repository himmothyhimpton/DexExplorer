import { Capacitor } from '@capacitor/core';

function isAndroid() {
  try {
    const platform = Capacitor?.getPlatform?.() || 'web';
    return platform === 'android';
  } catch {
    return false;
  }
}

export function resolveBackendUrl() {
  const fromEnv = process.env.REACT_APP_BACKEND_URL;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();

  // On Android, "localhost" points to the device/emulator itself.
  // Use 10.0.2.2 to reach the host machine from the Android emulator.
  if (isAndroid()) {
    return 'http://10.0.2.2:8000';
  }

  // Default for web/desktop dev
  return 'http://localhost:8000';
}

export const API_BASE = `${resolveBackendUrl()}/api`;

