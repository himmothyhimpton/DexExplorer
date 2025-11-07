import React from "react";

export default function FluxCapacitor({ className = "", size = 280 }) {
  const s = size;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 320 320"
      className={`flux-svg ${className}`}
      role="img"
      aria-label="Flux Capacitor"
    >
      <defs>
        <filter id="fluxGlow">
          <feGaussianBlur stdDeviation="3.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id="fluxWire" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#00eaff" />
          <stop offset="100%" stopColor="#ff8a00" />
        </linearGradient>
      </defs>

      {/* Frame */}
      <rect x="10" y="10" width="300" height="300" rx="24" className="flux-frame" />

      {/* Nodes */}
      <circle cx="100" cy="80" r="14" className="flux-node" />
      <circle cx="220" cy="80" r="14" className="flux-node" />
      <circle cx="160" cy="240" r="14" className="flux-node" />

      {/* Wires (Y-shaped) */}
      <path d="M100 80 L160 150 L160 240" className="flux-wire" />
      <path d="M220 80 L160 150 L160 240" className="flux-wire" />

      {/* Center pulse */}
      <circle cx="160" cy="150" r="6" className="flux-pulse" />
    </svg>
  );
}

