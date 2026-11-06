// Puts the Linux packages that GitHub Actions built (the latest "Build installers" run) in the
// project's `installer\linux` folder, next to the Windows installer, ready to hand to someone.
// Needs the GitHub CLI, signed in once: `winget install GitHub.cli`, then `gh auth login`.
// Run with `npm run installer:linux`.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "installer", "linux");

try {
  execFileSync("gh", ["--version"], { stdio: "ignore" });
} catch {
  console.error(
    "The GitHub CLI isn't installed. Install it with `winget install GitHub.cli`, sign in with `gh auth login`, then run this again.\n" +
      "Or download the \"digitify-linux\" artifact by hand: GitHub › Actions › Build installers › the latest run › Artifacts.",
  );
  process.exit(1);
}

if (existsSync(out)) rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
try {
  // The newest run that uploaded the artifact.
  execFileSync("gh", ["run", "download", "--name", "digitify-linux", "--dir", out], { cwd: root, stdio: "inherit" });
} catch {
  console.error("Couldn't download the Linux packages. Check that the latest \"Build installers\" run on GitHub finished successfully.");
  process.exit(1);
}

// The artifact keeps the build's folders (deb/, appimage/); the files go straight in installer\linux.
const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else files.push(path);
  }
};
walk(out);
for (const file of files) {
  const target = join(out, file.split(/[\\/]/).pop());
  if (target !== file) renameSync(file, target);
}
for (const entry of readdirSync(out, { withFileTypes: true })) {
  if (entry.isDirectory()) rmSync(join(out, entry.name), { recursive: true, force: true });
}
console.log(`Linux packages in ${out}:`);
for (const name of readdirSync(out)) console.log(`  ${name}`);
