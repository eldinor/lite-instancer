import {
  addToScene,
  cloneTransformNode,
  createBoxData,
  createCapsuleData,
  createCylinderData,
  createMeshFromData,
  createSphereData,
  createTorusKnotData,
  loadGltf,
  onBeforeRender,
  setThinInstances,
  type Mat4,
  type Mesh
} from "@babylonjs/lite";
import { composeMat4, createHierarchyInstanceSet, createInstanceSet, type InstanceId } from "../../../src/index.js";
import {
  computeOutlineCenter,
  createInstanceOutliner,
  createThinInstanceOutliner,
  tryGetRetainedOutlineGeometry,
  type InstanceOutlineAttachment,
  type OutlineGeometry
} from "../../../src/outline.js";
import {
  addMesh,
  collectMeshes,
  colorFromIndex,
  createExample,
  makeMatrix,
  pickInstance,
  runExample,
  type ExampleContext
} from "../../shared/app.js";
import "./styles.css";

type DemoName = "selection" | "shapes" | "shaderball" | "marble" | "colors" | "normals" | "single" | "effects" | "standalone";
const demos: DemoName[] = ["selection", "shapes", "shaderball", "marble", "colors", "normals", "single", "effects", "standalone"];
const demoLabels: Record<DemoName, string> = {
  selection: "Selection",
  shapes: "Shapes",
  shaderball: "Shader Ball",
  marble: "Marble Tower",
  colors: "Colors",
  normals: "Normals",
  single: "Single mesh",
  effects: "Effects",
  standalone: "Standalone"
};
const requested = new URLSearchParams(location.search).get("demo");
const demo: DemoName = demos.includes(requested as DemoName) ? requested as DemoName : "selection";
const ctx = await createExample(`Outline Gallery · ${demoLabels[demo]}`);
createDemoMenu(demo);
ctx.panel.root.querySelector(".panel-home")?.remove();
ctx.panel.root.classList.add("outline-controls-panel");

ctx.panel.set("scenario", demo);
ctx.panel.set("outline draws", demo === "effects" ? "1 per effect host" : "1 per host");

switch (demo) {
  case "selection": setupSelection(ctx); break;
  case "shapes": setupShapes(ctx); break;
  case "shaderball": await setupShaderBall(ctx); break;
  case "marble": await setupMarbleTower(ctx); break;
  case "colors": setupColors(ctx); break;
  case "normals": setupNormals(ctx); break;
  case "single": setupSingle(ctx); break;
  case "effects": setupEffects(ctx); break;
  case "standalone": setupStandalone(ctx); break;
}

function setupShapes(context: ExampleContext): void {
  const shapes: Array<{ name: string; data: PrimitiveData; color: readonly [number, number, number] }> = [
    { name: "box", data: createBoxData(1.7), color: [0.2, 0.46, 0.75] },
    { name: "sphere", data: createSphereData({ diameter: 1.8, segments: 24 }), color: [0.38, 0.28, 0.72] },
    { name: "cylinder", data: createCylinderData({ height: 1.9, diameter: 1.35, tessellation: 32 }), color: [0.18, 0.58, 0.55] },
    { name: "capsule", data: createCapsuleData({ height: 2, radius: 0.55, tessellation: 24 }), color: [0.64, 0.32, 0.28] },
    { name: "torus", data: createTorusGalleryData(2, 0.55, 36), color: [0.68, 0.45, 0.16] },
    {
      name: "torus knot",
      data: createTorusKnotData({ radius: 0.85, tube: 0.24, radialSegments: 96, tubularSegments: 20, p: 2, q: 3 }),
      color: [0.58, 0.2, 0.55]
    }
  ];
  const manager = createInstanceOutliner(context.engine, context.scene);
  shapes.forEach((shape, index) => {
    const host = createHost(context, `shape-${shape.name}`, shape.data, shape.color);
    const instances = createInstanceSet(host, { capacity: 1, engine: context.engine });
    const column = index % 3;
    const row = Math.floor(index / 3);
    const id = instances.create(makeMatrix((column - 1) * 4.2, 0, (row - 0.5) * 4, shape.name === "torus knot" ? 0.8 : 1));
    const outline = manager.attach(instances, {
      geometry: shape.data,
      thickness: shape.name === "torus knot" ? 0.07 : 0.1,
      color: colorFromIndex(index + 2).slice(0, 3) as [number, number, number]
    });
    outline.highlight(id, { phase: index / shapes.length });
  });
  context.panel.set("shapes", shapes.map((shape) => shape.name).join(", "));
  context.panel.set("highlighted", shapes.length);
}

