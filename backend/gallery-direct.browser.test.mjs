import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, mkdtemp, rm, mkdir, writeFile, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename, sep } from "node:path";

const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(callback, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await callback()) return;
    await wait(50);
  }
  throw new Error("Browser condition timed out");
}

class Cdp {
  constructor(socket) {
    this.socket = socket; this.id = 0; this.pending = new Map(); this.events = new Map();
    socket.addEventListener("message", message => {
      const event = JSON.parse(message.data);
      if (event.id) {
        const pending = this.pending.get(event.id);
        this.pending.delete(event.id);
        if (event.error) pending?.reject(new Error(JSON.stringify(event.error)));
        else pending?.resolve(event.result);
      } else for (const callback of this.events.get(event.method) || []) callback(event.params);
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  on(name, callback) {
    if (!this.events.has(name)) this.events.set(name, new Set());
    this.events.get(name).add(callback);
    return () => this.events.get(name).delete(callback);
  }
  once(name) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { off(); reject(new Error("Missing " + name)); }, 10000);
      const off = this.on(name, event => { clearTimeout(timer); off(); resolve(event); });
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  async navigate(url) {
    const loaded = this.once("Page.loadEventFired");
    await this.send("Page.navigate", { url });
    await loaded;
  }
}

test("API-free gallery bookmark works in a real browser with synthetic images", {
  timeout: 60000, skip: !existsSync(chrome)
}, async t => {
  const folder = await mkdtemp(join(tmpdir(), "gallery-direct-qa-"));
  const files = new Map(await Promise.all(["gallery.html", "app.js", "config.js", "gallery-direct.js"].map(async file =>
    ["/" + file, await readFile(new URL("../" + file, import.meta.url))])));
  const server = createServer((request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    const data = files.get(path);
    response.writeHead(data ? 200 : 404, { "Content-Type": path.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8" });
    response.end(data || "Not found");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const local = "http://127.0.0.1:" + server.address().port;
  const browserProcess = spawn(chrome, ["--headless", "--disable-gpu", "--disable-background-networking", "--no-first-run",
    "--no-default-browser-check", "--remote-debugging-port=0", "--user-data-dir=" + folder, "about:blank"],
    { windowsHide: true, stdio: "ignore" });
  let cdp;
  try {
    const portFile = join(folder, "DevToolsActivePort");
    await until(() => existsSync(portFile));
    const port = (await readFile(portFile, "utf8")).split(/\r?\n/)[0];
    const targets = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
    const socket = new WebSocket(targets.find(target => target.type === "page").webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
    cdp = new Cdp(socket);
    await cdp.send("Page.enable");
    const gallery = "https://e-hentai.org/g/1234567/0123456789/";
    const requests = [], htmlStarts = [], failures = [];
    let banned = false, apiMode = "blocked";
    cdp.on("Fetch.requestPaused", event => {
      (async () => {
        const url = new URL(event.request.url);
        if (url.origin === local) { await cdp.send("Fetch.continueRequest", { requestId: event.requestId }); return; }
        requests.push(url.href);
        let html = "", type = "text/html; charset=utf-8", responseCode = 200;
        if (url.hostname.endsWith(".workers.dev")) {
          type = "application/json";
          if (apiMode === "blocked") {
            responseCode = 502;
            html = JSON.stringify({ code: "UPSTREAM_BLOCKED", error: "blocked" });
          } else if (url.pathname === "/api/images") {
            html = JSON.stringify({ source: gallery, page: 0, pageCount: 1, entries: [
              { index: 1, pageUrl: "https://e-hentai.org/s/1111111111/1234567-1" }
            ] });
          } else if (url.pathname === "/api/image") {
            html = JSON.stringify({ source: "https://e-hentai.org/s/1111111111/1234567-1", index: 1, imageUrl: "https://test.hath.network/test-1.svg" });
          } else throw new Error("Unexpected API: " + url.href);
        } else if (url.origin === "https://e-hentai.org" && url.pathname.startsWith("/g/")) {
          if (event.resourceType !== "Document") htmlStarts.push(Date.now());
          const page = Number(url.searchParams.get("p") || 0);
          html = '<!doctype html><meta charset="utf-8"><div id="gdt">' + [page * 2 + 2, page * 2 + 1].map(index =>
            '<a href="https://e-hentai.org/s/1111111111/1234567-' + index + '">image</a>').join("") +
            '</div><a href="' + gallery + '?p=1">last</a><a href="https://evil.invalid/s/1111111111/1234567-99">ad</a>';
        } else if (url.origin === "https://e-hentai.org" && url.pathname.startsWith("/s/")) {
          htmlStarts.push(Date.now());
          html = banned ? "<p>Your IP address has been temporarily banned for excessive pageloads.</p>"
            : '<img id="img" src="https://test.hath.network/test-' + url.pathname.split("-").at(-1) + '.svg">';
        } else if (url.hostname === "test.hath.network") {
          type = "image/svg+xml";
          html = '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="300"><rect width="420" height="300" fill="#edf2ff"/><text x="40" y="150" font-size="24">Test image ' + url.pathname.match(/\d+/)[0] + '</text></svg>';
        } else if (url.pathname.endsWith("favicon.ico")) {
          html = "";
        } else throw new Error("Unexpected external request: " + url.href);
        await cdp.send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode,
          responseHeaders: [{ name: "Content-Type", value: type }, { name: "Access-Control-Allow-Origin", value: local }],
          body: Buffer.from(html).toString("base64") });
      })().catch(error => failures.push(error.message));
    });
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    await cdp.navigate(local + "/gallery.html");
    const bookmark = await cdp.evaluate("document.getElementById('gallery-bookmarklet').href");
    assert.ok(bookmark.startsWith("javascript:"));
    assert.ok(decodeURIComponent(bookmark.slice(11)).includes("function directGallery()"));
    await t.test("API is tried first; bookmark help appears only on a ban and resets on retry", async () => {
      assert.equal(await cdp.evaluate("document.getElementById('direct-help').hidden"), true);
      assert.equal(requests.length, 0);
      const submit = () => cdp.evaluate("document.getElementById('url').value = " + JSON.stringify(gallery) + "; document.getElementById('url-form').requestSubmit()");
      await submit();
      await until(() => cdp.evaluate("!document.getElementById('direct-help').hidden"));
      assert.match(await cdp.evaluate("document.getElementById('status').textContent"), /アクセスを制限/);
      apiMode = "success";
      await submit();
      await until(() => cdp.evaluate("Boolean(document.querySelector('#images img')?.naturalWidth)"));
      assert.equal(await cdp.evaluate("document.getElementById('direct-help').hidden"), true);
      apiMode = "blocked";
      await submit();
      await until(() => cdp.evaluate("!document.getElementById('direct-help').hidden"));
    });
    await t.test("gallery page provides safe setup and opens the canonical source URL", async () => {
      const opened = await cdp.evaluate(`(() => {
        let opened; window.open = (...args) => { opened = args; };
        document.getElementById('url').value = ${JSON.stringify(gallery + "?p=3")};
        document.getElementById('open-original').click();
        document.getElementById('gallery-bookmarklet').click();
        return { opened, hint: document.getElementById('direct-status').textContent };
      })()`);
      assert.equal(opened.opened[0], gallery);
      assert.equal(opened.opened[2], "noopener,noreferrer");
      assert.match(opened.hint, /ブックマークバー/);
      for (const width of [1280, 390]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 });
        assert.equal(await cdp.evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
      }
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    });
    const bookmarkStart = requests.length;
    await cdp.navigate(gallery);
    const activate = () => cdp.evaluate("void (location.href = " + JSON.stringify(bookmark) + ")");
    await activate();
    await until(() => cdp.evaluate("document.querySelectorAll('#shakemaru-vertical-gallery img[src]').length === 4"));
    await until(() => cdp.evaluate("[...document.querySelectorAll('#shakemaru-vertical-gallery img')].every(image => image.complete && image.naturalWidth > 0)"));
    await t.test("images from all pages stay in order without any API calls", async () => {
      const order = await cdp.evaluate("[...document.querySelectorAll('#shakemaru-vertical-gallery li')].map(item => item.dataset.index)");
      assert.deepEqual(order, ["1", "2", "3", "4"]);
      assert.ok(requests.slice(bookmarkStart).every(url => !url.includes("workers.dev") && !url.includes("/api/")));
      assert.ok(requests.filter(url => url.includes("/s/")).length === 4);
      assert.ok(htmlStarts.every((time, index) => !index || time - htmlStarts[index - 1] >= 950));
      await activate();
      assert.equal(await cdp.evaluate("document.querySelectorAll('#shakemaru-vertical-gallery').length"), 1);
      if (process.env.GALLERY_QA_SCREENSHOT) {
        const picture = await cdp.send("Page.captureScreenshot", { format: "png" });
        const output = resolve(process.env.GALLERY_QA_SCREENSHOT);
        await mkdir(dirname(output), { recursive: true });
        await writeFile(output, Buffer.from(picture.data, "base64"));
      }
    });
    await t.test("closing stops work and restores the original page", async () => {
      await cdp.evaluate("document.getElementById('shakemaru-vertical-gallery').close()");
      await until(() => cdp.evaluate("!document.getElementById('shakemaru-vertical-gallery')"));
      assert.equal(await cdp.evaluate("document.documentElement.style.overflow"), "");
      assert.equal(await cdp.evaluate("Boolean(document.getElementById('gdt'))"), true);
      const count = requests.length;
      await wait(1100);
      assert.equal(requests.length, count);
    });
    await t.test("source-side bans stop subsequent requests", async () => {
      banned = true;
      const before = requests.filter(url => url.includes("/s/")).length;
      await activate();
      await until(() => cdp.evaluate("document.querySelector('#shakemaru-vertical-gallery [role=status]').textContent.includes('アクセスが制限')"));
      await wait(1200);
      assert.equal(requests.filter(url => url.includes("/s/")).length - before, 1);
      assert.equal(await cdp.evaluate("document.querySelector('#shakemaru-vertical-gallery > button').disabled"), true);
      await cdp.evaluate("document.getElementById('shakemaru-vertical-gallery').close()");
    });
    assert.deepEqual(failures, []);
  } finally {
    if (cdp) {
      try { await cdp.send("Browser.close"); } catch { /* Closing may terminate the connection first. */ }
      cdp.socket.close();
    }
    if (browserProcess.exitCode === null) browserProcess.kill();
    await new Promise(resolve => server.close(resolve));
    const target = await realpath(folder);
    const root = await realpath(tmpdir());
    if (!target.startsWith(root + sep) || !/^gallery-direct-qa-/.test(basename(target))) throw new Error("Unexpected temporary directory: " + target);
    await rm(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
