// @ts-check
"use strict";

/**
 * Contract test for a built Mana source.
 *
 * Loads `dist/sources/<Name>.mana` into a V8 context with host shims, then
 * exercises the methods the app actually calls and asserts the shape of what
 * comes back. A Cloudflare challenge reports SKIP rather than FAIL, so the
 * suite stays meaningful on protected sites.
 *
 *   node scripts/verify-source.mjs <Name> [--probe path] [--verbose]
 *   node scripts/verify-source.mjs --all
 *
 * Trackers (a Target with getTrackEntry/didUpdateStatus) also run the
 * read-only tracker calls. Signed-in checks need a token: set the env var
 * the probe names in "tokenEnv" and it is seeded into SecureStore under
 * "<info.id>.access_token". Nothing that writes to the account is called.
 */

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import {
  CloudflareError,
  ManaStore,
  NetworkClient,
  NetworkError,
  WebViewPage,
  decodeIntents,
} from "./harness/runtime.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_SOURCES = path.join(ROOT, "dist", "sources");

const GREEN = "[32m";
const RED = "[31m";
const YELLOW = "[33m";
const DIM = "[2m";
const RESET = "[0m";

class Skip extends Error {}

function parseArgs(argv) {
  const args = { names: [], probe: undefined, verbose: false, all: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--all") args.all = true;
    else if (arg === "--verbose" || arg === "-v") args.verbose = true;
    else if (arg === "--probe") args.probe = argv[++i];
    else if (!arg.startsWith("-")) args.names.push(arg);
  }
  return args;
}

function loadTarget(bundlePath, secrets = {}) {
  const code = fs.readFileSync(bundlePath, "utf-8");
  const store = new ManaStore();

  const sandbox = {
    NetworkClient,
    NetworkError,
    CloudflareError,
    ObjectStore: store,
    SecureStore: new ManaStore(secrets),
    WebViewPage,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    fetch,
    AbortController,
    TextEncoder,
    TextDecoder,
    URL,
    Buffer,
    globalThis: undefined,
  };
  sandbox.globalThis = sandbox;
  sandbox.global = sandbox;
  sandbox.self = sandbox;

  const context = vm.createContext(sandbox);
  vm.runInContext(code, context, { filename: path.basename(bundlePath) });

  const Target = context.Target;
  if (!Target) throw new Error(`No Target exported by ${path.basename(bundlePath)}`);
  return new Target();
}

function isCloudflare(error) {
  if (!error) return false;
  if (error.name === "CloudflareError") return true;
  const message = String(error.message ?? error);
  return /cloudflare|just a moment|challenge/i.test(message);
}

/** Wraps a step so a Cloudflare block becomes SKIP instead of FAIL. */
async function step(results, name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, status: "pass", detail, ms: Date.now() - started });
    return detail;
  } catch (error) {
    const status = isCloudflare(error) || error instanceof Skip ? "skip" : "fail";
    results.push({
      name,
      status,
      detail: String(error?.message ?? error).split("\n")[0],
      ms: Date.now() - started,
    });
    return undefined;
  }
}

