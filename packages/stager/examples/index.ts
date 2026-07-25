import { version } from "../package.json";

const versionLabel = document.querySelector<HTMLElement>("[data-package-version]");
if (!versionLabel) throw new Error("Missing package version label.");
versionLabel.textContent = `v${version}`;
