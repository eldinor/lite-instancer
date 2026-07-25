import { StageAbortError } from "./core.js";
import type { StageTransition } from "./types.js";

export interface HtmlFadeTransitionOptions {
  host: HTMLElement;
  duration?: number;
  color?: string;
  blockPointerInput?: boolean;
  respectReducedMotion?: boolean;
}

export function htmlFadeTransition(options: HtmlFadeTransitionOptions): StageTransition {
  const duration = options.duration ?? 300;
  if (!Number.isFinite(duration) || duration < 0) {
    throw new Error("Fade duration must be a finite non-negative number.");
  }
  const blockPointerInput = options.blockPointerInput ?? true;
  const respectReducedMotion = options.respectReducedMotion ?? true;

  return {
    async prepare({ signal }) {
      configureHost(options.host, options.color ?? "#000", blockPointerInput);
      await animateOpacity(options.host, 0, 1, effectiveDuration(duration, respectReducedMotion), signal);
    },
    async run({ signal }) {
      await animateOpacity(options.host, 1, 0, effectiveDuration(duration, respectReducedMotion), signal);
    },
    cleanup() {
      options.host.style.transition = "";
      options.host.style.opacity = "0";
      options.host.style.visibility = "hidden";
      options.host.style.pointerEvents = "none";
      options.host.setAttribute("aria-hidden", "true");
    }
  };
}

function configureHost(host: HTMLElement, color: string, blockPointerInput: boolean): void {
  host.style.background = color;
  host.style.opacity = "0";
  host.style.visibility = "visible";
  host.style.pointerEvents = blockPointerInput ? "auto" : "none";
  host.setAttribute("aria-hidden", "true");
}

function effectiveDuration(duration: number, respectReducedMotion: boolean): number {
  if (
    respectReducedMotion &&
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return 0;
  }
  return duration;
}

function animateOpacity(
  host: HTMLElement,
  from: number,
  to: number,
  duration: number,
  signal: AbortSignal
): Promise<void> {
  if (signal.aborted) return Promise.reject(new StageAbortError());
  host.style.opacity = String(from);
  if (duration === 0) {
    host.style.opacity = String(to);
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const abort = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new StageAbortError());
    };
    const timer = setTimeout(finish, duration + 40);
    signal.addEventListener("abort", abort, { once: true });
    host.style.transition = `opacity ${duration}ms ease`;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!settled) host.style.opacity = String(to);
      });
    });
  });
}
