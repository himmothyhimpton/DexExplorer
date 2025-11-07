import React, { useState, useEffect, useRef } from 'react';
import '@/App.css';
import { http } from '@/lib/http';
import { API_BASE } from '@/lib/apiBase';
import { Wifi, Zap, Globe, Lock, Activity, Satellite, Radio, Network, Info } from 'lucide-react';
import { ensureRewardGate } from '@/lib/adGate';
import { initAdMob, showBanner, hideBanner, showNativeAdvanced } from '@/lib/admob';
import { retry } from '@/lib/retry';
import LightningOverlay from '@/components/LightningOverlay';

const API = API_BASE;

// Memoized iframe to keep resource loads alive across parent re-renders
const BrowserFrame = React.memo(({ content }) => {
  const iframeRef = useRef(null);
  const last = useRef('');
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    if (typeof content === 'string' && content !== last.current) {
      last.current = content;
      try {
        iframe.srcdoc = content;
      } catch {}
    }
  }, [content]);
  return (
    <iframe
      ref={iframeRef}
      title="preview"
      sandbox="allow-same-origin allow-forms allow-scripts"
      srcDoc={last.current}
      className="w-full h-full rounded-lg bg-white"
    />
  );
});

function App() {
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
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

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

  // When mode changes, open browser and set default homepage, then scroll
  useEffect(() => {
    if (!browseMode) return;
    if (browseMode === 'light') setBrowserUrl(LIGHT_HOME);
    if (browseMode === 'dark') setBrowserUrl(DARK_HOME);
    // Leaving incognito as a toggle within Normal mode; reset it when switching modes
    setIncognito(false);
    setShowBrowser(true);
    setTimeout(scrollToBrowser, 50);
  }, [browseMode]);

  // Check backend status once on load; poll only when connected
  useEffect(() => {
    checkStatus();
  }, []);

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

  const checkStatus = async () => {
    try {
      // Avoid premature aborts; allow the backend a bit longer in dev
      const response = await http.get(`${API}/status`, { timeout: 10000 });
      const data = response.data;
      setStats({
        active: data.active_connections,
        available: data.available_connections
      });
      if (data.active_connections > 0) {
        setConnected(true);
        setActiveConnection(data.connections[0]);
      }
    } catch (error) {
      // Fail quietly when backend is down to avoid noisy repeated errors
      if (process.env.NODE_ENV === 'development') {
        console.debug('Status check failed:', error?.message || error);
      }
    }
  };

  const discoverConnections = async () => {
    setStatus('discovering');
    try {
      const response = await retry(
        () => http.get(`${API}/discover`, { timeout: 12000 }),
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

  const loadSummary = async () => {
    try {
      const res = await retry(() => http.get(`${API}/diagnostics/summary`, { timeout: 10000 }), { retries: 1, delay: 500 });
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
    } catch (e) {
      if (process.env.NODE_ENV === 'development') {
        console.debug('Summary fetch failed:', e?.message || e);
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
      // First discover sources
      await discoverConnections();
      
      // Then auto-connect to best one
      const response = await retry(() => http.post(`${API}/connect`, null, { timeout: 15000 }), { retries: 1, delay: 1000 });
      
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
        setBrowserContent('<div class="p-4 text-amber-700">Tor route required to load .onion links. Connect to a Tor source, then try again.</div>');
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
    setStatus('loading');
    // Cancel any in-flight page load and start a fresh controller
    try { pageControllerRef.current?.abort?.(); } catch {}
    pageControllerRef.current = new AbortController();
    try {
      // Read raw text to avoid implicit JSON.parse throwing on HTML responses
      const response = await retry(
        () => http.post(
          `${API}/proxy`,
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
      setBrowserContent(decoded);
      setShowBrowser(true);
      setStatus('browsing');
    } catch (error) {
      // Ignore intentional cancellations (new request supersedes prior)
      const emsg = error?.message || '';
      if (error?.name === 'CanceledError' || /aborted|canceled/i.test(emsg)) {
        console.debug('Page load aborted (superseded by a new request)');
        return;
      }
      console.error('Failed to load webpage:', error);
      const isSyntax = /Unexpected token/.test(error?.message || '');
      const msg = error?.message?.includes('timeout')
        ? 'Request timed out. Try again or switch route.'
        : isSyntax
          ? "Unexpected token '<' usually means HTML was returned where JSON was expected. Confirm backend is running on the configured API base."
          : `Failed to load: ${error.message}`;
      setBrowserContent(`<div class="p-4 text-red-700">${msg}</div>`);
      setShowBrowser(true);
      setStatus('error');
    }
  };

  // Hide banner/native when browser overlay is visible; show when hidden
  useEffect(() => {
    (async () => {
      if (showBrowser) {
        await hideBanner();
      } else {
        // Attempt native again; otherwise use banner
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
          `${API}/proxy`,
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
      // Fresh discovery for accurate candidates
      const disc = await retry(
        () => http.get(`${API}/discover`, { timeout: 12000, signal: connectControllerRef.current.signal }),
        { retries: 1, delay: 700 }
      );
      const discovered = disc.data || [];
      setConnections(discovered);
      setDiscoveredCount(discovered.length);
      setStatus('discovered');

      // Pull diagnostics for latency and success
      let testedMapLocal = {};
      try {
        const diag = await retry(
          () => http.get(`${API}/diagnostics/summary`, { timeout: 10000, signal: connectControllerRef.current.signal }),
          { retries: 1, delay: 500 }
        );
        const tested = diag.data?.tested || [];
        tested.forEach((t) => {
          if (t && t.endpoint) testedMapLocal[t.endpoint] = { latency: t.latency, success: t.tested_success };
        });
        setSummary(diag.data || {});
        setTestedMap(testedMapLocal);
      } catch (e) {
        // Continue without diagnostics if unavailable
      }

      // Filter to mode-required types
      const candidates = discovered.filter((c) => req.requiredTypes.includes(c.type));
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

      const endpoint = best?.conn?.endpoint || candidates[0].endpoint;
      const res = await retry(
        () => http.post(`${API}/connect`, { endpoint }, { timeout: 15000, signal: connectControllerRef.current.signal }),
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
    setBrowserUrl(req.homepage);
    setShowBrowser(true);
    setStatus('connecting');
    // Kick off connection in the background; proxy will auto-connect if needed
    connectForMode(mode).catch((err) => {
      const msg = err?.message || '';
      if (!/ABORTED|canceled/i.test(msg)) {
        console.debug('Background connect error:', msg);
      }
    });

    // Load the homepage immediately for a seamless redirect
    await loadWebpage(req.homepage);
  };

  // Auto-entry redirect: support query param ?entry=dark|light or ?mode=dark|light
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
    if (ms < 100) return 'Fast';
    if (ms < 300) return 'Moderate';
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
        {/* Header */}
        <header className="p-6 border-b border-white/10 backdrop-blur-sm">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Zap className={`w-8 h-8 ${getStatusColor()} transition-colors duration-300`} />
              <h1 className="text-2xl font-bold text-white">Dex Explorer</h1>
            </div>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Activity className={`w-5 h-5 ${(connected && isOnline) ? 'text-emerald-400 animate-pulse' : 'text-gray-500'}`} />
                <span className="text-sm">{!isOnline ? 'OFFLINE' : (connected ? 'ONLINE' : 'OFFLINE')}</span>
              </div>
              {stats.active > 0 && (
                <div className="flex items-center gap-2 px-3 py-1 bg-emerald-500/20 rounded-full">
                  <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
                  <span className="text-xs font-medium">{stats.active} Active</span>
                </div>
              )}
              {activeConnection && (
                <div className="flex items-center gap-2 px-3 py-1 bg-blue-500/20 rounded-full">
                  <span className="text-xs font-medium">Latency: {activeConnection.latency ? `${Math.round(activeConnection.latency)}ms` : 'N/A'}</span>
                  <span className="text-xs font-medium">• Strength: {speedLabel(activeConnection.latency)}</span>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto p-6">
          {/* Browser-First Section */}
          <div className="text-center py-16">
            <h2 className="text-5xl font-bold mb-4 neon-text bttf-title bttf-gradient-text">
              Dex Explorer
            </h2>
            <p className="text-xl text-gray-300 mb-4 neon-text bttf-label">
              Choose Normal or Dark Side browser; we’ll auto-select the best route.
            </p>
            <div className="flex items-center justify-center gap-3 mb-6" aria-label="Choose browsing mode">
              <button
                aria-pressed={browseMode === 'light'}
                className={`px-4 py-2 rounded-lg border ${browseMode === 'light' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-white/10 text-gray-200 hover:bg-slate-700'}`}
                onClick={() => handleModeSelect('light')}
              >
                Normal Browser
              </button>
              <button
                aria-pressed={browseMode === 'dark'}
                className={`px-4 py-2 rounded-lg border ${browseMode === 'dark' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-white/10 text-gray-200 hover:bg-slate-700'}`}
                onClick={() => handleModeSelect('dark')}
              >
                Dark Web
              </button>
              {/* Incognito is only available inside the Normal Browser overlay */}
            </div>
            {/* Images removed per request to simplify initial screen */}

            {/* Status Message */}
            {status && status !== 'idle' && (
              <div className="mt-8 text-lg" data-testid="status-message">
                {status === 'discovering' && '🔍 Scanning for connections...'}
                {status === 'discovered' && `✨ Found ${discoveredCount} sources!`}
                {status === 'connecting' && '⚡ Establishing connection...'}
                {status === 'connected' && '✅ Connection established.'}
                {status === 'failed' && '❌ Connection failed. Trying again...'}
                {status === 'loading' && '📡 Loading webpage...'}
              </div>
            )}
          </div>

          {/* Pre-Browser Mode Selection removed to simplify initial page to two buttons only */}

          {/* Full-screen Browser Overlay with Mode Toggle */}
          {browseMode !== null && (
            <div ref={browserSectionRef} className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-sm" data-testid="browser-section">
              <div className="max-w-7xl mx-auto p-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Globe className="w-5 h-5 text-blue-400" />
                    <span className="text-lg font-semibold">Secure Browser</span>
                  </div>
                  <button className="text-sm px-3 py-2 bg-white/10 border border-white/10 rounded hover:bg-white/20" onClick={() => { if (incognito) { setBrowserContent(''); setBrowserUrl('https://duckduckgo.com/'); } setShowBrowser(false); setBrowseMode(null); }}>
                    Back
                  </button>
                </div>

                {/* Simplified header only; no mode switching inside the browser */}
                <div className="mb-2 flex items-center gap-3 text-sm text-gray-300">
                  <span>Mode: {browseMode === 'dark' ? 'Dark Web' : 'Normal'}</span>
                  {browseMode === 'light' && (
                    <button
                      aria-pressed={incognito}
                      onClick={() => setIncognito((v) => !v)}
                      className={`flex items-center gap-2 px-2 py-1 rounded-full border text-xs ${incognito ? 'bg-amber-500/20 border-amber-400 text-amber-300' : 'bg-white/10 border-white/20 text-gray-300 hover:bg-white/15'}`}
                      title="Incognito mode toggles persistence; it does not change the route"
                    >
                      <Lock className="w-3 h-3" /> {incognito ? 'Incognito On' : 'Incognito Off'}
                    </button>
                  )}
                </div>

                {/* URL Bar */}
                <div className="flex gap-2 mb-4">
                  <input
                    type="text"
                    value={browserUrl}
                    onChange={(e) => setBrowserUrl(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && loadWebpage()}
                    placeholder="Enter URL (e.g., https://example.com)"
                    data-testid="url-input"
                    className="flex-1 px-4 py-3 bg-white/10 border border-white/20 rounded-lg focus:outline-none focus:border-gray-400 transition-colors"
                  />
                  <button
                    onClick={() => loadWebpage()}
                    data-testid="load-button"
                    disabled={!isOnline}
                    className={`px-6 py-3 rounded-lg font-semibold transition-colors ${(connected && isOnline) ? 'bg-blue-500 hover:bg-blue-600' : 'bg-slate-700 cursor-not-allowed'}`}
                  >GO</button>
                </div>

                {!connected && (
                  <div className="mb-4 text-sm text-amber-300" data-testid="not-connected-hint">
                    {!isOnline ? 'No network detected. Check Wi‑Fi or Ethernet.' : (status === 'connecting' ? 'Establishing connection…' : 'Connecting automatically based on your selection.')}
                  </div>
                )}

                {browseMode === 'dark' && connected && activeConnection?.type !== 'tor' && (
                  <div className="mb-4 text-sm text-amber-300">
                    Tor route not active. .onion links will not load. Choose a Tor source below.
                  </div>
                )}

                {/* Browser Content */}
                <div className="bg-white rounded-lg p-0 text-black h-[70vh] overflow-hidden" data-testid="browser-content">
                  {showBrowser ? (
                    <BrowserFrame content={browserContent} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-700">
                      Browser is ready. Enter a URL and press GO.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

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
                            const res = await http.post(`${API}/connect`, { endpoint: conn.endpoint });
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
