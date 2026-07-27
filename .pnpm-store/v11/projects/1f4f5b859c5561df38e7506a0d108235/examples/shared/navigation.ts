export type DemoGroupId = "html" | "gpu";

export interface DemoEntry {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly group: DemoGroupId;
  readonly route: string;
  readonly api: string;
  readonly sourcePath: string;
}

export interface DemoGroup {
  readonly id: DemoGroupId;
  readonly title: string;
  readonly description: string;
}

export const demoGroups: readonly DemoGroup[] = Object.freeze([
  {
    id: "html",
    title: "HTML overlay",
    description: "Accessible DOM labels, markers, interaction, collisions, and depth-aware presentation."
  },
  {
    id: "gpu",
    title: "GPU TextRenderer",
    description: "Batched WebGPU text, Sprite2D markers and lines, CPU interaction, shaping modes, and benchmarks."
  }
]);

export const demos: readonly DemoEntry[] = Object.freeze([
  demo("labels", "Mesh labels", "Attach readable labels to local points on regular meshes.", "html", "labels/", "createLabel()"),
  demo("markers", "Markers & clamping", "Mix dots and rings and keep moving targets inside the viewport.", "html", "markers/", "createMarker()"),
  demo("dynamic", "Live data labels", "Refresh callback text explicitly while the scene keeps moving.", "html", "dynamic/", "invalidateAnnotation()"),
  demo("instancer", "Stable instance IDs", "Keep labels attached through instance growth, swaps, and removal.", "html", "instancer/", "createInstanceAnchor()"),
  demo("lifecycle", "Lifecycle & cleanup", "Dispose annotations or complete layers and rebuild them safely.", "html", "lifecycle/", "disposeAnnotationLayer()"),
  demo("collisions", "Label collisions", "Compare hide, shift, radial, cluster, and repel placement.", "html", "collisions/", "collision: \"repel\""),
  demo("collision-stress", "Collision stress test", "Profile collision modes with selectable 100–500 label loads.", "html", "collision-stress/", "updateAnnotationLayer()"),
  demo("occlusion", "Depth occlusion", "Fade or hide labels behind geometry and combine it with layout.", "html", "occlusion/", "occlusion: \"fade\""),
  demo("textrender-basic", "GPU labels & markers", "Explore batched text, dots, rings, clamping, and high-DPI placement.", "gpu", "textrender/basic/", "createTextRendererAnnotationBackend()"),
  demo("textrender-backgrounds", "GPU label backgrounds", "Build readable padded cards with scalable rounded borders and one batched background draw per z bucket.", "gpu", "textrender/backgrounds/", "backgroundColor + padding"),
  demo("textrender-callouts", "GPU compound callouts", "Combine one anchor with a marker, offset label, and leader line.", "gpu", "textrender/callouts/", "leaderLine + screenOffset"),
  demo("textrender-animated-markers", "Animated GPU markers", "Pulse stable marker sprites with Lite Sprite FX and no per-frame API calls.", "gpu", "textrender/animated-markers/", "animation: { type: \"pulse\" }"),
  demo("textrender-marker-shapes", "GPU marker shapes", "Compare every built-in shape with a registered application-defined star.", "gpu", "textrender/marker-shapes/", "markerShapes"),
  demo("textrender-marker-benchmark", "GPU marker benchmark", "Run an automatic 100–10,000 marker scaling and update suite on demand.", "gpu", "textrender/marker-benchmark/", "getStats()"),
  demo("textrender-interaction", "GPU annotation interaction", "Pick, hover, and click screen-space labels and markers with a spatial CPU index.", "gpu", "textrender/interaction/", "createAnnotationInteractionManager()"),
  demo("textrender-dynamic", "Dynamic GPU text", "Compare public and guarded-private shaping with live statistics.", "gpu", "textrender/dynamic/", "shapingMode"),
  demo("textrender-collisions", "GPU text collisions", "Combine GPU collision modes with fast Sprite2D leader lines.", "gpu", "textrender/collisions/", "leaderLine"),
  demo("textrender-stress", "GPU text stress test", "Profile moving 100–500 label workloads and shape caching.", "gpu", "textrender/stress/", "getStats()")
]);

