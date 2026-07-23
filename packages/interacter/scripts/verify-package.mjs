import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const temporaryDirectory = await mkdtemp(join(tmpdir(), "litools-interacter-pack-"));

try {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("npm_execpath is unavailable; run this verifier through npm.");
  const packed = spawnSync(
    process.execPath,
    [npmCli, "pack", "--json", "--ignore-scripts", "--pack-destination", temporaryDirectory],
    {
      cwd: packageRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        npm_config_cache: join(temporaryDirectory, "npm-cache"),
        npm_config_dry_run: "false"
      }
    }
  );
  if (packed.status !== 0) {
    throw new Error(`npm pack failed:\n${packed.error?.message ?? packed.stderr ?? packed.stdout}`);
  }

  const [metadata] = JSON.parse(packed.stdout);
  if (metadata.name !== "@litools/interacter" || metadata.version !== "0.1.0") {
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
    "WHY.md",
    "CHANGELOG.md",
    "LICENSE",
    "dist/index.js",
    "dist/index.js.map",
    "dist/index.d.ts",
    "dist/index.d.ts.map"
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

  console.log(
    `Verified ${metadata.name}@${metadata.version}: ${files.size} files, ${archive.size} bytes, integrity ${metadata.integrity}.`
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