function firstLine(error) {
  return String(error?.message ?? error).split(String.fromCharCode(10))[0];
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function checkHighlights(results, label) {
  assert(Array.isArray(results), `${label}: results is not an array`);
  assert(results.length > 0, `${label}: returned 0 results`);
  for (const item of results) {
    assert(item && typeof item.id === "string" && item.id.length > 0, `${label}: item missing id`);
    assert(typeof item.title === "string" && item.title.length > 0, `${label}: item missing title`);
  }
  const withCover = results.filter((item) => item.cover).length;
  return `${results.length} results, ${withCover} with covers`;
}

function checkSearchForm(form) {
  assert(form && Array.isArray(form.sections), "getSearchForm did not return { sections }");
  const ids = [];
  for (const section of form.sections) {
    for (const field of section.children ?? []) ids.push(field.id);
    if (section.field) ids.push(section.field.id);
  }
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert(duplicates.length === 0, `duplicate field ids: ${duplicates.join(", ")}`);
  return `${form.sections.length} sections, ${ids.length} fields`;
}

/** The bundle runs in its own vm realm, so `instanceof Date` would be false here. */
function isValidDate(value) {
  if (!value) return false;
  if (Object.prototype.toString.call(value) === "[object Date]") {
    return !Number.isNaN(value.getTime());
  }
  return typeof value.getTime === "function" && !Number.isNaN(value.getTime());
}

function checkChapters(chapters) {
  assert(Array.isArray(chapters), "getChapters did not return an array");
  assert(chapters.length > 0, "getChapters returned 0 chapters");
  chapters.forEach((chapter, index) => {
    assert(typeof chapter.chapterId === "string" && chapter.chapterId, `chapter ${index}: no id`);
    assert(Number.isFinite(chapter.number), `chapter ${index}: number is not finite`);
    assert(
      chapter.index === index,
      `chapter ${index}: index is ${chapter.index}, expected ${index}`,
    );
    assert(isValidDate(chapter.date), `chapter ${index}: bad date`);
  });
  const dated = chapters.filter((c) => c.date.getTime() > 0).length;
  return `${chapters.length} chapters, ${dated} with real dates`;
}

async function verify(name, probe, verbose) {
  const bundlePath = path.join(DIST_SOURCES, `${name}.mana`);
  if (!fs.existsSync(bundlePath)) {
    throw new Error(`${bundlePath} not found — run "bun run build" first`);
  }

  const token = probe.tokenEnv ? process.env[probe.tokenEnv] : undefined;
  const probeTarget = loadTarget(bundlePath);
  const secrets = token ? { [`${probeTarget.info?.id}.access_token`]: token } : {};
  const target = token ? loadTarget(bundlePath, secrets) : probeTarget;
  if (target.onEnvironmentLoaded) await target.onEnvironmentLoaded();
  const tracker = isTracker(target);

  const results = [];
  const meta = { name, info: target.info, intents: undefined };

  await step(results, "info", async () => {
    assert(target.info?.id, "info.id missing");
    assert(target.info?.version, "info.version missing");
    const thumb = target.info.thumbnail ?? "";
    // The app loads `<repo>/assets/<thumbnail>`, so the value is a bare file name in ./assets.
    assert(
      !thumb || thumb.startsWith("http") || !thumb.includes("/"),
      `thumbnail "${thumb}" must be a bare file name — the app resolves it under assets/`,
    );
    assert(
      !thumb || thumb.startsWith("http") || fs.existsSync(path.join(ROOT, "assets", thumb)),
      `assets/${thumb} does not exist — the app will show a placeholder`,
    );
    return `${target.info.id} v${target.info.version}`;
  });

  if (target.getSearchForm) {
    await step(results, "getSearchForm", async () => checkSearchForm(await target.getSearchForm()));
  }

  if (target.validateSearchForm) {
    await step(results, "validateSearchForm", async () => {
      const empty = await target.validateSearchForm({ filters: {} });
      assert(empty?.valid === true, "an empty form must be valid");
      return "empty form valid";
    });
  }

  if (target.getSortOptions) {
    await step(results, "getSortOptions", async () => {
      const options = await target.getSortOptions();
      assert(Array.isArray(options) && options.length > 0, "no sort options returned");
      return `${options.length} options`;
    });
  }

  if (target.getPreferenceMenu) {
    await step(results, "getPreferenceMenu", async () => {
      const form = await target.getPreferenceMenu();
      assert(form && Array.isArray(form.sections), "no sections returned");
      return `${form.sections.length} sections`;
    });
  }

  let sections = [];
  if (target.getSectionsForPage && target.resolvePageSection) {
    sections =
      (await step(results, "getSectionsForPage", async () => {
        const found = await target.getSectionsForPage({ id: "home" });
        assert(Array.isArray(found) && found.length > 0, "no sections returned");
        return found;
      })) ?? [];

    if (Array.isArray(sections)) {
      if (target.willResolveSectionsForPage) {
        await step(results, "willResolveSectionsForPage", async () => {
          await target.willResolveSectionsForPage({ id: "home" });
          return "ok";
        });
      }
      for (const section of sections) {
        // A section returned with `items` is already resolved; the app skips
        // resolvePageSection for it, so check what it will actually show.
        if (Array.isArray(section.items)) {
          await step(results, `getSectionsForPage(${section.id}).items`, async () =>
            checkHighlights(section.items, section.id),
          );
        }
        await step(results, `resolvePageSection(${section.id})`, async () => {
          const resolved = await target.resolvePageSection({ id: "home" }, section.id);
          return checkHighlights(resolved?.items, section.id);
        });
      }
    }
  }

  const searched = await step(results, "search", async () => {
    const page = await target.search({ page: 1, query: probe.query ?? "" });
    assert(typeof page?.isLastPage === "boolean", "isLastPage missing");
    return checkHighlights(page.results, "search");
  });

  const contentId = probe.contentId;
  if (!contentId) {
    results.push({
      name: "getContent",
      status: "skip",
      detail: "no contentId in probe",
      ms: 0,
    });
  } else {
    const content = await step(results, "getContent", async () => {
      const found = await target.getContent(contentId);
      assert(found?.title, "content.title is empty");
      assert(found?.cover !== undefined, "content.cover missing");
      return found;
    });

    if (content && target.getAdditionalInfoSectionItems) {
      for (const section of content.additionalInfo ?? []) {
        if (!section.hasMore) continue;
        await step(results, `getAdditionalInfoSectionItems(${section.id})`, async () => {
          const items = await target.getAdditionalInfoSectionItems(contentId, section.id);
          assert(Array.isArray(items), "items is not an array");
          assert(
            items.length > section.items.length,
            `hasMore was set but only ${items.length} items came back (section shows ${section.items.length})`,
          );
          for (const item of items) assert(item.id && item.title, "item missing id/title");
          return `${items.length} items (section shows ${section.items.length})`;
        });
      }
    }

    if (tracker) await verifyTracker(target, results, probe, contentId, Boolean(token));

    let chapters;
    if (target.getChapters) {
      chapters = await step(results, "getChapters", async () => {
        const found = await target.getChapters(contentId);
        checkChapters(found);
        return found;
      });
    }

    const chapterId =
      probe.chapterId ?? (Array.isArray(chapters) ? chapters[0]?.chapterId : undefined);

    if (chapterId) {
      await step(results, "getChapterData", async () => {
        // Some sources read pages through a third party that may have nothing
        // for a given issue. `"pagesDependOnUpstream": true` in the probe marks
        // that as SKIP-with-reason instead of a failure, so a genuine parsing
        // break still shows up as FAIL.
        let data;
        try {
          data = await target.getChapterData(contentId, chapterId);
        } catch (error) {
          if (probe.pagesDependOnUpstream) {
            throw new Skip(`upstream has no pages: ${firstLine(error)}`);
          }
          throw error;
        }
        assert(Array.isArray(data?.pages), "pages is not an array");
        assert(data.pages.length > 0, "0 pages returned");
        for (const page of data.pages) {
          assert(page.url || page.raw, "page has neither url nor raw");
        }
        return `${data.pages.length} pages`;
      });
    }
  }

  if (probe.url && target.handleURL) {
    await step(results, "handleURL", async () => {
      const context = await target.handleURL(probe.url);
      assert(context?.content?.id || context?.link, `handleURL did not resolve ${probe.url}`);
      return context.content ? `"${context.content.title}"` : "link";
    });
  }

  return { meta, results, verbose };
}

function isTracker(target) {
  return Boolean(
    target.getTrackEntry &&
      target.getStatusOptions &&
      target.didUpdateLastReadChapter &&
      target.didUpdateStatus &&
      target.getEntryForm &&
      target.didSubmitEntryForm,
  );
}

function checkForm(form, label) {
  assert(form && Array.isArray(form.sections), `${label} did not return { sections }`);
  const ids = form.sections.flatMap((section) => (section.children ?? []).map((child) => child.id));
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert(duplicates.length === 0, `${label}: duplicate element ids: ${duplicates.join(", ")}`);
  return `${form.sections.length} sections, ${ids.length} elements`;
}

async function verifyTracker(target, results, probe, contentId, signedIn) {
  const statuses =
    (await step(results, "getStatusOptions", async () => {
      const options = await target.getStatusOptions();
      assert(Array.isArray(options) && options.length > 0, "no status options returned");
      for (const option of options) assert(option.id && option.title, "status option missing id/title");
      return options;
    })) ?? [];

  if (target.getOAuthRequestURL) {
    await step(results, "getOAuthRequestURL", async () => {
      const request = await target.getOAuthRequestURL();
      assert(request?.url, "no authorize url returned");
      assert(request.callbackScheme, "callbackScheme missing — Mana cannot close the sign-in sheet");
      const redirect = request.params?.redirect_uri;
      assert(
        !redirect || String(redirect).startsWith(`${request.callbackScheme}:`),
        `redirect_uri "${redirect}" does not use callbackScheme "${request.callbackScheme}"`,
      );
      for (const [key, value] of Object.entries(request.params ?? {})) {
        assert(
          String(request.url).includes(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`),
          `url is missing ${key} — Mana does not forward every param, so the query must be in url too`,
        );
      }
      return String(request.url);
    });
  }

  if (!signedIn) {
    results.push({
      name: "tracker (signed in)",
      status: "skip",
      detail: probe.tokenEnv
        ? `set ${probe.tokenEnv} to run the signed-in checks`
        : 'add "tokenEnv" to the probe to run the signed-in checks',
      ms: 0,
    });
    await step(results, "getTrackEntry (signed out)", async () => {
      const entry = await target.getTrackEntry(contentId);
      assert(entry === null, "a signed-out tracker must return null");
      return "null";
    });
    return;
  }

  await step(results, "getAuthenticatedUser", async () => {
    const user = await target.getAuthenticatedUser();
    assert(user?.handle, "no user returned for the seeded token");
    return user.handle;
  });

  await step(results, "getTrackEntry", async () => {
    const entry = await target.getTrackEntry(contentId);
    if (entry === null) return "not tracked";
    assert(typeof entry.status === "string", "entry.status is not a string");
    assert(
      statuses.length === 0 || statuses.some((option) => option.id === entry.status),
      `entry.status "${entry.status}" is not one of getStatusOptions`,
    );
    assert(Number.isFinite(entry.progress?.lastReadChapter), "progress.lastReadChapter missing");
    return `${entry.status}, ch. ${entry.progress.lastReadChapter}`;
  });

  await step(results, "getEntryForm", async () =>
    checkForm(await target.getEntryForm(contentId), "getEntryForm"),
  );

  if (target.getLibraryPageLinks) {
    await step(results, "getLibraryPageLinks", async () => {
      const links = await target.getLibraryPageLinks();
      assert(Array.isArray(links), "links is not an array");
      const first = links[0];
      if (first?.link?.request) {
        const page = await target.search(first.link.request);
        assert(Array.isArray(page?.results), `${first.title}: results is not an array`);
        return `${links.length} links, "${first.title}" has ${page.results.length}`;
      }
      return `${links.length} links`;
    });
  }
}

function report(name, results) {
  const counts = { pass: 0, fail: 0, skip: 0 };
  console.log(`\n${name}`);
  for (const result of results) {
    counts[result.status]++;
    const color = result.status === "pass" ? GREEN : result.status === "fail" ? RED : YELLOW;
    const mark = result.status === "pass" ? "PASS" : result.status === "fail" ? "FAIL" : "SKIP";
    const detail =
      typeof result.detail === "string"
        ? result.detail
        : Array.isArray(result.detail)
          ? `${result.detail.length} items`
          : typeof result.detail?.title === "string"
            ? `"${result.detail.title}"`
            : "";
    console.log(
      `  ${color}${mark}${RESET} ${result.name.padEnd(32)} ${DIM}${detail} (${result.ms}ms)${RESET}`,
    );
  }
  return counts;
}

function loadProbe(name, override) {
  const probePath = override ?? path.join(ROOT, "scripts", "probes", `${name}.json`);
  if (!fs.existsSync(probePath)) return {};
  return JSON.parse(fs.readFileSync(probePath, "utf-8"));
}

function sourceDirs() {
  const manifestPath = path.join(ROOT, "dist", "sources.json");
  if (!fs.existsSync(manifestPath)) return [];
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  return (manifest.sources ?? []).map((s) => s.name);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const names = args.all ? sourceDirs() : args.names;

  if (names.length === 0) {
    console.error("usage: node scripts/verify-source.mjs <Name> [--probe path] | --all");
    process.exit(2);
  }

  const totals = { pass: 0, fail: 0, skip: 0 };

  for (const name of names) {
    const probe = loadProbe(name, args.probe);
    try {
      const { results } = await verify(name, probe, args.verbose);
      const counts = report(name, results);
      totals.pass += counts.pass;
      totals.fail += counts.fail;
      totals.skip += counts.skip;
    } catch (error) {
      console.log(`\n${name}\n  ${RED}FAIL${RESET} could not load: ${error.message}`);
      totals.fail++;
    }
  }

  console.log(
    `\n${GREEN}${totals.pass} passed${RESET}, ${RED}${totals.fail} failed${RESET}, ${YELLOW}${totals.skip} skipped${RESET}`,
  );
  process.exit(totals.fail > 0 ? 1 : 0);
}

main();