export function getDemo(id: string): DemoEntry | undefined {
  return demos.find((entry) => entry.id === id);
}

export function getDemoNeighbors(id: string): Readonly<{ previous?: DemoEntry; next?: DemoEntry }> {
  const index = demos.findIndex((entry) => entry.id === id);
  if (index < 0) return {};
  return {
    ...(index > 0 ? { previous: demos[index - 1] } : {}),
    ...(index + 1 < demos.length ? { next: demos[index + 1] } : {})
  };
}

export function getGroupDemos(group: DemoGroupId): readonly DemoEntry[] {
  return demos.filter((entry) => entry.group === group);
}

export function demoHref(examplesRoot: URL, entry: DemoEntry): string {
  return new URL(entry.route, examplesRoot).href;
}

export function createDemoNavigation(document: Document, currentId: string, examplesRoot: URL): HTMLElement {
  const current = getDemo(currentId);
  if (!current) throw new Error(`Unknown Annotator demo '${currentId}'`);
  const neighbors = getDemoNeighbors(currentId);
  const header = document.createElement("header");
  header.className = "demo-nav";
  header.innerHTML = `
    <a class="demo-nav__brand" href="${examplesRoot.href}">Annotator <span>examples</span></a>
    <nav class="demo-nav__backends" aria-label="Demo backend">
      <a href="${new URL("#html-overlay", examplesRoot).href}"${current.group === "html" ? ' aria-current="location"' : ""}>HTML</a>
      <span aria-hidden="true">|</span>
      <a href="${new URL("#gpu-text", examplesRoot).href}"${current.group === "gpu" ? ' aria-current="location"' : ""}>GPU</a>
    </nav>
    <div class="demo-nav__location">
      <span>${current.group === "gpu" ? "GPU" : "HTML"}</span><strong>${escapeHtml(current.title)}</strong>
    </div>
    <nav class="demo-nav__sequence" aria-label="Demo sequence"></nav>
    <button class="demo-nav__menu" type="button" aria-haspopup="dialog" aria-expanded="false">All demos</button>`;
  const sequence = header.querySelector<HTMLElement>(".demo-nav__sequence")!;
  sequence.append(
    sequenceLink(document, examplesRoot, neighbors.previous, "Previous", "←"),
    sequenceLink(document, examplesRoot, neighbors.next, "Next", "→")
  );

  const menuButton = header.querySelector<HTMLButtonElement>(".demo-nav__menu")!;
  const drawer = createDrawer(document, current, examplesRoot);
  menuButton.addEventListener("click", () => {
    menuButton.setAttribute("aria-expanded", "true");
    drawer.showModal();
  });
  drawer.addEventListener("click", (event) => {
    if (event.target === drawer) drawer.close();
  });
  drawer.addEventListener("close", () => {
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.focus();
  });
  document.body.append(header, drawer);
  return header;
}

export function renderDemoCatalog(document: Document, container: HTMLElement, examplesRoot: URL): void {
  for (const group of demoGroups) {
    const section = document.createElement("section");
    section.className = "catalog-section";
    section.id = group.id === "gpu" ? "gpu-text" : "html-overlay";
    section.innerHTML = `
      <div class="catalog-section__heading">
        <div><span class="catalog-section__eyebrow">${group.id === "gpu" ? "Optional GPU backend" : "Default DOM backend"}</span>
        <h2>${escapeHtml(group.title)}</h2></div>
        <p>${escapeHtml(group.description)}</p>
      </div>
      <nav class="catalog-grid" aria-label="${escapeHtml(group.title)} demos"></nav>`;
    const grid = section.querySelector<HTMLElement>(".catalog-grid")!;
    for (const [index, entry] of getGroupDemos(group.id).entries()) {
      const link = document.createElement("a");
      link.className = "catalog-card";
      link.href = demoHref(examplesRoot, entry);
      link.innerHTML = `
        <span class="catalog-card__meta"><span class="backend-badge backend-badge--${entry.group}">${entry.group === "gpu" ? "GPU" : "HTML"}</span>${entry === demos[0] ? '<span class="start-badge">Start here</span>' : `<span>${String(index + 1).padStart(2, "0")}</span>`}</span>
        <strong>${escapeHtml(entry.title)}</strong>
        <span class="catalog-card__description">${escapeHtml(entry.description)}</span>
        <code>${escapeHtml(entry.api)}</code>`;
      grid.append(link);
    }
    container.append(section);
  }
}

