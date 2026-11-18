// Copies the Windows installer the build made (deep inside src-tauri\target\release\bundle\nsis)
// to the project's own `installer` folder, so it's easy to find. Run after `tauri build`, or use
// `npm run installer`, which builds and then copies.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const built = join(root, "src-tauri", "target", "release", "bundle", "nsis");
const out = join(root, "installer");

if (!existsSync(built)) {
  console.error(`No installer found in ${built}. Build first (npm run tauri build).`);
  process.exit(1);
}
const newest = readdirSync(built)
  .filter((name) => name.endsWith("-setup.exe"))
  .map((name) => ({ name, time: statSync(join(built, name)).mtimeMs }))
  .sort((a, b) => b.time - a.time)[0];
if (!newest) {
  console.error(`No *-setup.exe in ${built}.`);
  process.exit(1);
}
mkdirSync(out, { recursive: true });
// Only the newest version's installer stays here, so an older one is never picked up by mistake.
for (const name of readdirSync(out)) {
  if (/^Digitify_.*-setup\.exe$/.test(name) && name !== newest.name) rmSync(join(out, name));
}
copyFileSync(join(built, newest.name), join(out, newest.name));
console.log(`Installer copied to ${join(out, newest.name)}`);