async function setupShaderBall(context: ExampleContext): Promise<void> {
  const assetUrl = "https://assets.babylonjs.com/meshes/shaderBall.glb";
  context.panel.set("asset", "loading shaderBall.glb");

  const container = await loadGltf(context.engine, assetUrl);
  const root = container.entities[0];
  if (!root || !("children" in root) || !("scaling" in root)) {
    throw new Error("Shader Ball GLB did not provide a scene root");
  }
  root.scaling.set(-2.1, 2.1, 2.1);
  addToScene(context.scene, container);

  const meshes = collectMeshes(root);
  const sourceRootMatrix = new Float32Array(root.worldMatrix) as Mat4;
  const shaderBalls = createHierarchyInstanceSet(root, {
    capacity: 5,
    engine: context.engine
  });
  const placements = [
    makeMatrix(-5, 0, -2.4, 1, -0.35),
    makeMatrix(0, 0, -2.4, 1, 0),
    makeMatrix(5, 0, -2.4, 1, 0.35),
    makeMatrix(-2.5, 0, 2.4, 1, 0.2),
    makeMatrix(2.5, 0, 2.4, 1, -0.2)
  ];
  const ids = placements.map((placement) =>
    shaderBalls.create(multiplyExampleMat4(composeMat4(placement), sourceRootMatrix))
  );
  const outlinedInstances: Array<{ slot: number; color: [number, number, number]; phase: number }> = [];
  ids.forEach((id, index) => {
    const slot = shaderBalls.getSlot(id);
    if (slot !== undefined) {
      outlinedInstances.push({
        slot,
        color: colorFromIndex(index + 2).slice(0, 3) as [number, number, number],
        phase: index / ids.length
      });
    }
  });

  const manager = createThinInstanceOutliner(context.engine, context.scene);
  const attachments: Array<ReturnType<typeof manager.attach>> = [];
  let skipped = 0;
  for (const mesh of meshes) {
    const retainedGeometry = tryGetRetainedOutlineGeometry(mesh);
    if (!retainedGeometry) {
      skipped++;
      continue;
    }
    mesh.renderOrder = 100;
    const attachment = manager.attach(mesh, {
      geometry: retainedGeometry,
      smoothNormals: true,
      thickness: 0.035,
      color: [0.12, 0.82, 1],
      pulse: { speed: 2.2, amplitude: 0.22 }
    });
    outlinedInstances.forEach(({ slot, color, phase }) => {
      attachment.highlight(slot, { color, phase });
    });
    attachments.push(attachment);
  }

  let visible = true;
  context.panel.button("toggle outline", () => {
    visible = !visible;
    for (const attachment of attachments) {
      for (const { slot, color, phase } of outlinedInstances) {
        if (visible) attachment.highlight(slot, { color, phase });
        else attachment.clear(slot);
      }
    }
    context.panel.set("outline", visible ? "shown" : "hidden");
    context.panel.set("highlighted", visible ? `${ids.length} balls across ${attachments.length} mesh parts` : 0);
  });
  context.panel.set("asset", "shaderBall.glb");
  context.panel.set("instances", shaderBalls.count);
  context.panel.set("instancer", "hierarchy instance set");
  context.panel.set("source meshes", meshes.length);
  context.panel.set("outlined meshes", attachments.length);
  context.panel.set("skipped geometry", skipped);
  context.panel.set("geometry", "retained CPU data (version-sensitive)");
  context.panel.set("loader", "native Babylon Lite loadGltf");
  context.panel.set("winding", "inverted hull from retained glTF geometry");
  context.panel.set("outline", "shown");
  context.panel.set("highlighted", `${ids.length} balls across ${attachments.length} mesh parts`);
}

