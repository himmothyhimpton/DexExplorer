import React from "react";

export default function LightningOverlay({ className = "" }) {
  return (
    <div className={`pointer-events-none absolute inset-0 ${className}`}>
      <div className="bolt bolt-1" />
      <div className="bolt bolt-2" />
      <div className="bolt bolt-3" />
      <div className="bolt flash" />
    </div>
  );
}

