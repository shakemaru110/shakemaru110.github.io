import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
function create(fetch) {
  const elements = new Map();
  const document = { getElementById(id) {
    if (!elements.has(id)) elements.set(id, { textContent: "", dataset: {}, addEventListener() {} });
    return elements.get(id);
  } };
  const context = createContext({ document, window: {}, fetch, URL, AbortController, setTimeout, clearTimeout, TypeError });
  runInContext(source + "\nglobalThis.api = { getJson, parseGallery, resolveEntry, enqueue };", context);
  const job = { apiBase: "https://worker.example", controller: new AbortController(), queue: [], timers: new Set(),
    entries: new Map(), paused: false, running: 0, gallery: { kind: "gallery" } };
  context.testJob = job;
  runInContext("activeJob = testJob;", context);
  return { api: context.api, job, elements, context };
}

test("API ban reason reaches the user and stops the job queue", async () => {
  let calls = 0;
  const { api, job, elements } = create(async () => {
    calls++;
    return Response.json({ error: "blocked", code: "UPSTREAM_BLOCKED" }, { status: 502 });
  });
  job.queue.push({});
  await assert.rejects(api.getJson(job, "/api/images", {}), error => error.code === "UPSTREAM_BLOCKED" && error.message.includes("画像取得サーバー"));
  assert.equal(job.paused, true);
  assert.equal(job.queue.length, 0);
  assert.match(elements.get("status").textContent, /アクセスを制限/);
  api.enqueue(job, { state: "error" });
  assert.equal(calls, 1);
});

test("challenge and login errors are distinguishable", async () => {
  for (const code of ["UPSTREAM_CHALLENGE", "UPSTREAM_LOGIN_REQUIRED"]) {
    const { api, job } = create(async () => Response.json({ code }, { status: 422 }));
    await assert.rejects(api.getJson(job, "/api/images", {}), error => error.code === code && error.message !== "取得できませんでした。");
    assert.equal(job.paused, true);
  }
});

test("an obsolete request cannot pause the current job", async () => {
  const { api, job, context, elements } = create(async () => Response.json({ code: "UPSTREAM_BLOCKED" }, { status: 502 }));
  runInContext("activeJob = null;", context);
  await assert.rejects(api.getJson(job, "/api/images", {}));
  assert.equal(job.paused, false);
  assert.equal(elements.get("status").textContent, "");
});

test("a ban preserves loaded images and cancels unfinished entries", async () => {
  const { api, job } = create(async () => Response.json({ code: "UPSTREAM_BLOCKED" }, { status: 502 }));
  let disconnected = false, removedSource = false;
  const loaded = { state: "loaded", item: { hidden: false } };
  const pending = { state: "loading", item: { hidden: false }, retry: { hidden: false }, image: {
    onload() {}, onerror() {}, removeAttribute(name) { removedSource = name === "src"; }
  } };
  job.entries.set(1, loaded);
  job.entries.set(2, pending);
  job.observer = { disconnect() { disconnected = true; } };
  job.timers.add(setTimeout(() => {}, 10000));
  try {
    await assert.rejects(api.getJson(job, "/api/image", {}));
    assert.equal(loaded.item.hidden, false);
    assert.equal(pending.item.hidden, true);
    assert.equal(pending.retry.hidden, true);
    assert.equal(pending.image.onload, null);
    assert.equal(removedSource, true);
    assert.equal(disconnected, true);
    assert.equal(job.timers.size, 0);
  } finally { job.timers.forEach(clearTimeout); }
});

test("successful JSON and the reported gallery URL still work", async () => {
  const { api, job } = create(async () => Response.json({ entries: [1, 2] }));
  assert.deepEqual(await api.getJson(job, "/api/images", {}), { entries: [1, 2] });
  assert.equal(api.parseGallery("https://e-hentai.org/g/4285211/024168dc21/").id, "4285211");
});

test("manual image retry requests fresh metadata", async () => {
  let endpoint;
  const page = "https://e-hentai.org/s/1111111111/1234567-1";
  const { api, job } = create(async url => {
    endpoint = url;
    return Response.json({ source: page, index: 1, imageUrl: "https://test.hath.network/image.jpg" });
  });
  const entry = { attempts: 1, pageUrl: page, index: 1, image: {}, message: {}, retry: {}, figure: { classList: { remove() {} } } };
  try {
    await api.resolveEntry(job, entry);
    assert.equal(endpoint.searchParams.get("refresh"), "1");
    assert.equal(entry.image.src, "https://test.hath.network/image.jpg");
  } finally { job.timers.forEach(clearTimeout); }
});