async function setupMarbleTower(context: ExampleContext): Promise<void> {
  const assetUrl = "https://assets.babylonjs.com/meshes/Marble/marbleTower/marbleTower.gltf";
  context.panel.set("asset", "loading marbleTower.gltf");

  const container = await loadGltf(context.engine, assetUrl);
  const root = container.entities[0];
  if (!root || !("children" in root) || !("scaling" in root)) {
    throw new Error("Marble Tower glTF did not provide a scene root");
  }
  root.scaling.set(-0.42, 0.42, 0.42);
  root.position.set(-10, 8.4, 0);
  const towerRoots = [root, cloneTransformNode(root), cloneTransformNode(root)];
  towerRoots[1]!.position.set(0, 8.4, 0);
  towerRoots[2]!.position.set(10, 8.4, 0);
  addToScene(context.scene, container);
  addToScene(context.scene, towerRoots[1]!);
  addToScene(context.scene, towerRoots[2]!);

  const towerMeshes = towerRoots.map((towerRoot) => collectMeshes(towerRoot));
  const wheelStates = towerMeshes.map((meshes, index) => {
    const mesh = meshes.find((source) => source.name.toLowerCase().startsWith("wheel"));
    const geometry = mesh ? tryGetRetainedOutlineGeometry(mesh) : null;
    if (!mesh || !geometry) {
      throw new Error(`Marble Tower ${index + 1} did not provide retained geometry for its wheel mesh`);
    }
    return {
      mesh,
      pivot: computeOutlineCenter(geometry.positions),
      basePosition: [mesh.position.x, mesh.position.y, mesh.position.z] as const,
      angle: index * 0.35,
      speed: 0.00018 + index * 0.00002
    };
  });
  onBeforeRender(context.scene, (deltaMs) => {
    for (const wheel of wheelStates) {
      wheel.angle = (wheel.angle + deltaMs * wheel.speed) % (Math.PI * 2);
      rotateMeshAroundLocalX(wheel.mesh, wheel.pivot, wheel.basePosition, wheel.angle);
    }
  });

  const manager = createThinInstanceOutliner(context.engine, context.scene);
  const attachments: Array<ReturnType<typeof manager.attach>> = [];
  const partNames: string[] = [];
  const palettes = [
    { body: [1, 0.55, 0.12], wheel: [0.08, 0.82, 0.78] },
    { body: [0.28, 0.62, 1], wheel: [0.3, 1, 0.68] },
    { body: [0.82, 0.34, 1], wheel: [1, 0.35, 0.62] }
  ] as const;
  let skipped = 0;
  towerMeshes.forEach((meshes, towerIndex) => {
    const palette = palettes[towerIndex]!;
    const wheel = wheelStates[towerIndex]!.mesh;
    meshes.forEach((source) => {
      const retainedGeometry = tryGetRetainedOutlineGeometry(source);
      if (!retainedGeometry) {
        skipped++;
        return;
      }
      source.renderOrder = 100;
      const attachment = manager.attach(source, {
        geometry: retainedGeometry,
        smoothNormals: true,
        thickness: 8,
        color: source === wheel ? palette.wheel : palette.body
      });
      attachment.highlight(0);
      attachments.push(attachment);
      partNames.push(`${towerIndex + 1}:${source.name}`);
    });
  });

  let visible = true;
  context.panel.button("toggle outlines", () => {
    visible = !visible;
    for (const attachment of attachments) {
      if (visible) attachment.highlight(0);
      else attachment.clear(0);
    }
    context.panel.set("outlines", visible ? "shown" : "hidden");
    context.panel.set("highlighted", visible ? attachments.length : 0);
  });
  context.panel.set("asset", "marbleTower.gltf");
  context.panel.set("towers", towerRoots.length);
  context.panel.set("spacing", "10 world units");
  context.panel.set("parts", partNames.join(", "));
  context.panel.set("source meshes", towerMeshes.reduce((total, meshes) => total + meshes.length, 0));
  context.panel.set("outlined meshes", attachments.length);
  context.panel.set("skipped geometry", skipped);
  context.panel.set("loader", "native Babylon Lite loadGltf");
  context.panel.set("wheels", "rotating at 0.18, 0.20, and 0.22 rad/s");
  context.panel.set("palettes", "orange/teal, blue/mint, violet/pink");
  context.panel.set("winding", "inverted hull from retained glTF geometry");
  context.panel.set("outline draws", `${attachments.length} (one per mesh part)`);
  context.panel.set("outlines", "shown");
  context.panel.set("highlighted", attachments.length);
}

