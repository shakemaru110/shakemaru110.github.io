import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createReaderAdapter } from "./reader.js";
import worker from "./worker.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const root = "https://hitomi.la/reader/901.html";
const hash = "0".repeat(61) + "abc";
const route = "gg={m:function(g){var o=1;switch(g){case 3243:o=0;break;}return o;},s:function(h){return h;},b:'1234567890/'};";
function create() {
  return createReaderAdapter(status => Object.assign(new Error("failed"), { status }));
}
function metadata(count = 37) {
  return "var galleryinfo = " + JSON.stringify({ id: "901", title: "private title",
    files: Array.from({ length: count }, () => ({ hash, width: 100, height: 200 })) }) + ";";
}
function mock(options = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    assert.equal(init.redirect, "manual");
    assert.equal(init.cache, "no-store");
    if (url.includes("/galleries/")) return new Response(options.info ?? metadata());
    if (url.includes("/gg.js")) return new Response(options.route ?? route);
    assert.equal(init.headers.Referer, "https://hitomi.la/");
    return new Response("bytes", { status: options.status ?? 200,
      headers: { "Content-Type": options.type ?? "image/webp" } });
  };
  return calls;
}
test("case 01", () => {
  const adapter = create();
  assert.deepEqual(adapter.parse(root + "#37"), { id: "901", index: 37, url: root });
  for (const value of [root + "#0", root + "#text", root.replace("https://", "https://user:pass@")]) {
    assert.throws(() => adapter.parse(value), error => error.status === 400);
  }
  for (const value of ["https://hitomi.la.evil.invalid/reader/901.html", "http://hitomi.la/reader/901.html",
    "https://hitomi.la:444/reader/901.html", "https://127.0.0.1/reader/901.html"]) {
    assert.equal(adapter.parse(value), null);
  }
});
test("case 02", async () => {
  const calls = mock();
  const adapter = create();
  const result = await adapter.list(adapter.parse(root + "#37"), 0);
  assert.equal(result.entries.length, 37);
  assert.deepEqual(result.entries.map(entry => entry.index), Array.from({ length: 37 }, (_, index) => index + 1));
  assert.equal(result.entries.at(-1).pageUrl, root + "#37");
  assert.ok(result.entries.every(entry => entry.imageUrl.startsWith("/api/content?url=")));
  assert.ok(!JSON.stringify(result).includes("private title"));
  assert.equal(calls.length, 1);
});
test("case 03", async () => {
  const calls = mock();
  const adapter = create();
  const responses = await Promise.all([1, 37].map(index =>
    adapter.content(adapter.parse(root + "#" + index), new Headers({ "Cache-Control": "no-store" }))));
  for (const response of responses) {
    assert.equal(response.headers.get("Content-Type"), "image/webp");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(await response.text(), "bytes");
  }
  assert.equal(calls.filter(call => call.url.includes("/galleries/")).length, 1);
  assert.equal(calls.filter(call => call.url.includes("/gg.js")).length, 1);
  const imageCalls = calls.filter(call => call.url.includes("/1234567890/"));
  assert.equal(imageCalls.length, 2);
  assert.equal(imageCalls[0].url, "https://w1.gold-usergeneratedcontent.net/1234567890/3243/" + hash + ".webp");
});
test("case 04", async () => {
  const calls = mock({ status: 403 });
  const adapter = create();
  await assert.rejects(adapter.content(adapter.parse(root + "#1"), new Headers()), error => error.status === 502);
  assert.equal(calls.filter(call => call.url.includes("/1234567890/")).length, 1);
});
test("case 05", async () => {
  const calls = mock({ type: "text/html" });
  const adapter = create();
  await assert.rejects(adapter.content(adapter.parse(root + "#1"), new Headers()), error => error.status === 502);
  assert.equal(calls.length, 3);
});
test("case 06", async () => {
  mock();
  const adapter = create();
  await assert.rejects(adapter.list(adapter.parse(root), 1), error => error.status === 404);
  await assert.rejects(adapter.image(adapter.parse(root + "#38")), error => error.status === 404);
});
test("case 07", async () => {
  mock({ info: metadata() + "globalThis.readerProbe = true;" });
  const adapter = create();
  await assert.rejects(adapter.list(adapter.parse(root), 0), error => error.status === 502);
  assert.equal(globalThis.readerProbe, undefined);
});
test("case 08", async () => {
  mock({ route: "gg={m:function(g){throw new Error('bad');},b:'1234567890/'};" });
  const adapter = create();
  await assert.rejects(adapter.content(adapter.parse(root + "#1"), new Headers()), error => error.status === 502);
});
test("case 09", async () => {
  let imageCalls = 0;
  let routeCalls = 0;
  globalThis.fetch = async url => {
    if (url.includes("/galleries/")) return new Response(metadata());
    if (url.includes("/gg.js")) return new Response(route.replace("1234567890/", (++routeCalls) + "/"));
    imageCalls += 1;
    return imageCalls === 1 ? new Response("old", { status: 404 }) :
      new Response("fresh", { headers: { "Content-Type": "image/webp" } });
  };
  const adapter = create();
  const result = await adapter.content(adapter.parse(root + "#1"), new Headers());
  assert.equal(await result.text(), "fresh");
  assert.equal(routeCalls, 2);
  assert.equal(imageCalls, 2);
});
test("case 10", async () => {
  mock();
  const response = await worker.fetch(new Request("https://worker.example/api/images?url=" + encodeURIComponent(root + "#1")));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.entries.length, 37);
  assert.equal(data.source, root);
  assert.equal(data.entries.at(-1).index, 37);
});
test("case 11", async () => {
  mock();
  const adapter = create();
  const result = await adapter.image(adapter.parse(root + "#37"));
  assert.equal(result.source, root + "#37");
  assert.equal(result.index, 37);
  assert.ok(result.imageUrl.startsWith("/api/content?url="));
});
test("case 12", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("unexpected"); };
  const response = await worker.fetch(new Request("https://worker.example/api/content?url=" +
    encodeURIComponent("https://evil.invalid/reader/901.html#1")));
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
  assert.equal((await response.json()).error, "正式な形式で入力してください");
});


test("case 13", async () => {
  mock();
  const response = await worker.fetch(new Request("https://worker.example/api/content?url=" +
    encodeURIComponent(root + "#37"), { headers: { Origin: "https://shakemaru110.github.io" } }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/webp");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://shakemaru110.github.io");
  assert.equal(await response.text(), "bytes");
});
