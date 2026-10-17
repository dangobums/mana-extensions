// @ts-check
"use strict";

/**
 * Scaffolds a new source from templates/source, or a tracker from
 * templates/tracker with `--tracker`.
 *
 *   node scripts/new-source.mjs <Name> --id <id> --url <https://site> [--description "..."] [--tracker]
 *
 * Copies the template directory, rewrites the class name and `info` block,
 * seeds a CHANGELOG section in the exact format scripts/build-page.js parses,
 * and adds a README table row.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function parseArgs(argv) {
  const args = {
    name: undefined,
    id: undefined,
    url: undefined,
    description: undefined,
    tracker: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--id") args.id = argv[++i];
    else if (arg === "--url") args.url = argv[++i];
    else if (arg === "--description") args.description = argv[++i];
    else if (arg === "--tracker") args.tracker = true;
    else if (!arg.startsWith("-") && !args.name) args.name = arg;
  }
  return args;
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function hostOf(url) {
  return url
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

const args = parseArgs(process.argv.slice(2));

if (!args.name) {
  console.error(
    'usage: node scripts/new-source.mjs <Name> --id <id> --url <https://site> [--description "..."] [--tracker]',
  );
  process.exit(2);
}
if (!/^[A-Z][A-Za-z0-9]*$/.test(args.name)) {
  fail(`"${args.name}" must be PascalCase with no spaces — it becomes the directory name`);
}

const name = args.name;
const id = (args.id ?? name.toLowerCase()).trim();
const url = (args.url ?? "").replace(/\/+$/, "");
const tracker = args.tracker;
const kind = tracker ? "tracker" : "source";
const TEMPLATE = path.join(ROOT, "templates", kind);
const host = hostOf(url) || "the site";
const description =
  args.description ?? (tracker ? `Tracks reading on ${host}` : `Pulls comics from ${host}`);

if (!url) fail("--url is required (the site's base URL, e.g. https://example.com)");
if (!/^https?:\/\//i.test(url)) fail(`--url must start with http:// or https:// (got "${url}")`);

const dest = path.join(ROOT, "src", name);
if (fs.existsSync(dest)) fail(`src/${name} already exists`);
if (!fs.existsSync(TEMPLATE)) fail(`templates/${kind} is missing — nothing to copy from`);

// -- copy ------------------------------------------------------------------

fs.mkdirSync(dest, { recursive: true });
for (const entry of fs.readdirSync(TEMPLATE, { withFileTypes: true })) {
  const from = path.join(TEMPLATE, entry.name);
  const to = path.join(dest, entry.name);
  if (entry.isDirectory()) fs.cpSync(from, to, { recursive: true });
  else fs.copyFileSync(from, to);
}

// -- rewrite main.ts -------------------------------------------------------

const mainPath = path.join(dest, "main.ts");
let main = fs.readFileSync(mainPath, "utf-8");
main = main
  .replace(/class Template(?:Tracker)?Source\b/, `class ${name}Source`)
  .replace(/extends Template(?:Tracker)?Source\b/, `extends ${name}Source`)
  .replace(/id: "template(?:-tracker)?",/, `id: "${id}",`)
  .replace(/linkKeys: \[[^\]]*\],/, `linkKeys: ["${id}"],`)
  .replace(/thumbnail: "[^"]*",/, `thumbnail: "${name}.png",`)
  .replace(/name: "Template(?:Tracker)?",/, `name: "${name}",`)
  .replace(/version: "[^"]*",/, 'version: "1.0.0",')
  .replace(/description: "[^"]*",/, `description: "${description.replace(/"/g, '\\"')}",`)
  .replace(/owningLinks: \[[^\]]*\],/, `owningLinks: ["${hostOf(url)}"],`);
fs.writeFileSync(mainPath, main, "utf-8");

// -- rewrite model.ts ------------------------------------------------------

const modelPath = path.join(dest, "model.ts");
let model = fs.readFileSync(modelPath, "utf-8");
model = model.replace(
  /export const (BASE_URL|SITE_URL) = "[^"]*";/,
  (_, constant) => `export const ${constant} = "${url}";`,
);
model = model.replace("oauth/template-tracker", `oauth/${id}`);
fs.writeFileSync(modelPath, model, "utf-8");

// -- probe -----------------------------------------------------------------

const probeDir = path.join(ROOT, "scripts", "probes");
fs.mkdirSync(probeDir, { recursive: true });
fs.writeFileSync(
  path.join(probeDir, `${name}.json`),
  `${JSON.stringify(
    tracker
      ? { query: "", contentId: "", url: "", tokenEnv: `${name.toUpperCase()}_TOKEN` }
      : { query: "batman", contentId: "", chapterId: "" },
    null,
    2,
  )}\n`,
  "utf-8",
);

// -- CHANGELOG -------------------------------------------------------------

const changelogPath = path.join(ROOT, "CHANGELOG.md");
if (fs.existsSync(changelogPath)) {
  const changelog = fs.readFileSync(changelogPath, "utf-8");
  if (!changelog.includes(`## ${name} (current:`)) {
    const today = new Date().toISOString().slice(0, 10);
    const section = `## ${name} (current: v1.0.0)\n\n### ${today}\n- Initial implementation.\n\n`;
    const firstSection = changelog.indexOf("\n## ");
    const updated =
      firstSection === -1
        ? `${changelog.trimEnd()}\n\n${section}`
        : `${changelog.slice(0, firstSection + 1)}${section}${changelog.slice(firstSection + 1)}`;
    fs.writeFileSync(changelogPath, updated, "utf-8");
  }
}

// -- README table ----------------------------------------------------------

const readmePath = path.join(ROOT, "README.md");
if (fs.existsSync(readmePath)) {
  const readme = fs.readFileSync(readmePath, "utf-8");
  const type = tracker ? "Tracker" : "Source";
  const row = `| <img src="assets/${name}.png" width="28" height="28" alt=""> | ${name} | ${type} | 1.0.0 | ${tracker ? "Mixed" : "Safe"} |`;
  const lines = readme.split("\n");
  let lastRow = -1;
  for (let i = 0; i < lines.length; i++) {
    // Rows are column-aligned, so the leading pipe carries variable padding.
    if (/^\|\s*<img /.test(lines[i])) lastRow = i;
  }
  if (lastRow < 0) {
    process.stderr.write(`warning: no source rows in README.md; add ${name} by hand\n`);
  } else {
    lines.splice(lastRow + 1, 0, row);
    fs.writeFileSync(readmePath, lines.join("\n"), "utf-8");
  }
}

console.log(`created src/${name}`);
console.log("");
console.log("next:");
console.log(`  1. drop an icon at assets/${name}.png`);
console.log(
  tracker
    ? `  2. point src/${name}/main.ts at the tracker's API and map its list statuses in model.ts`
    : `  2. fill in the selectors in src/${name}/main.ts and the filters in model.ts`,
);
console.log(
  tracker
    ? `  3. put a real contentId in scripts/probes/${name}.json (and a token in its tokenEnv var)`
    : `  3. put a real contentId/chapterId in scripts/probes/${name}.json`,
);
console.log(`  4. bun run typecheck && bun run build && bun run verify ${name}`);