await runExample(ctx);

function createDemoMenu(activeDemo: DemoName): void {
  const header = document.createElement("header");
  header.className = "outline-demo-menu";

  const home = document.createElement("a");
  home.className = "outline-demo-home";
  home.href = "/";
  home.textContent = "Examples";

  const title = document.createElement("span");
  title.className = "outline-demo-title";
  title.textContent = "Instance outlines";

  const navigation = document.createElement("nav");
  navigation.setAttribute("aria-label", "Outline demo scenarios");
  for (const name of demos) {
    const link = document.createElement("a");
    link.href = `?demo=${name}`;
    link.textContent = demoLabels[name];
    if (name === activeDemo) {
      link.className = "is-active";
      link.setAttribute("aria-current", "page");
    }
    navigation.append(link);
  }

  header.append(home, title, navigation);
  document.body.append(header);
}

function setupSelection(context: ExampleContext): void {
  const data = createBoxData(1);
  const host = createHost(context, "selection-boxes", data, [0.22, 0.42, 0.7]);
  const instances = createInstanceSet(host, { capacity: 4, grow: "double", engine: context.engine, colors: true });
  const outliner = createInstanceOutliner(context.engine, context.scene);
  const outline = outliner.attach(instances, { geometry: data, thickness: 0.07, color: [1, 0.75, 0.15] });
  context.registry.register(host, instances);
  const ids: InstanceId[] = [];
  let selected: InstanceId | undefined;
  for (let i = 0; i < 12; i++) ids.push(addSelectionInstance(instances, i));

  context.canvas.addEventListener("pointerdown", async (event) => {
    const picked = await pickInstance(context, event);
    if (!picked || picked.mesh !== host) return;
    if (selected && instances.has(selected)) outline.clear(selected);
    selected = picked.id;
    outline.highlight(selected, { color: colorFromIndex(Number(selected)).slice(0, 3) as [number, number, number] });
    updateSelectionStatus();
  });
  context.panel.button("add", () => {
    const id = addSelectionInstance(instances, ids.length + 20);
    ids.push(id);
    updateSelectionStatus();
  });
  context.panel.button("remove selected", () => {
    if (!selected || !instances.has(selected)) return;
    outline.clear(selected);
    instances.remove(selected);
    const index = ids.indexOf(selected);
    if (index >= 0) ids.splice(index, 1);
    selected = undefined;
    outline.refresh();
    updateSelectionStatus();
  });
  context.panel.button("toggle visible", () => {
    if (!selected || !instances.has(selected)) return;
    instances.setVisible(selected, !instances.getVisible(selected));
    outline.refresh(selected);
    updateSelectionStatus();
  });
  context.panel.button("move selected", () => {
    if (!selected || !instances.has(selected)) return;
    const p = instances.getPosition(selected);
    instances.setPosition(selected, [p[0]!, p[1]! + 1, p[2]!]);
    outline.refresh(selected);
  });
  updateSelectionStatus();

  function updateSelectionStatus(): void {
    context.panel.set("count", instances.count);
    context.panel.set("capacity", instances.capacity);
    context.panel.set("selected id", selected ? Number(selected) : "-");
    context.panel.set("current slot", selected ? instances.getSlot(selected) ?? "-" : "-");
    context.panel.set("highlighted", outline.highlightedCount);
  }
}

