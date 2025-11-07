import { useCallback, useEffect, useState } from "react";

const TARGET_DEFAULT = Number(process.env.REACT_APP_TARGET_SPEED_MBPS) || 50;
const MIN_TEST_INTERVAL_MS = 30_000; // throttle repeated tests

export default function useSpeedMetrics() {
  const [currentMbps, setCurrentMbps] = useState(null);
  const [previousMbps, setPreviousMbps] = useState(() => {
    const raw = typeof window !== "undefined" ? localStorage.getItem("flux_prev_speed_mbps") : null;
    const n = raw ? Number(raw) : null;
    return isFinite(n) ? n : null;
  });
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [lastError, setLastError] = useState(null);
  const [lastTestAt, setLastTestAt] = useState(0);
  const [status, setStatus] = useState({
    online: typeof navigator !== "undefined" ? navigator.onLine : true,
    effectiveType: typeof navigator !== "undefined" && navigator.connection ? navigator.connection.effectiveType : null,
    rtt: typeof navigator !== "undefined" && navigator.connection ? navigator.connection.rtt : null,
  });

  const measureDownlinkAPI = () => {
    const conn = typeof navigator !== "undefined" ? navigator.connection : null;
    const downlink = conn && typeof conn.downlink === "number" ? conn.downlink : null;
    return downlink && downlink > 0 ? downlink : null;
  };

  const runSpeedTest = useCallback(async () => {
    const sizes = [100000, 250000, 1000000]; // 100KB..1MB
    for (const bytes of sizes) {
      const start = performance.now();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);
        const res = await fetch(`https://speed.cloudflare.com/__down?bytes=${bytes}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        await res.blob();
        clearTimeout(timeout);
        const durationSec = (performance.now() - start) / 1000;
        const mbps = (bytes * 8) / 1_000_000 / durationSec;
        if (mbps && isFinite(mbps)) return mbps;
      } catch (_e) {
        // ignore and try next size
      }
    }
    return null;
  }, []);

  const refresh = useCallback(async () => {
    // Throttle repeated tests
    const now = Date.now();
    if (now - lastTestAt < MIN_TEST_INTERVAL_MS && currentMbps !== null) {
      return; // skip frequent retests
    }

    // Update link status first
    setStatus({
      online: navigator.onLine,
      effectiveType: navigator.connection?.effectiveType || null,
      rtt: navigator.connection?.rtt || null,
    });

    // Skip remote test if offline
    if (!navigator.onLine) {
      setLastError("Offline: skipping speed test");
      return;
    }

    setIsMeasuring(true);
    setLastError(null);

    let mbps = measureDownlinkAPI();
    try {
      if (!mbps) mbps = await runSpeedTest();
    } catch (e) {
      setLastError(e?.message || "Speed test failed");
    } finally {
      setIsMeasuring(false);
      setLastTestAt(Date.now());
    }

    if (mbps && isFinite(mbps)) {
      if (currentMbps !== null && isFinite(currentMbps)) {
        setPreviousMbps(currentMbps);
      }
      setCurrentMbps(mbps);
      try {
        localStorage.setItem("flux_prev_speed_mbps", String(mbps));
      } catch (_e) {}
    }
  }, [currentMbps, lastTestAt, runSpeedTest]);

  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    if (navigator.connection?.addEventListener) {
      navigator.connection.addEventListener("change", onChange);
    }
    window.addEventListener("online", onChange);
    window.addEventListener("offline", onChange);
    return () => {
      if (navigator.connection?.removeEventListener) {
        navigator.connection.removeEventListener("change", onChange);
      }
      window.removeEventListener("online", onChange);
      window.removeEventListener("offline", onChange);
    };
  }, [refresh]);

  const goalMbps = TARGET_DEFAULT;

  return { currentMbps, previousMbps, goalMbps, status, refresh, isMeasuring, lastError };
}
