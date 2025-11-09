import React, { useState, useEffect, useRef } from 'react';
import '@/App.css';
import { http } from '@/lib/http';
import { getApiBase, saveBackendOverride, clearBackendOverride, resolveBackendUrl } from '@/lib/apiBase';
import { Capacitor } from '@capacitor/core';
import { Http as CapacitorHttp } from '@capacitor-community/http';
import { Wifi, Zap, Globe, Lock, Activity, Satellite, Radio, Network, Info, Settings, ChevronLeft, ChevronRight, RotateCcw, Home as HomeIcon } from 'lucide-react';
import { ensureRewardGate } from '@/lib/adGate';
import { initAdMob, showBanner, hideBanner, showNativeAdvanced } from '@/lib/admob';
import { retry } from '@/lib/retry';
import LightningOverlay from '@/components/LightningOverlay';

// API base is derived at runtime via getApiBase() with optional user override

// Memoized iframe to keep resource loads alive across parent re-renders
const BrowserFrame = React.memo(({ content, url }) => {
  const iframeRef = useRef(null);
  const lastDoc = useRef('');
  const lastUrl = useRef('');
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    // Prefer srcdoc when content is present (proxied/Tor), else use direct src URL
    if (typeof content === 'string' && content.length > 0 && content !== lastDoc.current) {
      lastDoc.current = content;
      try {
        iframe.srcdoc = content;
      } catch {}
    } else if (typeof url === 'string' && url.length > 0 && url !== lastUrl.current) {
      lastUrl.current = url;
      try {
        iframe.src = url;
      } catch {}
    }
  }, [content, url]);
  return (
    <iframe
      ref={iframeRef}
      title="preview"
      sandbox="allow-same-origin allow-forms allow-scripts allow-top-navigation-by-user-activation"
      src={lastDoc.current ? undefined : (lastUrl.current || undefined)}
      srcDoc={lastDoc.current || undefined}
      className="w-full h-full rounded-lg bg-white"
    />
  );
});

