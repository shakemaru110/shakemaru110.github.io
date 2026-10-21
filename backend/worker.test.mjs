import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.js";

const nativeFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = nativeFetch; });
const gallery = "https://e-hentai.org/g/4270520/0b04a91d26/";
const first = "https://e-hentai.org/s/a6878039d4/4270520-1";
const second = "https://e-hentai.org/s/9b1217191d/4270520-2";
function request(path, options = {}) {
  return worker.fetch(new Request("https://worker.example" + path, {
    headers: { Origin: "https://shakemaru110.github.io" }, ...options
  }));
}
function upstream(html, callback) {
  globalThis.fetch = async (url, options) => {
    assert.equal(options.redirect, "manual");
    assert.equal(options.cache, "no-store");
    if (callback) callback(url);
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  };
}
test("same-gallery pages are selected, sorted, deduplicated; ads and other galleries are excluded", async () => {
  upstream('<a href="' + second + '"><img src="https://ads.invalid/a.jpg"></a>' +
    '<a href="' + first + '">first</a><a href="' + first + '">duplicate</a>' +
    '<a href="https://e-hentai.org/s/1234567890/999-1">other gallery</a>' +
    '<a href="https://evil.invalid/s/1234567890/4270520-3">ad</a>' +
    '<a href="' + gallery + '?p=1">next</a><a href="' + gallery + '?p=9">last</a>');
  const response = await request("/api/images?url=" + encodeURIComponent(gallery));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://shakemaru110.github.io");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const data = await response.json();
  assert.equal(data.pageCount, 10);
  assert.deepEqual(data.entries, [{ index: 1, pageUrl: first }, { index: 2, pageUrl: second }]);
});
test("each request fetches just the selected index page", async () => {
  upstream('<a href="' + first + '">image</a>', url => assert.equal(url, gallery + "?p=9"));
  const response = await request("/api/images?url=" + encodeURIComponent(gallery + "?p=4") + "&page=9");
  assert.equal((await response.json()).page, 9);
});
test("only the main image is selected, including quoted attribute values containing angle brackets", async () => {
  upstream('<img src="https://ads.invalid/a.jpg"><img id="img" alt="x > y" src="https://test.hath.network/image.webp?a=1&amp;b=2"><img src="https://ehgt.org/thumb.jpg">');
  const response = await request("/api/image?url=" + encodeURIComponent(first));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { source: first, index: 1,
    imageUrl: "https://test.hath.network/image.webp?a=1&b=2" });
});
test("single quotes, different attribute order and numeric entities are supported", async () => {
  upstream("<img src='https://test.hath.network/image.webp?a=1&#38;b=2' id='img'>");
  assert.equal((await (await request("/api/image?url=" + encodeURIComponent(first))).json()).imageUrl,
    "https://test.hath.network/image.webp?a=1&b=2");
});
test("image data is never fetched by the Worker", async () => {
  let count = 0;
  upstream('<img id="img" src="https://test.hath.network/image.jpg">', url => {
    count += 1; assert.equal(url, first);
  });
  assert.equal((await request("/api/image?url=" + encodeURIComponent(first))).status, 200);
  assert.equal(count, 1);
});
test("arbitrary hosts, HTTP, credentials and custom ports cannot be requested", async () => {
  globalThis.fetch = async () => { throw new Error("must not fetch"); };
  for (const url of ["http://e-hentai.org/g/1/0123456789/", "https://e-hentai.org.evil.invalid/g/1/0123456789/",
    "https://name:password@e-hentai.org/g/1/0123456789/", "https://e-hentai.org:444/g/1/0123456789/",
    "https://127.0.0.1/g/1/0123456789/", "https://e-hentai.org/"]) {
    assert.equal((await request("/api/images?url=" + encodeURIComponent(url))).status, 400);
  }
});
test("invalid index and image-page formats are rejected", async () => {
  assert.equal((await request("/api/images?url=" + encodeURIComponent(gallery) + "&page=-1")).status, 400);
  assert.equal((await request("/api/image?url=" + encodeURIComponent(gallery))).status, 400);
});
test("unsafe image hosts, insecure URLs and quota placeholders are rejected", async () => {
  for (const url of ["https://evil.invalid/image.jpg", "http://test.hath.network/image.jpg",
    "https://test.hath.network.evil.invalid/image.jpg", "https://e-hentai.org/img/509.gif"]) {
    upstream('<img id="img" src="' + url + '">');
    assert.equal((await request("/api/image?url=" + encodeURIComponent(first))).status, 422);
  }
});
test("login or challenge pages return errors", async () => {
  upstream("<html><form>Log in</form></html>");
  assert.equal((await request("/api/images?url=" + encodeURIComponent(gallery))).status, 422);
  assert.equal((await request("/api/image?url=" + encodeURIComponent(first))).status, 422);
});
test("redirects and upstream blocks return errors", async () => {
  for (const status of [302, 403, 429, 503]) {
    globalThis.fetch = async () => new Response("", { status });
    assert.equal((await request("/api/image?url=" + encodeURIComponent(first))).status, 502);
  }
});
test("unsupported origins and methods are rejected; local preflight works", async () => {
  assert.equal((await request("/api/images", { headers: { Origin: "https://evil.invalid" } })).status, 403);
  assert.equal((await request("/api/images", { method: "POST" })).status, 405);
  const response = await request("/api/images", { method: "OPTIONS", headers: { Origin: "null" } });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "null");
});


test("HTTPS image hosts may use their assigned nonstandard port", async () => {
  upstream('<img id="img" src="https://test.hath.network:61462/image.webp">');
  const response = await request("/api/image?url=" + encodeURIComponent(first));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).imageUrl, "https://test.hath.network:61462/image.webp");
});
