import {
  activateStage,
  beginStageNavigation,
  createStageManager,
  defineStage,
  disposeStage,
  disposeStageManager,
  getActiveStage,
  getStageInstance,
  getStageManagerSnapshot,
  isStageAbortError,
  navigateToStage,
  onStageProgress,
  onStageStateChanged,
  preloadStage
} from "../src/index.js";

describe("stage lifecycle", () => {
  it("preloads once and activates the retained instance", async () => {
    const manager = createStageManager();
    let loads = 0;
    const states: string[] = [];
    onStageStateChanged(manager, ({ stageId, state }) => states.push(`${stageId}:${state}`));
    defineStage(manager, {
      id: "viewer",
      load() {
        loads++;
        return { data: { ready: true } };
      }
    });

    const preloaded = await preloadStage(manager, "viewer");
    expect(preloaded.state).toBe("loaded");
    expect(getActiveStage(manager)).toBeNull();

    await activateStage(manager, "viewer");
    expect(loads).toBe(1);
    expect(getActiveStage(manager)).toBe(preloaded);
    expect(states).toEqual([
      "viewer:loading",
      "viewer:loaded",
      "viewer:entering",
      "viewer:active"
    ]);
  });

  it("switches stages while retaining the previous loaded instance", async () => {
    const manager = createStageManager();
    const events: string[] = [];
    for (const id of ["menu", "viewer"]) {
      defineStage(manager, {
        id,
        load: () => ({ data: id }),
        enter: () => {
          events.push(`${id}:enter`);
        },
        exit: () => {
          events.push(`${id}:exit`);
        }
      });
    }

    await navigateToStage(manager, "menu");
    await navigateToStage(manager, "viewer");

    expect(getActiveStage(manager)?.id).toBe("viewer");
    expect(getStageInstance(manager, "menu")?.state).toBe("loaded");
    expect(events).toEqual(["menu:enter", "viewer:enter", "menu:exit"]);
  });

  it("reports normalized progress and supports unsubscribe", async () => {
    const manager = createStageManager();
    const ratios: Array<number | null> = [];
    const unsubscribe = onStageProgress(manager, (event) => ratios.push(event.ratio));
    defineStage(manager, {
      id: "progress",
      load({ reportProgress }) {
        reportProgress({ phase: "assets", completed: 2, total: 4 });
        reportProgress({ phase: "compile", completed: 1, total: null });
        return { data: null };
      }
    });

    await preloadStage(manager, "progress");
    unsubscribe();
    expect(ratios).toEqual([0.5, null]);
  });

  it("preserves the active stage when target loading fails", async () => {
    const manager = createStageManager();
    defineStage(manager, { id: "menu", load: () => ({ data: null }) });
    defineStage(manager, {
      id: "broken",
      load() {
        throw new Error("load failed");
      }
    });

    await navigateToStage(manager, "menu");
    await expect(navigateToStage(manager, "broken")).rejects.toThrow("load failed");

    expect(getActiveStage(manager)?.id).toBe("menu");
    expect(getStageInstance(manager, "broken")).toBeNull();
  });
});

describe("cancellation", () => {
  it("lets the newest navigation win and rejects the stale operation as aborted", async () => {
    const manager = createStageManager();
    defineStage(manager, {
      id: "slow",
      async load({ signal }) {
        await abortableDelay(50, signal);
        return { data: null };
      }
    });
    defineStage(manager, { id: "fast", load: () => ({ data: null }) });

    const stale = beginStageNavigation(manager, "slow");
    await Promise.resolve();
    await navigateToStage(manager, "fast");

    await expect(stale.promise).rejects.toSatisfy(isStageAbortError);
    expect(getActiveStage(manager)?.id).toBe("fast");
    expect(getStageInstance(manager, "slow")).toBeNull();
  });

  it("supports explicit cancellation handles", async () => {
    const manager = createStageManager();
    defineStage(manager, {
      id: "slow",
      async load({ signal }) {
        await abortableDelay(100, signal);
        return { data: null };
      }
    });

    const operation = beginStageNavigation(manager, "slow");
    operation.cancel();
    await expect(operation.promise).rejects.toSatisfy(isStageAbortError);
    expect(getActiveStage(manager)).toBeNull();
  });

  it("aborts loading during manager shutdown", async () => {
    const manager = createStageManager();
    defineStage(manager, {
      id: "slow",
      async load({ signal }) {
        await abortableDelay(100, signal);
        return { data: null };
      }
    });
    const operation = beginStageNavigation(manager, "slow");
    await Promise.resolve();

    await disposeStageManager(manager);

    await expect(operation.promise).rejects.toSatisfy(isStageAbortError);
    expect(manager.disposed).toBe(true);
  });
});

describe("resource ownership", () => {
  it("disposes stage-owned resources in reverse registration order", async () => {
    const manager = createStageManager();
    const disposal: string[] = [];
    defineStage(manager, {
      id: "resources",
      load({ resources }) {
        resources.own("first", (value) => {
          disposal.push(value);
        });
        resources.own("second", (value) => {
          disposal.push(value);
        });
        return { data: null };
      }
    });

    await preloadStage(manager, "resources");
    await disposeStage(manager, "resources");

    expect(disposal).toEqual(["second", "first"]);
  });

  it("deduplicates shared loading and disposes after the final stage lease", async () => {
    const manager = createStageManager();
    let loads = 0;
    const disposal: string[] = [];
    const loadShared = async (): Promise<{ name: string }> => {
      loads++;
      await Promise.resolve();
      return { name: "environment" };
    };
    for (const id of ["one", "two"]) {
      defineStage(manager, {
        id,
        async load({ shared }) {
          const environment = await shared.acquire("environment", loadShared, {
            dispose: (value) => {
              disposal.push(value.name);
            }
          });
          return { data: environment };
        }
      });
    }

    const one = preloadStage(manager, "one");
    const two = preloadStage(manager, "two");
    await Promise.allSettled([one, two]);

    // Latest-navigation-wins means the first preload is cancelled, but its
    // pending shared factory is still reused by the succeeding preload.
    expect(loads).toBe(1);
    expect(getStageManagerSnapshot(manager).sharedResources[0]?.references).toBe(1);
    await disposeStage(manager, "two");
    expect(disposal).toEqual(["environment"]);
  });
});

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const abort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}
