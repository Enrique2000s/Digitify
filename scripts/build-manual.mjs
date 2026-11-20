// Builds Digitify's manual (D-149): docs/manual/manual.html into src-tauri/resources/manual/Digitify-Manual.pdf,
// which the installers carry and the app puts in Books. Icons come from the app's own set (lucide), the
// font is the app's (Nunito). Printed by Microsoft Edge or Chrome without a window (Chromium on Linux).
// Also makes its cover (docs/manual/cover.html → Digitify-Manual-cover.png).
// Run `npm run manual` after changing the manual, and raise VERSION in src-tauri/src/manual.rs.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const template = readFileSync(join(root, "docs/manual/manual.html"), "utf8");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const edition = /pub const VERSION: i64 = (\d+);/.exec(readFileSync(join(root, "src-tauri/src/manual.rs"), "utf8"))?.[1] ?? "1";

// <i data-icon="name"></i> → the icon itself.
const pattern = /<i data-icon="([a-z0-9-]+)"([^>]*)><\/i>/g;
const icons = {};
for (const name of new Set([...template.matchAll(pattern)].map((m) => m[1]))) {
  // Some names are other names of an icon: their file points to it.
  let file = join(root, "node_modules/lucide-react/dist/esm/icons", `${name}.mjs`);
  const alias = /export \{ default \} from '\.\/([a-z0-9-]+\.mjs)'/.exec(readFileSync(file, "utf8"));
  if (alias) file = join(dirname(file), alias[1]);
  const module = await import(pathToFileURL(file).href);
  icons[name] = module.__iconData.node
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([key]) => key !== "key").map(([key, value]) => `${key}="${value}"`).join(" ")}/>`)
    .join("");
}
const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long" });
const html = template
  .replace(pattern, (_, name, rest) => `<svg class="icon"${rest} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`)
  .replaceAll("{{FONT}}", pathToFileURL(join(root, "node_modules/@fontsource-variable/nunito/files/nunito-latin-wght-normal.woff2")).href)
  .replaceAll("{{VERSION}}", version)
  .replaceAll("{{EDITION}}", edition)
  .replaceAll("{{DATE}}", date);

const work = join(root, "target-manual");
mkdirSync(work, { recursive: true });
const page = join(work, "manual.html");
writeFileSync(page, html);

const browsers =
  process.platform === "win32"
    ? [
        join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Microsoft\\Edge\\Application\\msedge.exe"),
        join(process.env.ProgramFiles ?? "C:\\Program Files", "Microsoft\\Edge\\Application\\msedge.exe"),
        join(process.env.ProgramFiles ?? "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
      ]
    : ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/microsoft-edge"];
const browser = browsers.find((path) => existsSync(path));
if (!browser) {
  console.error("No Edge, Chrome or Chromium found to print the manual with.");
  process.exit(1);
}
const out = join(root, "src-tauri/resources/manual/Digitify-Manual.pdf");
mkdirSync(dirname(out), { recursive: true });
execFileSync(browser, ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", "--virtual-time-budget=4000", `--user-data-dir=${join(work, "profile")}`, `--print-to-pdf=${out}`, pathToFileURL(page).href], { stdio: "inherit" });
// Its own cover (D-150): book-shaped, 1200 × 1800, so Books shows it whole.
const coverPage = join(work, "cover.html");
writeFileSync(
  coverPage,
  readFileSync(join(root, "docs/manual/cover.html"), "utf8")
    // The font inline, so it's there before the picture is taken.
    .replaceAll("{{FONT}}", `data:font/woff2;base64,${readFileSync(join(root, "node_modules/@fontsource-variable/nunito/files/nunito-latin-wght-normal.woff2")).toString("base64")}`)
    .replaceAll("{{VERSION}}", version)
    .replaceAll("{{EDITION}}", edition),
);
const cover = join(dirname(out), "Digitify-Manual-cover.png");
execFileSync(browser, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=600,900", "--force-device-scale-factor=2", "--run-all-compositor-stages-before-draw", "--virtual-time-budget=8000", `--user-data-dir=${join(work, "profile")}`, `--screenshot=${cover}`, pathToFileURL(coverPage).href], { stdio: "inherit" });
rmSync(work, { recursive: true, force: true });
console.log(`Manual (edition ${edition}, Digitify ${version}) written to ${out}`);
