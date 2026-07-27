import type { AnnotationOcclusionState } from "./types.js";

export interface OcclusionHysteresisState {
  readonly state: AnnotationOcclusionState;
  readonly candidate: AnnotationOcclusionState;
  readonly candidateCount: number;
}

export function advanceOcclusionHysteresis(
  prior: OcclusionHysteresisState | undefined,
  raw: Exclude<AnnotationOcclusionState, "unknown">,
  enterThreshold: number,
  exitThreshold: number
): OcclusionHysteresisState {
  if (!prior) {
    return {
      state: raw === "visible" || enterThreshold === 1 ? raw : "unknown",
      candidate: raw,
      candidateCount: 1
    };
  }
  if (raw === prior.state) {
    return { state: prior.state, candidate: raw, candidateCount: 0 };
  }
  const candidateCount = prior.candidate === raw ? prior.candidateCount + 1 : 1;
  const required = raw === "occluded" ? enterThreshold : exitThreshold;
  return {
    state: candidateCount >= required ? raw : prior.state,
    candidate: raw,
    candidateCount
  };
}
