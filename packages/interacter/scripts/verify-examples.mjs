import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outputRoot = join(packageRoot, "examples-dist");
const indexPath = join(outputRoot, "index.html");

await requireFile(indexPath);
const indexHtml = await readFile(indexPath, "utf8");
const linkedPages = new Set(
  [...indexHtml.matchAll(/href=["']\.\/([^"'#?]+)\/?["']/g)]
    .map((match) => match[1].replace(/\/$/, ""))
    .filter((path) => path && !path.includes("."))
);

if (linkedPages.size === 0) {
  throw new Error("The production examples index contains no example links.");
}

for (const page of linkedPages) {
  await requireFile(join(outputRoot, page, "index.html"));
}

const builtPages = new Set(
  (await findIndexFiles(outputRoot))
    .map((path) => relative(outputRoot, dirname(path)).replaceAll("\\", "/"))
    .filter((path) => path !== "")
);
const unlinkedPages = [...builtPages].filter((page) => !linkedPages.has(page));
if (unlinkedPages.length > 0) {
  throw new Error(`Production example pages missing from the index: ${unlinkedPages.join(", ")}`);
}

console.log(`Verified ${linkedPages.size} example links and ${builtPages.size + 1} production HTML pages.`);

async function requireFile(path) {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) throw new Error(`Missing production example page: ${path}`);
}

async function findIndexFiles(directory) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...await findIndexFiles(path));
    } else if (entry.name === "index.html") {
      results.push(path);
    }
  }
  return results;
}
