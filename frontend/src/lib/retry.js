// Simple retry helper with exponential backoff
// Usage: await retry(() => axios.get(url), { retries: 2, delay: 500 })
export async function retry(fn, options = {}) {
  const {
    retries = 2,
    delay = 500,
    factor = 1.3,
    onRetry = null,
  } = options;

  let attempt = 0;
  let lastError;
  while (attempt <= retries) {
    try {
      const res = await fn();
      return res;
    } catch (err) {
      lastError = err;
      // Do not retry on intentional cancellations (AbortController/axios cancel)
      const msg = (err && err.message) || '';
      const isCanceled = (err && (err.name === 'CanceledError' || err.name === 'AbortError'))
        || (err && err.code === 'ERR_CANCELED')
        || /aborted|canceled/i.test(msg);
      if (isCanceled) {
        break;
      }
      if (attempt < retries) {
        try { if (onRetry) onRetry({ error: err, attempt }); } catch (_) {}
        const waitMs = Math.round(delay * Math.pow(factor, attempt));
        await new Promise((r) => setTimeout(r, waitMs));
        attempt += 1;
        continue;
      }
      break;
    }
  }
  throw lastError;
}