function setupColors(context: ExampleContext): void {
  const data = createSphereData({ diameter: 1.4, segments: 20 });
  const host = createHost(context, "colored-spheres", data, [0.18, 0.26, 0.42]);
  const instances = createInstanceSet(host, { capacity: 12, engine: context.engine });
  const outline = createInstanceOutliner(context.engine, context.scene).attach(instances, {
    geometry: data,
    thickness: 0.09,
    pulse: { speed: 2.4, amplitude: 0.35 }
  });
  for (let i = 0; i < 9; i++) {
    const id = instances.create(makeMatrix((i % 3 - 1) * 3, 0, (Math.floor(i / 3) - 1) * 3));
    outline.highlight(id, { color: colorFromIndex(i).slice(0, 3) as [number, number, number], phase: i / 9 });
  }
  context.panel.set("highlighted", outline.highlightedCount);
}

function setupNormals(context: ExampleContext): void {
  const manager = createInstanceOutliner(context.engine, context.scene);
  const shapes: Array<{ name: string; data: PrimitiveData }> = [
    { name: "box", data: createBoxData(1.8) },
    {
      name: "hexagonal prism",
      data: createCylinderData({ height: 1.9, diameter: 1.65, tessellation: 6 })
    },
    {
      name: "square pyramid",
      data: createCylinderData({ height: 2, diameterTop: 0, diameterBottom: 1.9, tessellation: 4 })
    },
    {
      name: "triangular prism",
      data: createCylinderData({ height: 1.9, diameter: 1.9, tessellation: 3 })
    }
  ];
  let highlighted = 0;
  shapes.forEach((shape, index) => {
    const z = (index - (shapes.length - 1) / 2) * 3;
    const smooth = createNormalExample(context, manager, shape.name, shape.data, -2.4, z, true, [0.2, 0.62, 0.9]);
    const split = createNormalExample(context, manager, shape.name, shape.data, 2.4, z, false, [1, 0.38, 0.25]);
    highlighted += smooth.highlightedCount + split.highlightedCount;
  });
  context.panel.set("left column", "smoothed normals");
  context.panel.set("right column", "authored hard normals");
  context.panel.set("shapes", shapes.map((shape) => shape.name).join(", "));
  context.panel.set("highlighted", highlighted);
}

function setupSingle(context: ExampleContext): void {
  const data = createBoxData(1.8);
  const manager = createThinInstanceOutliner(context.engine, context.scene);
  const normal = createHost(context, "single-nonuniform", data, [0.2, 0.5, 0.62]);
  normal.position.set(-2.5, 0, 0);
  normal.scaling.set(1.7, 0.7, 1);
  manager.attach(normal, { geometry: data, thickness: 0.09, color: [0.2, 0.9, 1] }).highlight(0);
  const mirrored = createHost(context, "single-mirrored", data, [0.58, 0.24, 0.5]);
  mirrored.position.set(2.5, 0, 0);
  mirrored.scaling.set(-1.4, 1, 1);
  manager.attach(mirrored, { geometry: data, thickness: 0.09, color: [1, 0.35, 0.72] }).highlight(0);
  context.panel.set("left", "non-uniform scale");
  context.panel.set("right", "negative determinant");
}