function App() {
  const platform = (Capacitor?.getPlatform?.() || 'web');
  const isWebPlatform = platform === 'web';
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('idle');
  const [connections, setConnections] = useState([]);
  const [activeConnection, setActiveConnection] = useState(null);
  const [discoveredCount, setDiscoveredCount] = useState(0);
  const [browserUrl, setBrowserUrl] = useState(() => {
    const raw = typeof window !== 'undefined' ? localStorage.getItem('flux_browser_url') : null;
    return raw || 'https://duckduckgo.com/';
  });
  const [browserContent, setBrowserContent] = useState('');
  const [showBrowser, setShowBrowser] = useState(false);
  const [stats, setStats] = useState({
    active: 0,
    available: 0,
    latency: 0
  });
  const [summary, setSummary] = useState({ counts_by_type: {}, tested: [], recommendation: null });
  const [testedMap, setTestedMap] = useState({});
  const [showLegend, setShowLegend] = useState(false);
  const [incognito, setIncognito] = useState(false);
  // Runtime API base and Settings overlay state
  const [apiBase, setApiBase] = useState(() => getApiBase());
  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [backendInput, setBackendInput] = useState(() => resolveBackendUrl());
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [urlHistory, setUrlHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [auditUrl, setAuditUrl] = useState('');
  const [auditResult, setAuditResult] = useState(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState(null);
  const [auditErrorDetail, setAuditErrorDetail] = useState('');
  const [webrtcLeaks, setWebrtcLeaks] = useState([]);
  const [auditHistory, setAuditHistory] = useState(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('privacy_audit_history') : null;
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  // Connectivity feedback: track backend reachability for clear UI messaging
  const [backendError, setBackendError] = useState(false);
  const [backendErrorDetail, setBackendErrorDetail] = useState('');

  // Browser-first: require user to choose mode before showing browser
  const [browseMode, setBrowseMode] = useState(() => {
    const raw = typeof window !== 'undefined' ? localStorage.getItem('flux_browse_mode') : null;
    return raw === 'dark' || raw === 'light' ? raw : null;
  }); // 'light' | 'dark'

  // Section refs and smooth scroll helpers
  const browserSectionRef = useRef(null);
  const modeSectionRef = useRef(null);
  const scrollToBrowser = () => {
    if (browserSectionRef.current) {
      browserSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };
  const scrollToModeChooser = () => {
    if (modeSectionRef.current) {
      modeSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Persist mode and URL
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (browseMode) localStorage.setItem('flux_browse_mode', browseMode);
    }
  }, [browseMode]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
      }
    };
  }, []);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (browserUrl && !incognito) localStorage.setItem('flux_browser_url', browserUrl);
    }
  }, [browserUrl, incognito]);

  // Show intro on first run
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const seen = localStorage.getItem('dex_intro_seen');
    if (!seen) {
      const t = setTimeout(() => setShowAbout(true), 600);
      return () => clearTimeout(t);
    }
  }, []);

  // When mode changes, just set the default homepage and reset incognito.
  // Do NOT auto-open the browser here; handleModeSelect manages connect + open.
  useEffect(() => {
    if (!browseMode) return;
    if (browseMode === 'light') setBrowserUrl(LIGHT_HOME);
    if (browseMode === 'dark') setBrowserUrl(DARK_HOME);
    setIncognito(false);
  }, [browseMode]);

  // Check backend status once on load; debounce and cancel on HMR
  useEffect(() => {
    const controller = new AbortController();
    statusControllerRef.current = controller;
    const t = setTimeout(() => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      checkStatus({ signal: controller.signal, timeout: 12000 });
    }, process.env.NODE_ENV === 'development' ? 350 : 0);
    return () => {
      clearTimeout(t);
      try { controller.abort(); } catch {}
      statusControllerRef.current = null;
    };
  }, []);

  // Pull diagnostics summary early; debounce and cancel on HMR
  useEffect(() => {
    const controller = new AbortController();
    summaryControllerRef.current = controller;
    const t = setTimeout(() => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      loadSummary({ signal: controller.signal, timeout: 12000, retryDelay: process.env.NODE_ENV === 'development' ? 600 : 500 });
    }, process.env.NODE_ENV === 'development' ? 350 : 0);
    return () => {
      clearTimeout(t);
      try { controller.abort(); } catch {}
      summaryControllerRef.current = null;
    };
  }, []);

  // Android-only: when backend errors persist, populate a local diagnostics summary
  useEffect(() => {
    (async () => {
      const platform = (Capacitor?.getPlatform?.() || 'web');
      if (platform !== 'android' || !CapacitorHttp) return;
      if (!backendError) return;
      // Avoid overwriting a populated summary
      const hasSummary = summary && ((Array.isArray(summary.tested) && summary.tested.length > 0) || summary.recommendation);
      if (hasSummary) return;
      try {
        const local = await buildLocalSummary();
        setSummary(local);
        setTestedMap({});
        setBackendError(false);
        setBackendErrorDetail('');
      } catch (_) {}
    })();
  }, [backendError, apiBase]);

  // Initialize AdMob and place ads on home
  useEffect(() => {
    (async () => {
      await initAdMob();
      // Try native advanced; if unsupported, fall back to banner
      const ok = await showNativeAdvanced({ position: 'BOTTOM', size: 'MEDIUM' });
      if (!ok) await showBanner();
    })();
  }, []);

  useEffect(() => {
    if (!connected) return;
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, [connected]);

  const checkStatus = async (opts = {}) => {
    const { signal, timeout = 10000 } = opts || {};
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      // Avoid premature aborts; allow the backend a bit longer in dev
      const response = await http.get(`${apiBase}/status`, { timeout, signal });
      const data = response.data;
      setStats({
        active: data.active_connections,
        available: data.available_connections
      });
      if (data.active_connections > 0) {
        setConnected(true);
        setActiveConnection(data.connections[0]);
      }
      // Clear connectivity error on successful status check
      setBackendError(false);
      setBackendErrorDetail('');
    } catch (error) {
      const emsg = error?.message || '';
      // Treat cancellations/aborts as benign in dev
      if (error?.name === 'CanceledError' || error?.name === 'AbortError' || error?.code === 'ERR_CANCELED' || /aborted|canceled/i.test(emsg)) {
        if (process.env.NODE_ENV === 'development') {
          console.debug('Status check aborted');
        }
        return;
      }
      // Surface a clear backend connectivity error for testers
      if (typeof navigator !== 'undefined' && navigator.onLine !== false) {
        setBackendError(true);
        setBackendErrorDetail(error?.message || String(error));
      }
      // Fail quietly in dev; surface in production
      if (process.env.NODE_ENV === 'development') {
        console.debug('Status check failed:', error?.message || error);
      } else {
        console.error('Status check failed:', error);
      }
    }
  };

  const discoverConnections = async () => {
    setStatus('discovering');
    try {
      const response = await retry(
        () => http.get(`${apiBase}/discover`, { timeout: 12000 }),
        { retries: 1, delay: 700 }
      );
      setConnections(response.data);
      setDiscoveredCount(response.data.length);
      setStatus('discovered');
      // Pull diagnostics summary right after discovery for latency and recommendation
      await loadSummary();
    } catch (error) {
      const emsg = error?.message || '';
      if (error?.name === 'CanceledError' || error?.code === 'ERR_CANCELED' || /aborted|canceled/i.test(emsg)) {
        if (process.env.NODE_ENV === 'development') {
          console.debug('Discovery aborted');
        }
        return;
      }
      if (process.env.NODE_ENV === 'development') {
        console.debug('Discovery failed:', error?.message || error);
      } else {
        console.error('Discovery failed:', error);
      }
      setStatus('error');
    }
  };

  const loadSummary = async (opts = {}) => {
    const { signal, timeout = 10000, retryDelay = 500 } = opts || {};
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      const res = await retry(() => http.get(`${apiBase}/diagnostics/summary`, { timeout, signal }), { retries: 1, delay: retryDelay });
      const data = res.data || {};
      setSummary(data);
      // Build a quick lookup map by endpoint for latency and success flags
      const map = {};
      (data.tested || []).forEach((t) => {
        if (t && t.endpoint) {
          map[t.endpoint] = { latency: t.latency, success: t.tested_success };
        }
      });
      setTestedMap(map);
      // Clear backend error if summary succeeds
      setBackendError(false);
      setBackendErrorDetail('');
    } catch (e) {
      const emsg = e?.message || '';
      if (e?.name === 'CanceledError' || e?.name === 'AbortError' || e?.code === 'ERR_CANCELED' || /aborted|canceled/i.test(emsg)) {
        if (process.env.NODE_ENV === 'development') {
          console.debug('Summary fetch aborted');
        }
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.onLine !== false) {
        setBackendError(true);
        setBackendErrorDetail(e?.message || String(e));
      }
      if (process.env.NODE_ENV === 'development') {
        console.debug('Summary fetch failed:', e?.message || e);
      } else {
        console.error('Summary fetch failed:', e);
      }
    }
  };

  const connectToInternet = async () => {
    setConnecting(true);
    setStatus('connecting');
    
    try {
      // Guard: device offline
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new Error('No network detected');
      }
      // Pull diagnostics first (includes discovery internally) to reduce duplicate calls
      try {
        const res = await retry(() => http.get(`${apiBase}/diagnostics/summary`, { timeout: 12000 }), { retries: 1, delay: 600 });
        const data = res.data || {};
        setSummary(data);
        const map = {};
        (data.tested || []).forEach((t) => { if (t && t.endpoint) map[t.endpoint] = { latency: t.latency, success: t.tested_success }; });
        setTestedMap(map);
        // Treat tested entries as discovered candidates for UI purposes
        setConnections(data.tested || []);
        setDiscoveredCount((data.tested || []).length);
        setStatus('discovered');
      } catch (_) {
        // If diagnostics not available, continue; backend /connect will discover
      }
      
      // Then auto-connect to best one
      const response = await retry(() => http.post(`${apiBase}/connect`, null, { timeout: 15000 }), { retries: 1, delay: 1000 });
      
      if (response.data.success || response.data.connection) {
        setConnected(true);
        setActiveConnection(response.data.connection);
        setStatus('connected');
        await checkStatus();
        // Show mode chooser before browser and scroll to it
        setShowBrowser(false);
        setTimeout(scrollToModeChooser, 50);
      } else {
        setStatus('failed');
      }
    } catch (error) {
      const emsg = error?.message || '';
      if (error?.name === 'CanceledError' || error?.code === 'ERR_CANCELED' || /aborted|canceled/i.test(emsg)) {
        if (process.env.NODE_ENV === 'development') {
          console.debug('Connection aborted');
        }
      } else {
        // Android fallback: mark as connected using device route to keep UX smooth
        const platform = (Capacitor?.getPlatform?.() || 'web');
        if (platform === 'android' && CapacitorHttp) {
          try {
            const online = await probeConnectivity();
            if (!online) throw new Error('Offline');
            const latency = await measureLatency();
            const leaks = await checkWebRtcLeak();
            const deviceConn = {
              type: 'direct',
              label: 'Device network',
              anonymity_level: leaks.length === 0 ? 2 : 1,
              endpoint: 'device://network',
              latency: latency || null,
            };
            setConnected(true);
            setActiveConnection(deviceConn);
            setConnections([deviceConn]);
            setDiscoveredCount(1);
            setSummary(await buildLocalSummary());
            setStatus('connected');
            // Keep the browser hidden until user chooses mode
            setShowBrowser(false);
            setTimeout(scrollToModeChooser, 50);
            return;
          } catch (fallbackErr) {
            if (process.env.NODE_ENV === 'development') {
              console.debug('Android device-connect fallback failed:', fallbackErr?.message || fallbackErr);
            }
          }
        }
        if (process.env.NODE_ENV === 'development') {
          console.debug('Connection failed:', error?.message || error);
        } else {
          console.error('Connection failed:', error);
        }
        setStatus('failed');
      }
    } finally {
      setConnecting(false);
    }
  };

  // Controllers to cancel in-flight requests to avoid noisy aborts
  const pageControllerRef = useRef(null);
  const connectControllerRef = useRef(null);
  const statusControllerRef = useRef(null);
  const summaryControllerRef = useRef(null);

  // Simple URL history helpers for overlay toolbar
  const addToHistory = (url) => {
    if (!url || typeof url !== 'string') return;
    setUrlHistory((prev) => {
      const upto = historyIndex >= 0 ? prev.slice(0, historyIndex + 1) : [];
      const next = [...upto, url];
      // Keep index in sync with new list
      setHistoryIndex(next.length - 1);
      return next;
    });
  };
  const handleBack = async () => {
    if (historyIndex <= 0) return;
    const newIndex = historyIndex - 1;
    const target = urlHistory[newIndex];
    setHistoryIndex(newIndex);
    if (target) {
      setBrowserUrl(target);
      await loadWebpage(target);
    }
  };
  const handleForward = async () => {
    if (historyIndex < 0) return;
    const newIndex = historyIndex + 1;
    if (newIndex >= urlHistory.length) return;
    const target = urlHistory[newIndex];
    setHistoryIndex(newIndex);
    if (target) {
      setBrowserUrl(target);
      await loadWebpage(target);
    }
  };
  const handleReload = async () => {
    if (!browserUrl) return;
    await loadWebpage(browserUrl);
  };
  const handleHome = async () => {
    const homepage = browseMode === 'dark' ? DARK_HOME : LIGHT_HOME;
    setBrowserUrl(homepage);
    await loadWebpage(homepage);
  };

  const loadWebpage = async (urlOverride = null) => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      alert('No network detected. Check Wi‑Fi or Ethernet and try again.');
      return;
    }
    // Enforce mode-specific requirements for dark mode: Tor is required for .onion links
    if (browseMode === 'dark' && activeConnection?.type !== 'tor') {
      const urlLower = (urlOverride || browserUrl || '').toLowerCase();
      if (urlLower.includes('.onion')) {
        setStatus('failed');
        try {
          const { resolveBackendUrl } = await import('./lib/apiBase.js');
          const guideUrl = `${resolveBackendUrl()}/orbot-setup`;
          setBrowserContent(`<div class="p-4 text-amber-700">Tor route required to load .onion links. Connect to a Tor source, then try again. <a href="${guideUrl}" target="_blank" rel="noopener" class="underline">Orbot setup guide</a></div>`);
        } catch(e) {
          setBrowserContent('<div class="p-4 text-amber-700">Tor route required to load .onion links. Connect to a Tor source, then try again.</div>');
        }
        setShowBrowser(true);
        return;
      }
    }
    // Sanitize argument to avoid passing event objects into request body
    const isEventLike = urlOverride && typeof urlOverride === 'object' && (
      'nativeEvent' in urlOverride || 'target' in urlOverride || 'currentTarget' in urlOverride
    );
    const candidateUrl = (typeof urlOverride === 'string' && urlOverride) || (isEventLike ? null : urlOverride);
    const urlToLoad = typeof candidateUrl === 'string' ? candidateUrl : browserUrl;
    if (!urlToLoad || typeof urlToLoad !== 'string' || urlToLoad.trim().length === 0) {
      setStatus('failed');
      setBrowserContent('<div class="p-4 text-red-700">Please enter a valid URL.</div>');
      setShowBrowser(true);
      return;
    }
    // For sites that block embedding, detect via HEAD and fallback to proxy srcdoc
    let mustUseProxy = false;
    try {
      const headRes = await retry(
        () => http.post(
          `${apiBase}/proxy`,
          { url: urlToLoad, method: 'HEAD', headers: { 'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } },
          { timeout: 7000 }
        ),
        { retries: 0 }
      );
      const rawHeaders = (headRes?.data?.headers) || {};
      const headers = {};
      Object.keys(rawHeaders).forEach((k) => { headers[(k || '').toLowerCase()] = rawHeaders[k]; });
      const xfo = headers['x-frame-options'] || '';
      const csp = headers['content-security-policy'] || '';
      if (/deny|sameorigin/i.test(xfo) || /frame-ancestors/i.test(csp)) {
        mustUseProxy = true;
      }
    } catch (_) {}

    // If we are on a direct/wifi/vpn route, prefer a real iframe src load unless blocked
    const useProxy = mustUseProxy || (activeConnection?.type === 'tor') || (activeConnection?.type === 'proxy');
    if (!useProxy) {
      setBrowserContent('');
      setBrowserUrl(urlToLoad);
      setShowBrowser(true);
      setStatus('browsing');
      addToHistory(urlToLoad);
      return;
    }

    setStatus('loading');
    // Cancel any in-flight page load and start a fresh controller
    try { pageControllerRef.current?.abort?.(); } catch {}
    pageControllerRef.current = new AbortController();
    try {
      // Read raw text to avoid implicit JSON.parse throwing on HTML responses
      const response = await retry(
        () => http.post(
          `${apiBase}/proxy`,
          { url: urlToLoad, method: 'GET' },
          {
            timeout: 12000,
            responseType: 'text',
            validateStatus: (status) => status >= 200 && status < 500,
            signal: pageControllerRef.current.signal,
          }
        ),
        { retries: 1, delay: 700 }
      );

      const raw = response?.data;
      let payload = null;
      if (raw && typeof raw === 'string') {
        try {
          payload = JSON.parse(raw);
        } catch (parseErr) {
          // Helpful guidance when server returned HTML instead of JSON
          const startsWithHtml = raw.trim().startsWith('<');
          const hint = startsWithHtml
            ? 'Server returned HTML instead of JSON. Check backend URL and /api/proxy route.'
            : 'Server returned unexpected non-JSON payload.';
          const snippet = raw.trim().slice(0, 180).replace(/</g, '&lt;');
          setBrowserContent(
            `<div class="p-4 text-red-700">Failed to load: ${parseErr.message}. ${hint}<div class="mt-2 text-xs text-gray-700">Snippet: ${snippet}...</div></div>`
          );
          setShowBrowser(true);
          setStatus('error');
          return;
        }
      } else {
        payload = raw;
      }

      const base64 = payload?.content || payload?.body || '';
      let decoded = base64 ? atob(base64) : '<div>Empty response</div>';
      // Inject a <base> tag so relative assets resolve to the correct origin,
      // avoiding the dev server returning index.html for script/css requests.
      try {
        const origin = new URL(urlToLoad).origin + '/';
        if (/<head[^>]*>/i.test(decoded)) {
          decoded = decoded.replace(/<head[^>]*>/i, (m) => `${m}<base href="${origin}">`);
        } else if (/<html[^>]*>/i.test(decoded)) {
          decoded = decoded.replace(/<html[^>]*>/i, (m) => `${m}<head><base href="${origin}"></head>`);
        } else {
          decoded = `<head><base href="${origin}"></head>` + decoded;
        }
      } catch {}

      // Neutralize History API inside srcdoc to avoid SecurityError from cross-origin URLs
      try {
        const historyStub = '<script>(function(){try{var h=window.history; h.pushState=function(){ }; h.replaceState=function(){ }; }catch(e){}})();<\/script>';
        if (/<head[^>]*>/i.test(decoded)) {
          decoded = decoded.replace(/<head[^>]*>/i, (m) => `${m}${historyStub}`);
        } else if (/<html[^>]*>/i.test(decoded)) {
          decoded = decoded.replace(/<html[^>]*>/i, (m) => `${m}<head>${historyStub}</head>`);
        } else {
          decoded = `<head>${historyStub}</head>` + decoded;
        }
      } catch {}

      // Intercept window.open and _blank anchors to keep navigation inside overlay
      try {
        const navStub = '<script>(function(){try{var open=window.open;window.open=function(u){try{window.parent.postMessage({type:\"flux:navigate\",url:u},\"*\");}catch(e){} return null;};document.addEventListener("click",function(e){var a=e.target.closest("a");if(a&&a.target==="_blank"&&a.href){e.preventDefault();try{window.parent.postMessage({type:\"flux:navigate\",url:a.href},\"*\");}catch(e){} }},true);}catch(e){} })();<\/script>';
        if (/<head[^>]*>/i.test(decoded)) {
          decoded = decoded.replace(/<head[^>]*>/i, (m) => `${m}${navStub}`);
        } else if (/<html[^>]*>/i.test(decoded)) {
          decoded = decoded.replace(/<html[^>]*>/i, (m) => `${m}<head>${navStub}</head>`);
        } else {
          decoded = `<head>${navStub}</head>` + decoded;
        }
      } catch {}
      setBrowserContent(decoded);
      setBrowserUrl(urlToLoad);
      setShowBrowser(true);
      setStatus('browsing');
      addToHistory(urlToLoad);
    } catch (error) {
      // Ignore intentional cancellations (new request supersedes prior)
      const emsg = error?.message || '';
      if (error?.name === 'CanceledError' || /aborted|canceled/i.test(emsg)) {
        console.debug('Page load aborted (superseded by a new request)');
        return;
      }
      console.error('Failed to load webpage:', error);
      const isSyntax = /Unexpected token/.test(error?.message || '');
      const mapped = mapNetworkError(error);
      const msg = error?.message?.includes('timeout')
        ? 'Request timed out. Try again or switch route.'
        : isSyntax
          ? "Unexpected token '<' usually means HTML was returned where JSON was expected. Confirm backend is running on the configured API base."
          : mapped.user || `Failed to load: ${error.message}`;
      const detail = mapped.detail ? `<div class="mt-1 text-xs opacity-80">${mapped.detail}</div>` : '';
      setBrowserContent(`<div class="p-4 text-red-700">${msg}${detail}</div>`);
      setShowBrowser(true);
      setStatus('error');
    }
  };

  // Privacy helpers
  const normalizeUrl = (u) => {
    if (!u) return '';
    const trimmed = String(u).trim();
    if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
    return trimmed;
  };

  // Network helpers
  const UA = 'Mozilla/5.0 (Linux; Android) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Mobile Safari/537.36 DexAudit/1.1';
  const mapNetworkError = (err) => {
    const raw = String((err && (err.message || err.error)) || '').toLowerCase();
    if (/name_not_resolved|unknownhost|enotfound|dns|no address associated/i.test(raw)) {
      return { user: 'DNS lookup failed for this domain.', detail: raw };
    }
    if (/timeout|timed out|etimedout/i.test(raw)) {
      return { user: 'Request timed out. Check connectivity or try again.', detail: raw };
    }
    if (/ssl|handshake|certificate|trust anchor|peer not authenticated/i.test(raw)) {
      return { user: 'TLS handshake failed (certificate or protocol).', detail: raw };
    }
    if (/connection refused|econnrefused|network is unreachable/i.test(raw)) {
      return { user: 'Connection refused or unreachable.', detail: raw };
    }
    if (/blocked|not allowed|cleartext/i.test(raw)) {
      return { user: 'Cleartext HTTP blocked. Use https://', detail: raw };
    }
    return { user: 'Network error', detail: raw };
  };
  const probeConnectivity = async () => {
    // Browser-level quick check
    if (typeof navigator !== 'undefined' && navigator.onLine) return true;
    const endpoints = [
      'https://connectivitycheck.gstatic.com/generate_204',
      'https://www.google.com/generate_204',
      'https://httpbin.org/status/204',
      'https://1.1.1.1/cdn-cgi/trace',
      'https://example.com'
    ];
    for (const ep of endpoints) {
      try {
        const r = await http.get(ep, { timeout: 2500, headers: { 'user-agent': UA } });
        const status = r?.status;
        if (status && status >= 200 && status < 400) return true;
      } catch (_) {}
    }
    return false;
  };

  // Measure simple network latency using a 204 endpoint
  const measureLatency = async () => {
    const ep = 'https://connectivitycheck.gstatic.com/generate_204';
    try {
      const start = Date.now();
      const r = await http.get(ep, { timeout: 4000, headers: { 'user-agent': UA } });
      if (r && r.status && r.status >= 200 && r.status < 400) {
        return Math.max(0, Date.now() - start);
      }
    } catch (_) {}
    return null;
  };

  // Local diagnostics summary (Android-only fallback)
  const buildLocalSummary = async () => {
    try {
      const online = await probeConnectivity();
      const latency = online ? await measureLatency() : null;
      const leaks = await checkWebRtcLeak();
      // Derive a simple anonymity level based on local signals
      // 1: low, 2: moderate, 3: high, 4: max
      const anonymityLevel = leaks.length === 0 ? 2 : 1;
      const recommendation = { type: 'device', anonymity_level: anonymityLevel, latency };
      return {
        recommendation,
        tested: [],
        tor_compare: { available: false },
        webrtc_leaks: leaks,
      };
    } catch {
      return {
        recommendation: { type: 'device', anonymity_level: 1, latency: null },
        tested: [],
        tor_compare: { available: false },
        webrtc_leaks: [],
      };
    }
  };

  const persistHistory = (url) => {
    if (!url) return;
    const next = [url, ...auditHistory.filter((u) => u !== url)].slice(0, 5);
    setAuditHistory(next);
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem('privacy_audit_history', JSON.stringify(next));
      }
    } catch {}
  };

  const checkWebRtcLeak = async () => {
    try {
      const rtc = new RTCPeerConnection({ iceServers: [] });
      rtc.createDataChannel('check');
      const offer = await rtc.createOffer();
      await rtc.setLocalDescription(offer);
      const ips = new Set();
      return await new Promise((resolve) => {
        const timeout = setTimeout(() => { try { rtc.close(); } catch {} resolve(Array.from(ips)); }, 4000);
        rtc.onicecandidate = (ev) => {
          if (ev && ev.candidate && ev.candidate.candidate) {
            const cand = ev.candidate.candidate;
            const m = cand.match(/(\b(?:\d{1,3}\.){3}\d{1,3}\b|[a-fA-F0-9:]{2,})/);
            if (m && m[1]) ips.add(m[1]);
          } else {
            clearTimeout(timeout);
            try { rtc.close(); } catch {}
            resolve(Array.from(ips));
          }
        };
      });
    } catch {
      return [];
    }
  };

  const missingHeaderRecommendations = (headers) => {
    const h = Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [String(k).toLowerCase(), v]));
    const recs = [];
    if (!h['strict-transport-security']) {
      recs.push('Add HSTS: strict-transport-security: max-age=31536000; includeSubDomains; preload');
    }
    if (!h['content-security-policy']) {
      recs.push("Add CSP: content-security-policy with 'default-src' and 'frame-ancestors'");
    }
    if (!h['referrer-policy']) {
      recs.push('Add Referrer-Policy: no-referrer or same-origin');
    }
    if (!h['permissions-policy']) {
      recs.push('Add Permissions-Policy: disable camera, microphone, geolocation by default');
    }
    if (!h['x-frame-options'] && !h['content-security-policy']) {
      recs.push('Add X-Frame-Options: DENY (or CSP frame-ancestors)');
    }
    if (!h['x-content-type-options']) {
      recs.push('Add X-Content-Type-Options: nosniff');
    }
    return recs;
  };

  // Direct Android audit helper (bypasses backend)
  const runDirectAudit = async (url) => {
    try {
      // Quick connectivity probe to avoid generic errors
      const connected = await probeConnectivity();
      if (!connected) {
        setAuditError('Connectivity check failed — attempting direct request.');
        setAuditErrorDetail('Network may block connectivity probes. If behind captive portal/VPN, open a browser and complete login, then retry.');
        // Continue with audit attempt instead of exiting
      }
      // Prefer HEAD; if blocked, fallback to GET
      let resp;
      try {
        resp = await CapacitorHttp.request({
          url,
          method: 'HEAD',
          headers: { 'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'user-agent': UA },
          connectTimeout: 10000,
          readTimeout: 10000,
          responseType: 'json',
        });
      } catch (_) {
        resp = await CapacitorHttp.request({
          url,
          method: 'GET',
          headers: { 'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'user-agent': UA },
          connectTimeout: 10000,
          readTimeout: 10000,
          responseType: 'text',
        });
      }

      const hdrsObj = Object.fromEntries(Object.entries(resp?.headers || {}).map(([k, v]) => [String(k).toLowerCase(), v]));
      const setCookie = hdrsObj['set-cookie'] || '';
      const cookies = setCookie ? String(setCookie).split('\n').map((c) => c.trim()).filter(Boolean) : [];
      let cookieSecure = true;
      for (const c of cookies) {
        if (!/\bSecure\b/i.test(c)) { cookieSecure = false; break; }
      }
      const headerSignals = {
        hsts: 'strict-transport-security' in hdrsObj,
        csp: 'content-security-policy' in hdrsObj,
        referrer_policy: 'referrer-policy' in hdrsObj,
        permissions_policy: 'permissions-policy' in hdrsObj,
        x_frame_options: 'x-frame-options' in hdrsObj,
        set_cookie_secure: cookieSecure,
      };
      const httpsOnly = /^https:/i.test(url);
      const onionLoc = hdrsObj['onion-location'] || hdrsObj['onion-location'];
      // Simple grade heuristic (aligns with backend)
      let score = 0;
      if (httpsOnly) score += 1;
      if (headerSignals.hsts) score += 1;
      if (headerSignals.csp) score += 1;
      if (headerSignals.referrer_policy) score += 1;
      if (headerSignals.permissions_policy) score += 1;
      if (headerSignals.x_frame_options) score += 1;
      if (headerSignals.set_cookie_secure) score += 1;
      const grade = score >= 6 ? 'A' : (score >= 4 ? 'B' : 'C');

      const leaks = await checkWebRtcLeak();
      setAuditResult({
        url,
        result: {
          https_only: httpsOnly,
          redirects: 0,
          headers: headerSignals,
          onion_location: onionLoc || null,
        },
        grade,
        tor_compare: { available: false },
      });
      setWebrtcLeaks(leaks);
      persistHistory(url);
      setAuditError(null);
      setAuditErrorDetail('');
    } catch (androidErr) {
      const mapped = mapNetworkError(androidErr);
      setAuditError(mapped.user);
      setAuditErrorDetail(mapped.detail);
    }
  };

  // Privacy Audit runner
  const runPrivacyAudit = async (target = null) => {
    const raw = target ?? auditUrl;
    if (!raw || typeof raw !== 'string') return;
    const url = normalizeUrl(raw);
    setAuditLoading(true);
    setAuditError(null);
    setAuditResult(null);
    setWebrtcLeaks([]);
    try {
      // Android: always use direct audit via CapacitorHttp — no backend required
      const platformNow = (Capacitor?.getPlatform?.() || 'web');
      if (platformNow === 'android' && CapacitorHttp) {
        await runDirectAudit(url);
        setAuditLoading(false);
        return;
      }

      const [res, leaks] = await Promise.all([
        http.get(`${apiBase}/privacy/audit`, { params: { url }, timeout: 15000 }),
        checkWebRtcLeak(),
      ]);
      setAuditResult(res.data);
      setWebrtcLeaks(leaks);
      persistHistory(url);
    } catch (e) {
      // Backend unreachable or route missing? Fallback on Android: audit directly via CapacitorHttp
      const isAndroid = (Capacitor?.getPlatform?.() || 'web') === 'android';
      if (isAndroid && CapacitorHttp) {
        try {
          // Prefer HEAD; some sites block HEAD, so fallback to GET
          let resp;
          try {
            resp = await CapacitorHttp.request({
              url,
              method: 'HEAD',
              headers: { 'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'user-agent': UA },
              connectTimeout: 10000,
              readTimeout: 10000,
              responseType: 'json',
            });
          } catch (headErr) {
            resp = await CapacitorHttp.request({
              url,
              method: 'GET',
              headers: { 'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'user-agent': UA },
              connectTimeout: 10000,
              readTimeout: 10000,
              responseType: 'text',
            });
          }

          const hdrsObj = Object.fromEntries(Object.entries(resp?.headers || {}).map(([k, v]) => [String(k).toLowerCase(), v]));
          const setCookie = hdrsObj['set-cookie'] || '';
          const cookies = setCookie ? String(setCookie).split('\n').map((c) => c.trim()).filter(Boolean) : [];
          let cookieSecure = true;
          for (const c of cookies) {
            if (!/\bSecure\b/i.test(c)) { cookieSecure = false; break; }
          }
          const headerSignals = {
            hsts: 'strict-transport-security' in hdrsObj,
            csp: 'content-security-policy' in hdrsObj,
            referrer_policy: 'referrer-policy' in hdrsObj,
            permissions_policy: 'permissions-policy' in hdrsObj,
            x_frame_options: 'x-frame-options' in hdrsObj,
            set_cookie_secure: cookieSecure,
          };
          const httpsOnly = /^https:/i.test(url);
          const onionLoc = hdrsObj['onion-location'] || hdrsObj['onion-location'];
          // Simple grade heuristic (aligns with backend)
          let score = 0;
          if (httpsOnly) score += 1;
          if (headerSignals.hsts) score += 1;
          if (headerSignals.csp) score += 1;
          if (headerSignals.referrer_policy) score += 1;
          if (headerSignals.permissions_policy) score += 1;
          if (headerSignals.x_frame_options) score += 1;
          if (headerSignals.set_cookie_secure) score += 1;
          const grade = score >= 6 ? 'A' : (score >= 4 ? 'B' : 'C');

          const leaks = await checkWebRtcLeak();
          setAuditResult({
            url,
            result: {
              https_only: httpsOnly,
              redirects: 0,
              headers: headerSignals,
              onion_location: onionLoc || null,
            },
            grade,
            tor_compare: { available: false },
          });
          setWebrtcLeaks(leaks);
          persistHistory(url);
          setAuditError(null);
          setAuditErrorDetail('');
        } catch (androidErr) {
          const mapped = mapNetworkError(androidErr);
          setAuditError(mapped.user);
          setAuditErrorDetail(mapped.detail);
        }
      } else {
        const mapped = mapNetworkError(e);
        setAuditError(mapped.user);
        setAuditErrorDetail(mapped.detail);
      }
    } finally {
      setAuditLoading(false);
    }
  };

  // Listen for navigation messages from iframe srcdoc to load inside overlay
  useEffect(() => {
    const onMsg = (e) => {
      const d = e?.data || {};
      if (d && d.type === 'flux:navigate' && typeof d.url === 'string') {
        setBrowserUrl(d.url);
        loadWebpage(d.url);
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('message', onMsg);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('message', onMsg);
      }
    };
  }, []);

  // Hide banner/native when browser overlay is visible; show when hidden
  useEffect(() => {
    (async () => {
      if (showBrowser) {
        await showBanner();
      } else {
        const ok = await showNativeAdvanced({ position: 'BOTTOM', size: 'MEDIUM' });
        if (!ok) await showBanner();
      }
    })();
  }, [showBrowser]);

  // Mode-aware connection helpers
  const getRequirementsForMode = (mode) => {
    if (mode === 'dark') {
      return { requiredTypes: ['tor'], homepage: DARK_HOME };
    }
    // default to light (Normal)
    return { requiredTypes: ['direct', 'wifi', 'vpn', 'proxy'], homepage: LIGHT_HOME };
  };

  const verifyTargetAvailability = async (url) => {
    try {
      const res = await retry(
        () => http.post(
          `${apiBase}/proxy`,
          { url, method: 'HEAD', headers: { 'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } },
          { timeout: 10000 }
        ),
        { retries: 1, delay: 500 }
      );
      const status = res?.data?.status ?? 0;
      // Consider non-5xx responses as available; many sites return 405 for HEAD
      return status >= 200 && status < 500;
    } catch (e) {
      // Treat aborted/canceled requests as unknown availability rather than failure
      const msg = e?.message || '';
      if (/ABORTED|canceled/i.test(msg)) return true;
      return false;
    }
  };

  const connectForMode = async (mode) => {
    if (!mode) {
      // No mode chosen; nudge user to choose
      setShowBrowser(false);
      setTimeout(scrollToModeChooser, 50);
      return;
    }
    // Cancel any in-flight connect/discover/diagnostics
    try { connectControllerRef.current?.abort?.(); } catch {}
    connectControllerRef.current = new AbortController();
    const req = getRequirementsForMode(mode);
    setConnecting(true);
    setStatus('connecting');
    try {
      // Guard: device offline
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new Error('No network detected');
      }
      // Pull diagnostics first (includes discovery internally) to reduce duplicate calls
      let testedMapLocal = {};
      let discovered = [];
      try {
        const diag = await retry(
          () => http.get(`${apiBase}/diagnostics/summary`, { timeout: 12000, signal: connectControllerRef.current.signal }),
          { retries: 1, delay: 600 }
        );
        const tested = diag.data?.tested || [];
        tested.forEach((t) => {
          if (t && t.endpoint) testedMapLocal[t.endpoint] = { latency: t.latency, success: t.tested_success };
        });
        setSummary(diag.data || {});
        setTestedMap(testedMapLocal);
        discovered = tested;
        setConnections(discovered);
        setDiscoveredCount(discovered.length);
        setStatus('discovered');
      } catch (e) {
        // Fallback to explicit discovery only if diagnostics failed
        try {
          const disc = await retry(
            () => http.get(`${apiBase}/discover`, { timeout: 8000, signal: connectControllerRef.current.signal }),
            { retries: 0 }
          );
          discovered = disc.data || [];
          setConnections(discovered);
          setDiscoveredCount(discovered.length);
          setStatus('discovered');
        } catch (_) {}
      }

      // Filter to mode-required types
      const candidates = (discovered || []).filter((c) => req.requiredTypes.includes(c.type));
      if (candidates.length === 0) {
        setStatus('failed');
        // Keep browser visible with guidance
        setShowBrowser(true);
        setBrowserContent('<div class="p-4 text-amber-700">Required route not found for the selected mode. Try discovering again or pick a matching source below.</div>');
        return;
      }

      // Prefer tested-success with best latency; for dark prefer higher anonymity
      const scored = candidates.map((c) => {
        const t = testedMapLocal[c.endpoint] || {};
        return {
          conn: c,
          success: !!t.success,
          latency: typeof t.latency === 'number' ? t.latency : Infinity,
          anonymity: c.anonymity_level || 1,
        };
      });

      let best;
      const successGroup = scored.filter((s) => s.success);
      if (successGroup.length > 0) {
        if (mode === 'dark') {
          best = successGroup.sort((a, b) => (b.anonymity - a.anonymity) || (a.latency - b.latency))[0];
        } else {
          best = successGroup.sort((a, b) => (a.latency - b.latency) || (a.anonymity - b.anonymity))[0];
        }
      } else {
        if (mode === 'dark') {
          best = scored.sort((a, b) => (b.anonymity - a.anonymity) || (a.latency - b.latency))[0];
        } else {
          best = scored.sort((a, b) => (a.latency - b.latency) || (a.anonymity - b.anonymity))[0];
        }
      }

      const endpoint = best?.conn?.endpoint || (candidates[0] && candidates[0].endpoint);
      const res = await retry(
        () => http.post(`${apiBase}/connect`, { endpoint }, { timeout: 15000, signal: connectControllerRef.current.signal }),
        { retries: 1, delay: 700 }
      );
      if (res.data?.success || res.data?.connection) {
        setConnected(true);
        setActiveConnection(res.data.connection);
        setStatus('connected');
        await checkStatus();
        // Ensure homepage aligns with mode and open browser
        setBrowserUrl(req.homepage);
        setShowBrowser(true);
        setTimeout(scrollToBrowser, 50);
        // Do not auto-load here; mode handler handles initial load
      } else {
        setStatus('failed');
      }
    } catch (error) {
      const msg = error?.message || '';
      // Ignore benign aborts from HMR/cancellation; continue with auto-connect via proxy
      if (error?.name === 'CanceledError' || error?.code === 'ERR_CANCELED' || /ABORTED|canceled/i.test(msg)) {
        console.debug('Mode-specific connect aborted; proceeding with proxy auto-connect');
      } else {
        if (process.env.NODE_ENV === 'development') {
          console.debug('Mode-specific connect failed:', error?.message || error);
        } else {
          console.error('Mode-specific connect failed:', error);
        }
        setStatus('failed');
      }
    } finally {
      setConnecting(false);
    }
  };

  // Cleanup: abort any in-flight requests when component unmounts
  useEffect(() => {
    return () => {
      try { pageControllerRef.current?.abort?.(); } catch {}
      try { connectControllerRef.current?.abort?.(); } catch {}
    };
  }, []);

  // BrowserFrame declared top-level above App

  const handleModeSelect = async (mode) => {
    // Gate selection before showing UI
    const unlocked = await ensureRewardGate();
    if (!unlocked) { setStatus('failed'); return; }

    // Set mode and target homepage
    setBrowseMode(mode);
    const req = getRequirementsForMode(mode);
    setStatus('connecting');
    // Connect first to reduce overlapping requests and aborts
    await connectForMode(mode);
    // Then load the homepage once the route is active
    await loadWebpage(req.homepage);
  };

  // Auto-entry redirect: support query param ?entry=dark|light or ?mode=dark|light
  // If nothing is specified or saved, stay on main screen until user chooses.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const params = new URLSearchParams(window.location.search);
      const q = (params.get('entry') || params.get('mode') || '').toLowerCase();
      const saved = localStorage.getItem('flux_browse_mode');
      const chosen = (q === 'dark' || q === 'light') ? q : (saved === 'dark' || saved === 'light' ? saved : null);
      if (chosen) {
        // Delay slightly to allow initial status fetch
        setTimeout(() => handleModeSelect(chosen), 200);
      } else {
        setShowBrowser(false);
      }
    } catch (_) {}
  }, []);

  const handleConnectClicked = async () => {
    // Gate the connect action behind a rewarded ad
    const unlocked = await ensureRewardGate();
    if (!unlocked) {
      setStatus('failed');
      return;
    }
    if (!browseMode) {
      // Require mode choice to determine connection type
      setShowBrowser(false);
      setTimeout(scrollToModeChooser, 50);
      return;
    }
    await connectForMode(browseMode);
  };

  const handleOptimize = async () => {
    const unlocked = await ensureRewardGate();
    if (!unlocked) { setStatus('failed'); return; }
    try {
      setStatus('connecting');
      // Prefer recommendation endpoint if available; else fall back to mode selection
      const endpoint = summary?.recommendation?.endpoint;
      if (endpoint) {
        const res = await retry(() => http.post(`${apiBase}/connect`, { endpoint }, { timeout: 15000 }), { retries: 1, delay: 700 });
        if (res.data?.success || res.data?.connection) {
          setConnected(true);
          setActiveConnection(res.data.connection);
          setStatus('connected');
          await checkStatus();
        } else {
          setStatus('failed');
        }
      } else {
        const type = (summary?.recommendation?.type || '').toLowerCase();
        const mode = type === 'tor' ? 'dark' : 'light';
        await connectForMode(mode);
      }
    } catch (e) {
      if (process.env.NODE_ENV === 'development') {
        console.debug('Optimize failed:', e?.message || e);
      } else {
        console.error('Optimize failed:', e);
      }
      setStatus('failed');
    }
  };

  const getStatusColor = () => {
    if (connected) return 'text-emerald-400';
    if (connecting) return 'text-yellow-400';
    return 'text-gray-400';
  };

  const getConnectionIcon = (type) => {
    switch(type) {
      case 'tor': return <Lock className="w-4 h-4" />;
      case 'proxy': return <Globe className="w-4 h-4" />;
      case 'vpn': return <Lock className="w-4 h-4" />;
      case 'satellite': return <Satellite className="w-4 h-4" />;
      case 'mesh': return <Network className="w-4 h-4" />;
      default: return <Wifi className="w-4 h-4" />;
    }
  };

  const privacyLabel = (level = 1) => {
    if (level >= 5) return 'Max';
    if (level >= 4) return 'High';
    if (level >= 3) return 'Moderate';
    return 'Low';
  };

  const purposeFor = (conn) => {
    const t = conn?.type;
    switch (t) {
      case 'direct':
      case 'wifi':
        return 'Fastest local route; ideal for regular browsing and streaming.';
      case 'vpn':
        return 'Stable private tunnel; good for privacy and geo‑unblocking.';
      case 'proxy':
        return 'Quick route via intermediary; variable speed and reliability.';
      case 'tor':
        return 'Maximum anonymity routing; slower, best for privacy‑critical use.';
      case 'doh':
        return 'Encrypted DNS only; improves privacy but not a full data route.';
      case 'webrtc':
        return 'Peer network/mesh; experimental, may be variable in speed.';
      default:
        return 'General route.';
    }
  };

  const speedLabel = (latency) => {
    if (latency == null) return 'Unknown';
    const ms = Math.round(latency);
    if (ms < 300) return 'Fast';
    if (ms < 800) return 'Moderate';
    return 'Slow';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-gray-900 to-slate-950 text-white">
      {/* Animated background */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute w-96 h-96 -top-48 -left-48 bg-slate-700 rounded-full mix-blend-multiply filter blur-3xl opacity-10 animate-blob"></div>
        <div className="absolute w-96 h-96 -bottom-48 -right-48 bg-slate-600 rounded-full mix-blend-multiply filter blur-3xl opacity-10 animate-blob animation-delay-2000"></div>
        <div className="absolute w-96 h-96 top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-slate-500 rounded-full mix-blend-multiply filter blur-3xl opacity-10 animate-blob animation-delay-4000"></div>
        <div className="flux-grid"></div>
        <div className="scanlines"></div>
        <LightningOverlay />
      </div>

      <div className="relative z-10">
        {/* Settings Overlay */}
        {showSettings && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-lg bg-slate-900 border border-white/10 rounded-xl shadow-xl">
              <div className="p-4 border-b border-white/10 flex items-center justify-between">
                <h3 className="text-lg font-semibold">Settings</h3>
                <button className="text-sm text-gray-300 hover:text-white" onClick={() => setShowSettings(false)}>Close</button>
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <div className="text-sm text-gray-300 mb-1">Backend URL (without /api)</div>
                  <input
                    type="text"
                    value={backendInput}
                    onChange={(e) => setBackendInput(e.target.value)}
                    placeholder="http://localhost:8000"
                    className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded focus:outline-none focus:border-gray-400"
                  />
                  <div className="text-xs text-gray-400 mt-1">Example: http://10.0.2.2:8000 (Android emulator) or http://localhost:8000</div>
                </div>
                <div className="text-xs text-gray-300">Current API base: <span className="font-mono">{apiBase}</span></div>
                <div className="text-xs text-gray-300">Resolved base: <span className="font-mono">{resolveBackendUrl()}</span></div>
              </div>
              <div className="p-4 border-t border-white/10 flex items-center justify-end gap-2">
                <button
                  className="px-3 py-2 text-xs bg-gray-700 hover:bg-gray-600 rounded"
                  onClick={() => setShowSettings(false)}
                >Cancel</button>
                <button
                  className="px-3 py-2 text-xs bg-amber-600 hover:bg-amber-700 rounded"
                  onClick={() => {
                    try {
                      const next = saveBackendOverride(backendInput);
                      setApiBase(next);
                      setShowSettings(false);
                    } catch (e) {
                      alert(e?.message || 'Invalid URL');
                    }
                  }}
                >Save</button>
                <button
                  className="px-3 py-2 text-xs bg-blue-600 hover:bg-blue-700 rounded"
                  onClick={() => {
                    const next = clearBackendOverride();
                    setApiBase(next);
                    setBackendInput(resolveBackendUrl());
                    setShowSettings(false);
                  }}
                >Clear Override</button>
              </div>
            </div>
          </div>
        )}
        {/* About / Intro Overlay */}
        {showAbout && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-2xl bg-slate-900 border border-white/10 rounded-xl shadow-xl">
              <div className="p-4 border-b border-white/10 flex items-center justify-between">
                <h3 className="text-lg font-semibold">About Dex Audit</h3>
                <button className="text-sm text-gray-300 hover:text-white" onClick={() => setShowAbout(false)}>Close</button>
              </div>
              <div className="p-5 space-y-4 text-sm text-gray-200">
                <p>Dex Audit helps you quickly assess a website’s privacy and security signals. It checks headers and behaviors that impact anonymity and safety.</p>
                <div>
                  <div className="font-medium text-white mb-1">What it checks</div>
                  <ul className="list-disc list-inside space-y-1 text-gray-300">
                    <li>HSTS, CSP, Referrer-Policy, Permissions-Policy, X-Frame-Options</li>
                    <li>Cookie security (Secure flag) and HTTPS-only access</li>
                    <li>Optional onion-location header for Tor friendly sites</li>
                    <li>Basic device signals like latency and WebRTC IP leak</li>
                  </ul>
                </div>
                <div>
                  <div className="font-medium text-white mb-1">How to use</div>
                  <ul className="list-disc list-inside space-y-1 text-gray-300">
                    <li>Select a mode: Normal or Dark Web.</li>
                    <li>Connect to a route when recommended, then search or enter a site.</li>
                    <li>Open the in-app browser to preview content; review the grade and tips.</li>
                  </ul>
                </div>
                <div className="text-xs text-gray-400">Note: Some networks block connectivity probes. If you see connectivity warnings, try opening a regular browser to complete any captive portal login, then retry.</div>
              </div>
              <div className="p-4 border-t border-white/10 flex items-center justify-end">
                <button className="px-3 py-2 text-xs bg-white/10 hover:bg-white/20 rounded" onClick={() => { try { if (typeof window !== 'undefined') localStorage.setItem('dex_intro_seen', '1'); } catch {} setShowAbout(false); }}>Got it</button>
              </div>
            </div>
          </div>
        )}
        {/* Header */}
        <header className="px-4 py-4 sm:p-6 border-b border-white/10 backdrop-blur-sm">
          <div className="max-w-7xl mx-auto flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <Zap className={`w-8 h-8 ${getStatusColor()} transition-colors duration-300`} />
              <h1 className="text-2xl font-bold text-white">Dex Audit</h1>
            </div>
            <div className="flex items-center gap-3 md:gap-6 flex-wrap justify-end">
              <div className="flex items-center gap-2">
                <Activity className={`w-5 h-5 ${isOnline ? 'text-emerald-400 animate-pulse' : 'text-gray-500'}`} />
                <span className="text-sm">{isOnline ? 'ONLINE' : 'OFFLINE'}</span>
              </div>
              <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-full bg-white/10">
                <span className="text-xs font-medium">API:</span>
                <span title={apiBase} className="text-[11px] max-w-[220px] truncate">{apiBase}</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/10">
                <span className="text-xs font-medium">Mode:</span>
                <span className={`text-xs font-medium ${browseMode === 'dark' ? 'text-purple-300' : 'text-blue-300'}`}>{browseMode ? (browseMode === 'dark' ? 'Dark Web' : 'Normal') : '—'}</span>
              </div>
              {stats.active > 0 && (
                <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-emerald-500/20 rounded-full">
                  <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
                  <span className="text-xs font-medium">{stats.active} Active</span>
                </div>
              )}
              {activeConnection && (
                <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-blue-500/20 rounded-full">
                  <span className="text-xs font-medium">Latency: {activeConnection.latency ? `${Math.round(activeConnection.latency)}ms` : 'N/A'}</span>
                  <span className="text-xs font-medium">• Strength: {speedLabel(activeConnection.latency)}</span>
                </div>
              )}
              <button
                className="px-3 py-1 text-xs bg-white/10 hover:bg-white/20 rounded flex items-center gap-2 shrink-0"
                onClick={() => setShowSettings(true)}
                aria-label="Settings"
              >
                <Settings className="w-4 h-4" />
                Settings
              </button>
              <button
                className="hidden sm:flex px-3 py-1 text-xs bg-white/10 hover:bg-white/20 rounded items-center gap-2 shrink-0"
                onClick={() => setShowAbout(true)}
                aria-label="About"
              >
                <Info className="w-4 h-4" />
                Intro
              </button>
            </div>
          </div>
        </header>

        {/* Connectivity Banner */}
        {backendError && isOnline && (
          <div className="max-w-7xl mx-auto mt-4 px-4">
            <div className="p-3 bg-amber-600/20 border border-amber-500/40 rounded-lg text-sm flex items-center justify-between">
              <span>
                Cannot reach backend at <span className="font-mono">{apiBase}</span>. Check server or URL.
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { checkStatus(); loadSummary(); }}
                  className="px-3 py-1 text-xs bg-amber-600 hover:bg-amber-700 rounded"
                >Retry</button>
                <button
                  onClick={() => setShowSettings(true)}
                  className="px-3 py-1 text-xs bg-white/10 hover:bg-white/20 rounded"
                >Fix Backend URL</button>
              </div>
            </div>
            {backendErrorDetail && (
              <div className="text-xs text-amber-300 mt-1 opacity-80 break-all">{backendErrorDetail}</div>
            )}
          </div>
        )}
        {!isOnline && (
          <div className="max-w-7xl mx-auto mt-4 px-4">
            <div className="p-3 bg-red-600/20 border border-red-500/40 rounded-lg text-sm">
              Device is offline. Check Wi‑Fi or Ethernet and try again.
            </div>
          </div>
        )}

        {/* Main Content */}
        <main className="max-w-7xl mx-auto p-6">
          {/* DexAudit — Primary Audit Action */}
          <div className="text-center py-16">
            <h2 className="text-5xl font-bold mb-4">Dex Audit</h2>
            <p className="text-lg text-gray-300 mb-6">
              Run a privacy audit on any site. Checks headers, Onion-Location, and WebRTC leaks.
            </p>
            <div className="flex items-center justify-center gap-2 max-w-2xl mx-auto">
              <input
                type="text"
                value={auditUrl}
                onChange={(e) => setAuditUrl(e.target.value)}
                placeholder="Enter site URL (https://example.com)"
                className="min-w-0 flex-1 px-4 py-3 bg-white/10 border border-white/20 rounded-lg focus:outline-none focus:border-gray-400"
              />
              <button
                onClick={() => runPrivacyAudit(auditUrl)}
                disabled={auditLoading || !auditUrl}
                className={`px-6 py-3 rounded-lg font-semibold ${auditLoading || !auditUrl ? 'bg-gray-600 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-700'}`}
              >{auditLoading ? 'Running…' : 'Audit'}</button>
            </div>
            {auditError && (
              <div className="mt-3 text-amber-300 text-sm">{auditError}</div>
            )}
            {auditError && auditErrorDetail && (
              <div className="mt-1 text-amber-200 text-xs opacity-80 break-all">{auditErrorDetail}</div>
            )}
            {auditLoading && !auditError && (
              <div className="mt-3 text-sm text-gray-300">Testing headers and WebRTC…</div>
            )}

            {/* Optional diagnostics preview below the hero */}
            {Object.keys(summary.counts_by_type || {}).length > 0 && (
              <div className="mt-8 max-w-3xl mx-auto p-4 bg-white/5 border border-white/10 rounded-xl text-left">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-blue-400" />
                    <span className="text-sm font-semibold">Diagnostics</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={loadSummary} className="text-xs px-2 py-1 bg-white/10 border border-white/10 rounded hover:bg-white/20">Refresh</button>
                    <button onClick={handleOptimize} className="text-xs px-2 py-1 bg-emerald-600 hover:bg-emerald-700 rounded">Optimize</button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mb-2">
                  {Object.entries(summary.counts_by_type || {}).map(([type, count]) => (
                    <span key={type} className="text-[11px] px-2 py-1 rounded bg-white/10 border border-white/10">
                      {type.toUpperCase()}: {count}
                    </span>
                  ))}
                </div>
                {summary.recommendation && (
                  <div className="text-xs text-gray-300">
                    <span className="font-medium">Recommended:</span> {summary.recommendation.type?.toUpperCase() || '—'} • Privacy {privacyLabel(summary.recommendation.anonymity_level)} • Latency {summary.recommendation.latency ? `${Math.round(summary.recommendation.latency)}ms` : 'Unknown'}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Pre-Browser Mode Selection removed to simplify initial page to two buttons only */}

          {/* Browser overlay removed: DexAudit is now the primary action */}

          {/* Active Connection Info */}
          {activeConnection && (
            <div className="mb-8 p-6 bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10" data-testid="active-connection">
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Activity className="w-5 h-5 text-emerald-400" />
                Active Connection
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-sm text-gray-400">Type</div>
                  <div className="text-lg font-semibold flex items-center gap-2 mt-1">
                    {getConnectionIcon(activeConnection.type)}
                    {activeConnection.type.toUpperCase()}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-400">Anonymity</div>
                  <div className="text-lg font-semibold mt-1">
                    {'🔒'.repeat(activeConnection.anonymity_level)}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-400">Status</div>
                  <div className="text-lg font-semibold text-emerald-400 mt-1">
                    {activeConnection.status.toUpperCase()}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-400">Latency</div>
                  <div className="text-lg font-semibold mt-1">
                    {activeConnection.latency ? `${Math.round(activeConnection.latency)}ms` : 'N/A'}
                  </div>
                </div>
              </div>
              <div className="mt-4 text-sm text-gray-300">{purposeFor(activeConnection)}</div>
            </div>
          )}

        {/* Diagnostics Summary */}
        {Object.keys(summary.counts_by_type || {}).length > 0 && (
          <div className="mb-8 p-6 bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Activity className="w-5 h-5 text-blue-400" />
                  Diagnostics Summary
                </h3>
                <button
                  onClick={loadSummary}
                  className="px-3 py-2 text-sm bg-blue-500 hover:bg-blue-600 rounded-lg"
                >Refresh</button>
              </div>
              <div className="flex flex-wrap gap-2 mb-4">
                {Object.entries(summary.counts_by_type || {}).map(([type, count]) => (
                  <span key={type} className="text-xs px-2 py-1 rounded bg-white/10 border border-white/10">
                    {type.toUpperCase()}: {count}
                  </span>
                ))}
              </div>
              {summary.recommendation && (
                <div className="p-4 bg-white/5 rounded-xl border border-emerald-700/30">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {getConnectionIcon(summary.recommendation.type)}
                      <span className="font-semibold">Recommended: {summary.recommendation.type.toUpperCase()}</span>
                    </div>
                    <span className="text-xs px-2 py-1 rounded bg-emerald-500/20 text-emerald-400">
                      {privacyLabel(summary.recommendation.anonymity_level)} Privacy
                    </span>
                  </div>
                  <div className="mt-2 text-sm text-gray-300">
                    {purposeFor(summary.recommendation)}
                  </div>
                  <div className="mt-2 text-sm">
                    Latency: {summary.recommendation.latency ? `${Math.round(summary.recommendation.latency)}ms` : 'Unknown'}
                    {' '}• Speed: {speedLabel(summary.recommendation.latency)}
                  </div>
          </div>
        )}

        {/* Privacy Audit */}
        <div className="mb-8 p-6 bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Lock className="w-5 h-5 text-purple-400" />
              Privacy Audit
            </h3>
            <button
              onClick={() => runPrivacyAudit()}
              disabled={auditLoading}
              className={`px-3 py-2 text-sm rounded-lg ${auditLoading ? 'bg-purple-400 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-700'}`}
            >{auditLoading ? 'Running…' : 'Run'}</button>
          </div>
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={auditUrl}
              onChange={(e) => setAuditUrl(e.target.value)}
              placeholder="Enter site URL (https://example.com)"
              className="min-w-0 flex-1 px-4 py-3 bg-white/10 border border-white/20 rounded-lg focus:outline-none focus:border-gray-400"
            />
            <button
              onClick={() => runPrivacyAudit(auditUrl)}
              disabled={auditLoading || !auditUrl}
              className={`px-3 py-2 text-sm rounded-lg ${auditLoading || !auditUrl ? 'bg-gray-600 cursor-not-allowed' : 'bg-gray-700 hover:bg-gray-600'}`}
            >Audit</button>
          </div>
          {auditHistory.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {auditHistory.map((u) => (
                <button key={u} onClick={() => { setAuditUrl(u); runPrivacyAudit(u); }} className="text-xs px-2 py-1 rounded bg-white/10 border border-white/10 hover:bg-white/20">{u}</button>
              ))}
            </div>
          )}
          {auditError && (
            <div className="text-amber-300 text-sm mb-2">{auditError}</div>
          )}
          {auditError && auditErrorDetail && (
            <div className="text-amber-200 text-xs opacity-80 mb-2 break-all">{auditErrorDetail}</div>
          )}
          {auditLoading && (
            <div className="text-sm text-gray-300">Testing headers and WebRTC…</div>
          )}
          {auditResult && !auditError && (
            <div className="text-sm text-gray-300 space-y-3">
              <div className="flex items-center gap-3">
                <span className="font-semibold">Grade:</span>
                <span className="px-2 py-1 rounded bg-white/10 border border-white/10">{auditResult.grade || 'N/A'}</span>
                <span className="font-semibold ml-4">Onion-Location:</span>
                <span className="px-2 py-1 rounded bg-white/10 border border-white/10">{auditResult.result?.onion_location || 'None'}</span>
                <span className="font-semibold ml-4">Tor Available:</span>
                <span className="px-2 py-1 rounded bg-white/10 border border-white/10">{auditResult.tor_compare?.available ? 'Yes' : 'No'}</span>
              </div>
              <div>
                <div className="font-semibold mb-1">Header Signals</div>
                <div className="flex flex-wrap gap-2">
                  {(() => {
                    const hdrs = auditResult.result?.headers || {};
                    const lower = Object.fromEntries(Object.entries(hdrs).map(([k, v]) => [String(k).toLowerCase(), v]));
                    const keys = ['strict-transport-security','content-security-policy','referrer-policy','permissions-policy','x-frame-options','x-content-type-options'];
                    return keys.map((key) => {
                      const present = !!lower[key];
                      return (
                        <span key={key} className={`text-xs px-2 py-1 rounded border ${present ? 'bg-green-600/20 border-green-500/40' : 'bg-red-600/20 border-red-500/40'}`}>
                          {key}: {present ? 'present' : 'missing'}
                        </span>
                      );
                    });
                  })()}
                </div>
              </div>
              {(() => {
                const hdrs = auditResult.result?.headers || {};
                const recs = missingHeaderRecommendations(hdrs);
                return recs.length > 0 ? (
                  <div>
                    <div className="font-semibold mb-1">Recommended Actions</div>
                    <ul className="list-disc ml-5 space-y-1">
                      {recs.map((r, i) => (<li key={i}>{r}</li>))}
                    </ul>
                  </div>
                ) : null;
              })()}
              <div>
                <div className="font-semibold mb-1">WebRTC IPs Observed</div>
                {webrtcLeaks && webrtcLeaks.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {webrtcLeaks.map((ip) => (
                      <span key={ip} className="text-xs px-2 py-1 rounded bg-white/10 border border-white/10">{ip}</span>
                    ))}
                  </div>
                ) : (
                  <div className="text-gray-400">No local IPs observed or WebRTC disabled.</div>
                )}
              </div>
            </div>
          )}
        </div>
            </div>
          )}


          {/* Advanced Options: Manual Connection Sources Grid */}
          {connections.length > 0 && (
            <div className="mt-8">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-semibold">Advanced Options — Manual Sources ({connections.length})</h3>
                <button
                  className="flex items-center gap-2 text-xs px-2 py-1 bg-white/10 border border-white/10 rounded hover:bg-white/20"
                  onClick={() => setShowLegend((s) => !s)}
                >
                  <Info className="w-3 h-3" />
                  {showLegend ? 'Hide Help' : 'What do these mean?'}
                </button>
              </div>
              {showLegend && (
                <div className="mb-4 p-4 bg-white/5 rounded-xl border border-white/10 text-sm text-gray-300">
                  <div className="mb-2 font-medium">How to choose a route</div>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Padlocks indicate privacy level: Low, Moderate, High, Max.</li>
                    <li>Speed labels reflect measured latency: Fast (&lt;100ms), Moderate (100–300ms), Slow (&gt;300ms).</li>
                    <li>Use “Use this” to switch immediately; compare hints show if it’s likely better than current.</li>
                    <li>Recommended route in Diagnostics balances privacy and speed automatically.</li>
                  </ul>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="connections-grid">
                {connections.slice(0, 12).map((conn) => (
                  <div
                    key={conn.id}
                    className="p-4 bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 hover:border-blue-400/40 transition-colors"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {getConnectionIcon(conn.type)}
                        <span className="font-semibold">{conn.type.toUpperCase()}</span>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded ${
                        conn.status === 'active' ? 'bg-emerald-500/20 text-emerald-400' :
                        conn.status === 'available' ? 'bg-blue-500/20 text-blue-400' :
                        'bg-gray-500/20 text-gray-400'
                      }`}>
                        {conn.status}
                      </span>
                    </div>
                    <div className="text-sm text-gray-400">
                      {'🔒'.repeat(conn.anonymity_level)} Privacy: {privacyLabel(conn.anonymity_level)}
                    </div>
                    <div className="mt-2 text-sm">
                      Latency: {testedMap[conn.endpoint]?.latency != null ? `${Math.round(testedMap[conn.endpoint].latency)}ms` : 'Untested'}
                      {' '}• Speed: {speedLabel(testedMap[conn.endpoint]?.latency)}
                    </div>
                    <div className="mt-2 text-xs text-gray-300">
                      {purposeFor(conn)}
                    </div>
                    {activeConnection && testedMap[conn.endpoint]?.latency != null && (
                      <div className="mt-2 text-xs">
                        {(() => {
                          const cand = testedMap[conn.endpoint]?.latency;
                          const cur = activeConnection?.latency;
                          if (cur == null) return 'Comparison to current: Unknown';
                          const better = cand < cur - 20; // margin
                          const similar = Math.abs(cand - cur) <= 20;
                          return better ? 'Likely better than current' : (similar ? 'Similar to current' : 'Likely worse than current');
                        })()}
                      </div>
                    )}
                    <div className="mt-3">
                      <button
                        className="px-3 py-2 text-xs bg-blue-500 hover:bg-blue-600 rounded"
                        onClick={async () => {
                          const unlocked = await ensureRewardGate();
                          if (!unlocked) { setStatus('failed'); return; }
                          try {
                            setStatus('connecting');
                            const res = await http.post(`${apiBase}/connect`, { endpoint: conn.endpoint });
                            if (res.data?.success) {
                              setConnected(true);
                              setActiveConnection(res.data.connection);
                              setStatus('connected');
                              await checkStatus();
                              // Show mode chooser before browser and scroll to it
                              setShowBrowser(false);
                              setTimeout(scrollToModeChooser, 50);
                            } else {
                              setStatus('failed');
                            }
                          } catch (e) {
                            console.error('Manual connect failed:', e);
                            setStatus('failed');
                          }
                        }}
                      >Use this</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>

        {/* Footer */}
        <footer className="text-center py-8 text-gray-400 text-sm">
          <p>⚡ Powered by decentralized networks, proxies, and open internet infrastructure</p>
        </footer>
      </div>
    </div>
  );
}

export default App;
  // Configurable default homepages (env or saved setting)
  const LIGHT_HOME = (process.env.REACT_APP_LIGHT_HOME && process.env.REACT_APP_LIGHT_HOME.trim()) || 'https://duckduckgo.com/';
  const DARK_HOME = (
    (process.env.REACT_APP_DARK_HOME && process.env.REACT_APP_DARK_HOME.trim()) ||
    (typeof window !== 'undefined' ? (localStorage.getItem('flux_dark_home') || '') : '') ||
    'https://ahmia.fi/'
  );
