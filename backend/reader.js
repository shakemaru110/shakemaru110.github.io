const ROOT = "https://hitomi.la";
const DATA = "https://ltn.gold-usergeneratedcontent.net";

export function createReaderAdapter(failure) {
  const records = new Map();
  let routingPromise = null;
  let routingExpires = 0;

  function parse(value) {
    let url;
    try { url = new URL(value); } catch { return null; }
    if (url.origin !== ROOT) return null;
    const match = url.pathname.match(/^\/reader\/([1-9]\d{0,11})\.html$/);
    if (!match || url.username || url.password || (url.hash && !/^#[1-9]\d*$/.test(url.hash))) {
      throw failure(400);
    }
    const index = url.hash ? Number(url.hash.slice(1)) : 1;
    if (!Number.isSafeInteger(index)) throw failure(400);
    return { id: match[1], index, url: ROOT + "/reader/" + match[1] + ".html" };
  }

  async function text(url) {
    let response;
    try {
      response = await fetch(url, {
        headers: { "Accept": "application/javascript, application/json, text/plain", "Referer": ROOT + "/" },
        redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(15000)
      });
    } catch { throw failure(502); }
    if (!response.ok) {
      if (response.body) await response.body.cancel();
      throw failure(502);
    }
    const body = await response.text();
    if (body.length > 3000000) throw failure(502);
    return body;
  }

  async function files(id) {
    const cached = records.get(id);
    if (cached && cached.expires > Date.now()) return cached.promise;
    const record = { expires: Date.now() + 60000, promise: null };
    record.promise = (async function () {
      const source = await text(DATA + "/galleries/" + id + ".js");
      const match = source.match(/^\s*(?:var|let|const)\s+galleryinfo\s*=\s*([\s\S]+?)\s*;?\s*$/);
      let data;
      try { data = JSON.parse(match ? match[1] : source); } catch { throw failure(502); }
      if (!data || typeof data !== "object" || String(data.id) !== id || !Array.isArray(data.files) || !data.files.length || data.files.length > 10000) {
        throw failure(422);
      }
      return data.files.map(function (file) {
        if (!file || !/^[0-9a-f]{64}$/.test(file.hash) || !Number.isSafeInteger(file.width) ||
            !Number.isSafeInteger(file.height) || file.width < 1 || file.height < 1) {
          throw failure(422);
        }
        return { hash: file.hash, width: file.width, height: file.height };
      });
    })();
    records.set(id, record);
    if (records.size > 8) records.delete(records.keys().next().value);
    try { return await record.promise; }
    catch (error) { if (records.get(id) === record) records.delete(id); throw error; }
  }

  function parseRouting(source) {
    const prefix = source.match(/\bb\s*:\s*["'](\d+\/)["']/);
    const mapping = source.match(/\bm\s*:\s*function\s*\(\s*g\s*\)\s*\{\s*var\s+o\s*=\s*([01])\s*;\s*switch\s*\(\s*g\s*\)\s*\{([\s\S]*?)\}\s*return\s+o\s*;\s*\}/);
    if (!prefix || !mapping) throw failure(502);
    const table = new Map();
    const blocks = /((?:\s*case\s+\d+\s*:\s*)+)o\s*=\s*([01])\s*;\s*break\s*;/g;
    let cursor = 0;
    for (const block of mapping[2].matchAll(blocks)) {
      if (mapping[2].slice(cursor, block.index).trim()) throw failure(502);
      for (const item of block[1].matchAll(/case\s+(\d+)\s*:/g)) {
        const index = Number(item[1]);
        if (index > 4095) throw failure(502);
        table.set(index, Number(block[2]));
      }
      cursor = block.index + block[0].length;
    }
    if (mapping[2].slice(cursor).trim()) throw failure(502);
    return { prefix: prefix[1], fallback: Number(mapping[1]), table };
  }

  async function routing(refresh) {
    if (refresh || !routingPromise || routingExpires <= Date.now()) {
      routingExpires = Date.now() + 60000;
      routingPromise = text(DATA + "/gg.js?_=" + Date.now()).then(parseRouting);
    }
    try { return await routingPromise; }
    catch (error) { routingExpires = 0; throw error; }
  }

  function imageUrl(file, route) {
    const number = parseInt(file.hash.slice(-1) + file.hash.slice(-3, -1), 16);
    const shard = (route.table.get(number) ?? route.fallback) + 1;
    return "https://w" + shard + ".gold-usergeneratedcontent.net/" +
      route.prefix + number + "/" + file.hash + ".webp";
  }

  function contentUrl(source, index) {
    return "/api/content?url=" + encodeURIComponent(source + "#" + index);
  }

  async function list(source, page) {
    if (page !== 0) throw failure(404);
    const entries = await files(source.id);
    return {
      source: source.url, galleryId: source.id, page: 0, pageCount: 1,
      entries: entries.map(function (file, offset) {
        const index = offset + 1;
        return { index, pageUrl: source.url + "#" + index,
          imageUrl: contentUrl(source.url, index), width: file.width, height: file.height };
      })
    };
  }

  async function image(source) {
    records.delete(source.id);
    routingExpires = 0;
    const entries = await files(source.id);
    if (source.index > entries.length) throw failure(404);
    return { source: source.url + "#" + source.index, index: source.index,
      imageUrl: contentUrl(source.url, source.index) + "&v=" + Date.now() };
  }

  async function content(source, headers) {
    const entries = await files(source.id);
    if (source.index > entries.length) throw failure(404);
    const file = entries[source.index - 1];
    let response;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const url = imageUrl(file, await routing(attempt > 0));
      try {
        response = await fetch(url, {
          headers: { "Referer": ROOT + "/", "Accept": "image/webp" },
          redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(30000)
        });
      } catch { throw failure(502); }
      if (response.status !== 404 || attempt > 0) break;
      if (response.body) await response.body.cancel();
    }
    const type = response.headers.get("Content-Type") || "";
    if (!response.ok || !/^image\/webp(?:;|$)/i.test(type)) {
      if (response.body) await response.body.cancel();
      throw failure(502);
    }
    headers.set("Content-Type", type);
    headers.set("Content-Disposition", "inline");
    return new Response(response.body, { status: 200, headers });
  }

  return { parse, list, image, content };
}