function setupEffects(context: ExampleContext): void {
  const manager = createInstanceOutliner(context.engine, context.scene);
  const configs = [
    {
      name: "pulse",
      shape: "sphere",
      data: createSphereData({ diameter: 1.7, segments: 22 }),
      scale: 1,
      options: { pulse: { speed: 3, amplitude: 0.75 } }
    },
    {
      name: "cycle",
      shape: "torus",
      data: createTorusGalleryData(2, 0.58, 36),
      scale: 1,
      options: { colorCycle: { period: 3 } }
    },
    {
      name: "edge",
      shape: "capsule",
      data: createCapsuleData({ height: 2.1, radius: 0.52, tessellation: 24 }),
      scale: 1,
      options: { edgeFlow: { axis: "y" as const, speed: 0.7, width: 0.22, accentColor: [1, 0.9, 0.3] as const, boost: 1.5 } }
    },
    {
      name: "rim",
      shape: "torus knot",
      data: createTorusKnotData({ radius: 0.82, tube: 0.23, radialSegments: 96, tubularSegments: 20, p: 2, q: 3 }),
      scale: 0.78,
      options: { rimFlow: { speed: 0.45, width: 0.2, accentColor: [0.2, 1, 1] as const, boost: 1.5 } }
    },
    {
      name: "sizzle",
      shape: "box",
      data: createBoxData(1.65),
      scale: 1,
      options: { sizzle: { scale: 4, speed: 1.8, threshold: 0.55, color: [1, 0.4, 0.15] as const, boost: 1.4 } }
    }
  ];
  configs.forEach((config, index) => {
    const host = createHost(context, `effect-${config.name}-${config.shape}`, config.data, [0.22, 0.27, 0.38]);
    const instances = createInstanceSet(host, { capacity: 1, engine: context.engine });
    const id = instances.create(makeMatrix((index - 2) * 2.8, 0, 0, config.scale, index * 0.35, config.shape === "torus" ? 0.45 : 0));
    const attachment = manager.attach(instances, { geometry: config.data, thickness: 0.1, color: [0.35, 0.75, 1], ...config.options });
    attachment.highlight(id, { phase: index / configs.length });
  });
  context.panel.set("effects", configs.map((item) => `${item.name}: ${item.shape}`).join(", "));
}

function setupStandalone(context: ExampleContext): void {
  const data = createBoxData(1.5);
  const host = createHost(context, "raw-thin-instances", data, [0.28, 0.38, 0.62]);
  const matrices = new Float32Array(4 * 16);
  for (let i = 0; i < 4; i++) matrices.set(composeMat4(makeMatrix((i - 1.5) * 2.5, 0, 0)), i * 16);
  setThinInstances(host, matrices, 4);
  const attachment = createThinInstanceOutliner(context.engine, context.scene).attach(host, {
    geometry: data,
    thickness: 0.1,
    color: [1, 0.65, 0.18]
  });
  attachment.highlight(0);
  attachment.highlight(2, { color: [0.2, 1, 0.75] });
  context.panel.set("raw active count", host.thinInstances?.count ?? 0);
  context.panel.set("highlighted", attachment.highlightedCount);
}

function createNormalExample(
  context: ExampleContext,
  manager: ReturnType<typeof createInstanceOutliner>,
  shapeName: string,
  data: PrimitiveData,
  x: number,
  z: number,
  smoothNormals: boolean,
  color: readonly [number, number, number]
): InstanceOutlineAttachment {
  const mode = smoothNormals ? "smooth" : "hard";
  const host = createHost(context, `normals-${shapeName}-${mode}`, data, [0.26, 0.32, 0.44]);
  const instances = createInstanceSet(host, { capacity: 1, engine: context.engine });
  const id = instances.create(makeMatrix(x, 0, z, 1, 0.35));
  const attachment = manager.attach(instances, { geometry: data, smoothNormals, thickness: 0.12, color });
  attachment.highlight(id);
  return attachment;
}