function demo(
  id: string,
  title: string,
  description: string,
  group: DemoGroupId,
  route: string,
  api: string
): DemoEntry {
  return Object.freeze({ id, title, description, group, route, api, sourcePath: `examples/${route}main.ts` });
}

function sequenceLink(
  document: Document,
  examplesRoot: URL,
  entry: DemoEntry | undefined,
  label: string,
  arrow: string
): HTMLElement {
  if (!entry) {
    const disabled = document.createElement("span");
    disabled.className = "demo-nav__step demo-nav__step--disabled";
    disabled.setAttribute("aria-disabled", "true");
    disabled.innerHTML = label === "Previous"
      ? `<span aria-hidden="true">${arrow}</span><span>${label}</span>`
      : `<span>${label}</span><span aria-hidden="true">${arrow}</span>`;
    return disabled;
  }
  const link = document.createElement("a");
  link.className = "demo-nav__step";
  link.href = demoHref(examplesRoot, entry);
  link.setAttribute("aria-label", `${label}: ${entry.title}`);
  link.innerHTML = label === "Previous"
    ? `<span aria-hidden="true">${arrow}</span><span>${label}</span>`
    : `<span>${label}</span><span aria-hidden="true">${arrow}</span>`;
  return link;
}

function createDrawer(document: Document, current: DemoEntry, examplesRoot: URL): HTMLDialogElement {
  const drawer = document.createElement("dialog");
  drawer.className = "demo-drawer";
  drawer.setAttribute("aria-labelledby", "demo-drawer-title");
  drawer.innerHTML = `
    <div class="demo-drawer__surface">
      <header><div><span>Annotator</span><h2 id="demo-drawer-title">All demos</h2></div><button type="button" class="demo-drawer__close" aria-label="Close demos menu">Close</button></header>
      <div class="demo-drawer__groups"></div>
      <nav class="demo-drawer__project-links" aria-label="Project links">
        <a href="https://github.com/eldinor/lite-instancer/tree/main/packages/annotator">GitHub source</a>
        <a href="https://babylonpress.org/">BabylonPress.org</a>
      </nav>
    </div>`;
  drawer.querySelector<HTMLButtonElement>(".demo-drawer__close")!.addEventListener("click", () => drawer.close());
  const groups = drawer.querySelector<HTMLElement>(".demo-drawer__groups")!;
  for (const group of demoGroups) {
    const section = document.createElement("section");
    section.innerHTML = `<h3><span class="backend-badge backend-badge--${group.id}">${group.id === "gpu" ? "GPU" : "HTML"}</span>${escapeHtml(group.title)}</h3><nav aria-label="${escapeHtml(group.title)}"></nav>`;
    const nav = section.querySelector("nav")!;
    for (const entry of getGroupDemos(group.id)) {
      const link = document.createElement("a");
      link.href = demoHref(examplesRoot, entry);
      if (entry === current) link.setAttribute("aria-current", "page");
      link.innerHTML = `<strong>${escapeHtml(entry.title)}</strong><span>${escapeHtml(entry.description)}</span>`;
      nav.append(link);
    }
    groups.append(section);
  }
  return drawer;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
