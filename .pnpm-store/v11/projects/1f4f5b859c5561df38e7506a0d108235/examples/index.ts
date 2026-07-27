import { version } from "../package.json";
import { demos, getGroupDemos, renderDemoCatalog } from "./shared/navigation.js";

const versionLabel = document.querySelector<HTMLElement>("[data-package-version]");
if (!versionLabel) throw new Error("Missing package version label.");
versionLabel.textContent = `v${version}`;

const summary = document.querySelector<HTMLElement>("[data-catalog-summary]");
if (!summary) throw new Error("Missing demo catalog summary.");
summary.replaceChildren(
  summaryItem(document, `${demos.length} live demos`, true),
  summaryItem(document, `${getGroupDemos("html").length} HTML`),
  summaryItem(document, `${getGroupDemos("gpu").length} GPU`)
);

const catalog = document.querySelector<HTMLElement>("#demo-catalog");
if (!catalog) throw new Error("Missing demo catalog root.");
renderDemoCatalog(document, catalog, new URL("./", window.location.href));

function summaryItem(document: Document, text: string, strong = false): HTMLElement {
  const element = document.createElement(strong ? "strong" : "span");
  element.textContent = text;
  return element;
}
