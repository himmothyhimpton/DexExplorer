import axios from 'axios';
import { Capacitor } from '@capacitor/core';
import { Http as CapacitorHttp } from '@capacitor-community/http';

function isAndroid() {
  try {
    return (Capacitor?.getPlatform?.() || 'web') === 'android';
  } catch {
    return false;
  }
}

async function nativeRequest(method, url, data, config = {}) {
  const {
    headers = {},
    timeout = 15000,
    responseType = 'json',
    validateStatus,
    signal,
  } = config || {};

  if (signal && signal.aborted) {
    const err = new Error('Request aborted');
    err.name = 'AbortError';
    throw err;
  }

  // Map axios-like options to CapacitorHttp
  const opts = {
    url,
    method,
    headers,
    data,
    // CapacitorHttp uses separate connect/read timeouts; align both
    connectTimeout: typeof timeout === 'number' ? timeout : 15000,
    readTimeout: typeof timeout === 'number' ? timeout : 15000,
    responseType: responseType === 'text' ? 'text' : 'json',
  };

  const res = await CapacitorHttp.request(opts);

  // Respect axios-style validateStatus when provided
  if (typeof validateStatus === 'function') {
    const ok = validateStatus(res.status);
    if (!ok) {
      const err = new Error(`Request failed with status code ${res.status}`);
      err.response = res;
      err.config = { url, method };
      throw err;
    }
  }

  return res;
}

export const http = {
  async get(url, config = {}) {
    if (isAndroid() && CapacitorHttp) {
      return nativeRequest('GET', url, null, config);
    }
    return axios.get(url, config);
  },
  async post(url, data, config = {}) {
    if (isAndroid() && CapacitorHttp) {
      return nativeRequest('POST', url, data, config);
    }
    return axios.post(url, data, config);
  },
};
