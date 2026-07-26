import { version } from "../package.json";
import { renderDemoCatalog } from "./shared/navigation.js";

const versionLabel = document.querySelector<HTMLElement>("[data-package-version]");
if (!versionLabel) throw new Error("Missing package version label.");
versionLabel.textContent = `v${version}`;

const catalog = document.querySelector<HTMLElement>("#demo-catalog");
if (!catalog) throw new Error("Missing demo catalog root.");
renderDemoCatalog(document, catalog, new URL("./", window.location.href));
