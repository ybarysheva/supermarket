// Makes a Firefox copy of the extension in dist/firefox.
//
// Chrome and Firefox disagree on one manifest setting: Chrome runs the
// background as a service worker, Firefox needs a background script. One
// manifest can't hold both without Chrome warning about it, so the repo's
// manifest.json is Chrome's, and this writes Firefox's.
//
//   npm run build:firefox
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const out = root + "dist/firefox/";

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const dir of ["src", "icons"]) cpSync(root + dir, out + dir, { recursive: true });

const manifest = JSON.parse(readFileSync(root + "manifest.json", "utf8"));
manifest.background = { scripts: [manifest.background.service_worker] };
manifest.browser_specific_settings = {
  gecko: { id: "supermarket-mode@ybarysheva", strict_min_version: "128.0" },
};
delete manifest.minimum_chrome_version;
writeFileSync(out + "manifest.json", JSON.stringify(manifest, null, 2) + "\n");

console.log(`Firefox version written to ${out}`);
