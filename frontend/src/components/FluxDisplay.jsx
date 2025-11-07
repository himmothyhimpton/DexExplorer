import React, { useState } from "react";
import FluxCapacitor from "@/components/FluxCapacitor";

export default function FluxDisplay({ className = "", size = 300 }) {
  const sources = [
    "/flux-capacitor.jpg",
    "/flux-capacitor.jpeg",
    "/flux-capacitor.png",
  ];
  const [idx, setIdx] = useState(0);
  const [useFallback, setUseFallback] = useState(false);

  const handleError = () => {
    if (idx < sources.length - 1) {
      setIdx(idx + 1);
    } else {
      setUseFallback(true);
    }
  };

  if (useFallback) {
    return (
      <div className={`flux-photo-frame ${className}`} style={{ width: size, height: size }}>
        <FluxCapacitor size={size - 20} />
      </div>
    );
  }

  return (
    <div className={`flux-photo-frame ${className}`} style={{ width: size, height: size }}>
      <img
        src={sources[idx]}
        alt="Flux Capacitor"
        className="w-full h-full object-cover rounded-xl"
        onError={handleError}
        draggable={false}
      />
      {/* Top red warning label */}
      <div className="flux-label flux-label-top">DISCONNECT CAPACITOR DRIVE BEFORE OPENING</div>
      {/* Center red label */}
      <div className="flux-label flux-label-center">SHIELD EYES FROM LIGHT</div>
      {/* Bottom panel */}
      <div className="flux-bottom-panel">
        <div className="flux-bottom-gauge">87</div>
        <div className="flux-bottom-reset">RESET</div>
        <div className="flux-bottom-plutonium">PLUTONIUM</div>
      </div>
    </div>
  );
}

