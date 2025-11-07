import React from "react";
import useSpeedMetrics from "@/hooks/useSpeedMetrics";

function Row({ label, value }) {
  return (
    <div className="segment-row">
      <div className="segment-label">{label}</div>
      <div className="segment-value" aria-label={label}>{value}</div>
    </div>
  );
}

function fmt(mbps) {
  if (mbps === null || mbps === undefined || !isFinite(mbps)) return "—";
  return `${mbps.toFixed(1)} Mbps`;
}

export default function TimeCircuits() {
  const { currentMbps, previousMbps, goalMbps, status, refresh, isMeasuring, lastError } = useSpeedMetrics();

  // Maintain the classic three-row layout but map to connectivity metrics
  const destination = fmt(goalMbps);
  const present = fmt(currentMbps);
  const departed = fmt(previousMbps);

  return (
    <div className="segment-panel" role="group" aria-label="Connectivity Circuits">
      <Row label="DESTINATION SPEED" value={destination} />
      <Row label="PRESENT SPEED" value={present} />
      <Row label="LAST MEASURED" value={departed} />
      <div className="text-center text-xs opacity-70 mt-2">
        {status?.online === false
          ? "Offline"
          : status?.effectiveType
          ? `Link: ${status.effectiveType} • RTT: ${status.rtt ?? "?"}ms`
          : "Link: unknown"}
      </div>
      <div className="mt-3 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={refresh}
          disabled={isMeasuring}
          className="px-3 py-1 rounded-md border border-slate-600 text-xs bg-slate-900 hover:bg-slate-800"
        >
          {isMeasuring ? "Measuring…" : "Re-measure"}
        </button>
        {lastError && (
          <span className="text-[10px] opacity-70">{lastError}</span>
        )}
      </div>
    </div>
  );
}
