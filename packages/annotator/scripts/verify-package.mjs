import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const expectedPackage = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
const temporaryDirectory = await mkdtemp(join(tmpdir(), "litools-annotator-pack-"));
const consumerDirectory = join(temporaryDirectory, "consumer");

try {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("npm_execpath is unavailable; run this verifier through npm.");

  const packed = run(process.execPath, [
    npmCli,
    "pack",
    "--json",
    "--ignore-scripts",
    "--pack-destination",
    temporaryDirectory
  ], packageRoot, {
    npm_config_cache: join(temporaryDirectory, "npm-cache"),
    npm_config_dry_run: "false"
  });

  const [metadata] = JSON.parse(packed.stdout);
  if (metadata.name !== expectedPackage.name || metadata.version !== expectedPackage.version) {
    throw new Error(`Unexpected packed identity: ${metadata.name}@${metadata.version}`);
  }
  if (!metadata.integrity || !metadata.shasum) {
    throw new Error("The packed archive is missing npm integrity metadata.");
  }

  const archivePath = join(temporaryDirectory, metadata.filename);
  const archive = await stat(archivePath);
  if (!archive.isFile() || archive.size === 0) {
    throw new Error("npm pack did not create a non-empty tarball.");
  }

  const files = new Set(metadata.files.map(({ path }) => path.replaceAll("\\", "/")));
  const required = [
    "package.json",
    "README.md",
    "API.md",
    "CHANGELOG.md",
    "LICENSE",
    "dist/index.js",
    "dist/index.js.map",
    "dist/index.d.ts",
    "dist/index.d.ts.map",
    "dist/html.js",
    "dist/html.js.map",
    "dist/html.d.ts",
    "dist/html.d.ts.map",
    "dist/instancer.js",
    "dist/instancer.js.map",
    "dist/instancer.d.ts",
    "dist/instancer.d.ts.map",
    "dist/babylon-occlusion.js",
    "dist/babylon-occlusion.js.map",
    "dist/babylon-occlusion.d.ts",
    "dist/babylon-occlusion.d.ts.map"
  ];
  const missing = required.filter((path) => !files.has(path));
  if (missing.length > 0) {
    throw new Error(`Packed archive is missing required files: ${missing.join(", ")}`);
  }

  const forbiddenPrefixes = ["src/", "tests/", "examples/", "examples-dist/", "scripts/"];
  const leaked = [...files].filter((path) => forbiddenPrefixes.some((prefix) => path.startsWith(prefix)));
  if (leaked.length > 0) {
    throw new Error(`Packed archive contains development files: ${leaked.join(", ")}`);
  }

  run(process.execPath, [
    npmCli,
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--prefix",
    consumerDirectory,
    archivePath,
    "@babylonjs/lite@^1.13.0",
    "@litools/instancer@^0.6.0",
    "typescript@^6.0.3"
  ], temporaryDirectory, {
    npm_config_cache: join(temporaryDirectory, "npm-cache")
  });

  await writeFile(
    join(consumerDirectory, "package.json"),
    `${JSON.stringify({
      name: "annotator-packed-consumer",
      private: true,
      type: "module"
    }, null, 2)}\n`
  );
  await writeFile(
    join(consumerDirectory, "tsconfig.json"),
    `${JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        lib: ["ES2022", "DOM"],
        strict: true,
        noEmit: true,
        skipLibCheck: false
      },
      include: ["index.ts"]
    }, null, 2)}\n`
  );
  await writeFile(
    join(consumerDirectory, "index.ts"),
    `import {
  createAnnotationLayer,
  createLabel,
  createMarker,
  disposeAnnotationLayer,
  getAnnotationSnapshot,
  projectAnnotationPosition,
  type AnnotationLayerOptions,
  type LabelOptions,
  type MarkerOptions
} from "@litools/annotator";
import {
  createHtmlAnnotationBackend,
  type HtmlAnnotationBackendOptions
} from "@litools/annotator/html";
import {
  createInstanceAnchor,
  type InstanceAnchorOptions
} from "@litools/annotator/instancer";
import {
  createBabylonDepthOcclusionProvider,
  type BabylonDepthOcclusionOptions
} from "@litools/annotator/babylon-occlusion";

void [
  createAnnotationLayer,
  createLabel,
  createMarker,
  disposeAnnotationLayer,
  getAnnotationSnapshot,
  projectAnnotationPosition,
  createHtmlAnnotationBackend,
  createInstanceAnchor,
  createBabylonDepthOcclusionProvider
];
type PublicTypes = [
  AnnotationLayerOptions,
  LabelOptions,
  MarkerOptions,
  HtmlAnnotationBackendOptions,
  InstanceAnchorOptions,
  BabylonDepthOcclusionOptions
];
export type { PublicTypes };
`
  );

  run(
    process.execPath,
    [join(consumerDirectory, "node_modules", "typescript", "bin", "tsc")],
    consumerDirectory
  );
  run(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `await Promise.all([
        import("@litools/annotator"),
        import("@litools/annotator/html"),
        import("@litools/annotator/instancer"),
        import("@litools/annotator/babylon-occlusion")
      ]);`
    ],
    consumerDirectory
  );

  console.log(
    `Verified packed ${metadata.name}@${metadata.version}: ${files.size} files, ` +
    `${archive.size} bytes, clean install, strict typecheck, and all four runtime imports.`
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

function run(command, args, cwd, extraEnvironment = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...extraEnvironment }
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.error?.message ?? result.stderr ?? result.stdout}`
    );
  }
  return result;
}
