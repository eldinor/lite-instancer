import type { Scene } from "@babylonjs/core/scene.js";

export function addInspectorButton(scene: Scene): void {
  const controls = document.querySelector<HTMLElement>("#controls");
  if (!controls) {
    throw new Error("Missing #controls for the Babylon Inspector button");
  }

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Inspector";
  button.setAttribute("aria-pressed", "false");

  let loading: Promise<void> | undefined;
  let loaded = false;
  button.addEventListener("click", () => {
    if (loaded && scene.debugLayer.isVisible()) {
      scene.debugLayer.hide();
      button.setAttribute("aria-pressed", "false");
      return;
    }

    button.disabled = true;
    button.textContent = "Loading Inspector...";
    loading ??= loadInspector();
    void loading
      .then(async () => {
        loaded = true;
        await scene.debugLayer.show({ embedMode: true });
        button.disabled = false;
        button.textContent = "Inspector";
        button.setAttribute("aria-pressed", "true");
      })
      .catch((error: unknown) => {
        loading = undefined;
        button.disabled = false;
        button.textContent = "Retry Inspector";
        console.error("Unable to load Babylon Inspector", error);
      });
  });

  controls.append(button);
}

async function loadInspector(): Promise<void> {
  await Promise.all([
    import("@babylonjs/core/Debug/debugLayer.js"),
    import("@babylonjs/inspector")
  ]);
}