function createHost(
  context: ExampleContext,
  name: string,
  data: PrimitiveData,
  color: readonly [number, number, number]
): Mesh {
  return addMesh(
    context.scene,
    createMeshFromData(context.engine, name, data.positions, data.normals, data.indices, data.uvs),
    color
  );
}

interface PrimitiveData extends OutlineGeometry {
  uvs: Float32Array;
}

function createTorusGalleryData(diameter: number, thickness: number, tessellation: number): PrimitiveData {
  const stride = tessellation + 1;
  const positions = new Float32Array(stride * stride * 3);
  const normals = new Float32Array(stride * stride * 3);
  const uvs = new Float32Array(stride * stride * 2);
  const indices = new Uint32Array(stride * stride * 6);
  const majorRadius = diameter * 0.5;
  const minorRadius = thickness * 0.5;
  let vertexOffset = 0;
  let uvOffset = 0;
  let indexOffset = 0;
  for (let outer = 0; outer <= tessellation; outer++) {
    const outerAngle = outer * Math.PI * 2 / tessellation - Math.PI * 0.5;
    const cosOuter = Math.cos(outerAngle);
    const sinOuter = Math.sin(outerAngle);
    for (let inner = 0; inner <= tessellation; inner++) {
      const innerAngle = inner * Math.PI * 2 / tessellation + Math.PI;
      const radial = Math.cos(innerAngle);
      const vertical = Math.sin(innerAngle);
      positions[vertexOffset] = (radial * minorRadius + majorRadius) * cosOuter;
      positions[vertexOffset + 1] = vertical * minorRadius;
      positions[vertexOffset + 2] = -(radial * minorRadius + majorRadius) * sinOuter;
      normals[vertexOffset] = radial * cosOuter;
      normals[vertexOffset + 1] = vertical;
      normals[vertexOffset + 2] = -radial * sinOuter;
      vertexOffset += 3;
      uvs[uvOffset++] = outer / tessellation;
      uvs[uvOffset++] = 1 - inner / tessellation;
      const nextOuter = (outer + 1) % stride;
      const nextInner = (inner + 1) % stride;
      indices[indexOffset++] = outer * stride + inner;
      indices[indexOffset++] = outer * stride + nextInner;
      indices[indexOffset++] = nextOuter * stride + inner;
      indices[indexOffset++] = outer * stride + nextInner;
      indices[indexOffset++] = nextOuter * stride + nextInner;
      indices[indexOffset++] = nextOuter * stride + inner;
    }
  }
  return { positions, normals, uvs, indices };
}

function multiplyExampleMat4(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      out[column * 4 + row] =
        (a[row] ?? 0) * (b[column * 4] ?? 0) +
        (a[4 + row] ?? 0) * (b[column * 4 + 1] ?? 0) +
        (a[8 + row] ?? 0) * (b[column * 4 + 2] ?? 0) +
        (a[12 + row] ?? 0) * (b[column * 4 + 3] ?? 0);
    }
  }
  return out as Mat4;
}

function rotateMeshAroundLocalX(
  mesh: Mesh,
  pivot: readonly [number, number, number],
  basePosition: readonly [number, number, number],
  angle: number
): void {
  const sine = Math.sin(angle);
  const cosine = Math.cos(angle);
  const halfAngle = angle * 0.5;
  mesh.rotationQuaternion.set(Math.sin(halfAngle), 0, 0, Math.cos(halfAngle));
  mesh.position.set(
    basePosition[0],
    basePosition[1] + pivot[1] - (cosine * pivot[1] - sine * pivot[2]),
    basePosition[2] + pivot[2] - (sine * pivot[1] + cosine * pivot[2])
  );
}

function addSelectionInstance(instances: ReturnType<typeof createInstanceSet>, index: number): InstanceId {
  const col = index % 6;
  const row = Math.floor(index / 6);
  const id = instances.create(makeMatrix((col - 2.5) * 1.8, 0, (row - 0.5) * 2));
  instances.setColor(id, colorFromIndex(index));
  return id;
}
