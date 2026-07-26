import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const main = await readFile(new URL("../dist/index.js", import.meta.url), "utf8");
const html = await readFile(new URL("../dist/html.js", import.meta.url), "utf8");
const textrender = await readFile(new URL("../dist/textrender.js", import.meta.url), "utf8");
const declaration = await readFile(new URL("../dist/textrender.d.ts", import.meta.url), "utf8");

assert(packageJson.exports?.["./textrender"]?.import === "./dist/textrender.js", "Missing textrender JS export");
assert(packageJson.exports?.["./textrender"]?.types === "./dist/textrender.d.ts", "Missing textrender type export");
for (const [name, source] of [["main", main], ["html", html]]) {
  assert(!source.includes("createTextRenderer"), `${name} bundle contains TextRenderer code`);
  assert(!source.includes("layoutText"), `${name} bundle contains private layout code`);
  assert(!source.includes("createSpriteRenderer"), `${name} bundle contains Sprite2D renderer code`);
}
assert(textrender.includes("createTextRenderer"), "textrender bundle does not contain TextRenderer integration");
assert(textrender.includes("createSpriteRenderer"), "textrender bundle does not contain Sprite2D leader-line integration");
assert(textrender.includes("private text layout result is incompatible"), "textrender bundle does not contain guarded private layout");
assert(declaration.includes("createTextRendererAnnotationBackend"), "textrender declaration is missing its factory");

function assert(condition, message) {
  if (!condition) throw new Error(`verify-exports: ${message}`);
}
