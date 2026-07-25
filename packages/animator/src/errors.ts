export type AnimatorErrorCode =
  | "disposed"
  | "duplicate-clip"
  | "invalid-alias"
  | "invalid-marker"
  | "invalid-option"
  | "ownership-conflict"
  | "unknown-clip"
  | "incompatible-crossfade";

/** Structured validation and lifecycle error thrown by the Animator API. */
export class AnimatorError extends Error {
  readonly code: AnimatorErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: AnimatorErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {}
  ) {
    super(message);
    this.name = "AnimatorError";
    this.code = code;
    this.details = details;
  }
}
