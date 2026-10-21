const SITE_ORIGIN = "https://shakemaru110.github.io";
const GALLERY_ORIGIN = "https://e-hentai.org";

class HttpError extends Error {
  constructor(status, message, code, diagnostics) {
    super(message); this.status = status; this.code = code; this.diagnostics = diagnostics;
  }
}

function responseHeaders(origin) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Origin"
  });
  if (origin === SITE_ORIGIN || origin === "null" ||
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || "")) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  }
  return headers;
}

function json(data, status, origin) {
  const headers = responseHeaders(origin);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { status, headers });
}

function parseUrl(value) {
  let url;
  try { url = new URL(value); }
  catch { throw new HttpError(400, "正式な形式で入力してください"); }
  if (url.origin !== GALLERY_ORIGIN || url.username || url.password) {
    throw new HttpError(400, "正式な形式で入力してください");
  }
  return url;
}

function galleryFrom(value) {
  const url = parseUrl(value);
  const match = url.pathname.match(/^\/g\/(\d+)\/([a-f0-9]{10})\/?$/i);
  if (!match) throw new HttpError(400, "正式な形式で入力してください");
  return { id: match[1], url: GALLERY_ORIGIN + "/g/" + match[1] + "/" + match[2] + "/" };
}

function imagePageFrom(value) {
  const url = parseUrl(value);
  const match = url.pathname.match(/^\/s\/([a-f0-9]{10})\/(\d+)-([1-9]\d*)\/?$/i);
  if (!match) throw new HttpError(400, "正式な形式で入力してください");
  return { id: match[2], index: Number(match[3]),
    url: GALLERY_ORIGIN + "/s/" + match[1] + "/" + match[2] + "-" + match[3] };
}

function decodeHtml(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, function (entity, key) {
    const named = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
    if (key[0] !== "#") return named[key.toLowerCase()];
    const numeric = key[1].toLowerCase() === "x" ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
    return numeric > 0 && numeric <= 0x10ffff ? String.fromCodePoint(numeric) : entity;
  });
}

function attributes(tag) {
  const result = new Map();
  const pattern = /([^\s=<>/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\x60]+)))?/g;
  for (const match of tag.matchAll(pattern)) {
    result.set(match[1].toLowerCase(), decodeHtml(match[2] ?? match[3] ?? match[4] ?? ""));
  }
  return result;
}

function tags(html, name) {
  return html.match(new RegExp("<" + name + "\\b(?:[^>\"']|\"[^\"]*\"|'[^']*')*>", "gi")) || [];
}

function missingContent(html, kind) {
  const text = decodeHtml(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " ")).trim();
  const diagnostics = {
    characters: html.length,
    anchorCount: tags(html, "a").length,
    imageCount: tags(html, "img").length,
    hasGalleryContainer: /\bid\s*=\s*["']gdt["']/i.test(html),
    hasMainImage: /\bid\s*=\s*["']img["']/i.test(html)
  };
  if (/your ip address[\s\S]{0,200}(?:banned|blocked)|temporarily banned|excessive page(?:loads| loads)|access denied|^\s*nope\.?\s*$/i.test(text)) {
    return new HttpError(502, "アクセスが制限されています。", "UPSTREAM_BLOCKED", diagnostics);
  }
  if (/cf-chl-|challenge-platform|g-recaptcha|h-captcha/i.test(html) || /just a moment|verify (?:that )?you are human/i.test(text)) {
    return new HttpError(502, "確認が必要なため、取得できませんでした。", "UPSTREAM_CHALLENGE", diagnostics);
  }
  if (/must be logged in|please (?:log|sign) in to|login required/i.test(text)) {
    return new HttpError(422, "認証が必要です。", "UPSTREAM_LOGIN_REQUIRED", diagnostics);
  }
  if (!text && !tags(html, "a").length && !tags(html, "img").length) {
    return new HttpError(502, "応答を確認できませんでした。", "UPSTREAM_EMPTY", diagnostics);
  }
  return new HttpError(422, kind === "gallery" ? "取得できませんでした。" :
    "取得できませんでした。",
    kind === "gallery" ? "GALLERY_MARKUP_NOT_FOUND" : "IMAGE_MARKUP_NOT_FOUND", diagnostics);
}



function parseGallery(html, gallery, requestedPage) {
  const entries = new Map();
  let lastPage = requestedPage;
  for (const tag of tags(html, "a")) {
    const href = attributes(tag).get("href");
    if (!href) continue;
    let url;
    try { url = new URL(href, gallery.url); }
    catch { continue; }
    if (url.hostname !== "e-hentai.org" || !["https:", "http:"].includes(url.protocol) || url.port || url.username || url.password) continue;
    url.protocol = "https:";
    const imageMatch = url.pathname.match(/^\/s\/([a-f0-9]{10})\/(\d+)-([1-9]\d*)\/?$/i);
    if (imageMatch && imageMatch[2] === gallery.id) {
      const index = Number(imageMatch[3]);
      if (Number.isSafeInteger(index)) {
        entries.set(index, { index, pageUrl: GALLERY_ORIGIN + url.pathname.replace(/\/$/, "") });
      }
    }
    if (url.pathname === new URL(gallery.url).pathname) {
      const page = url.searchParams.get("p");
      if (page && /^\d+$/.test(page) && Number.isSafeInteger(Number(page))) {
        lastPage = Math.max(lastPage, Number(page));
      }
    }
  }
  if (!entries.size) {
    throw missingContent(html, "gallery");
  }
  return { source: gallery.url, galleryId: gallery.id, page: requestedPage, pageCount: lastPage + 1,
    entries: [...entries.values()].sort(function (a, b) { return a.index - b.index; }) };
}

function checkedImageUrl(value) {
  let url;
  try { url = new URL(value, GALLERY_ORIGIN); }
  catch { throw new HttpError(502, "応答を確認できませんでした。"); }
  const allowed = url.hostname.endsWith(".hath.network") ||
    ["ehgt.org", "e-hentai.org"].includes(url.hostname);
  if (url.protocol !== "https:" || !allowed || url.username || url.password ||
      /\/(?:509|503|kokomade)\.(?:gif|png|jpg)$/i.test(url.pathname)) {
    throw new HttpError(422, "表示できませんでした。");
  }
  return url.href;
}

function parseImage(html, page) {
  const mainImages = tags(html, "img").map(attributes).filter(function (attrs) { return attrs.get("id") === "img"; });
  if (mainImages.length !== 1 || !mainImages[0].get("src")) {
    throw missingContent(html, "image");
  }
  return { source: page.url, index: page.index, imageUrl: checkedImageUrl(mainImages[0].get("src")) };
}

async function fetchHtml(url) {
  let response;
  try {
    response = await fetch(url, {
      headers: { "Accept": "text/html", "Referer": GALLERY_ORIGIN + "/" },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    throw new HttpError(502, "接続できませんでした。時間をおいて再度お試しください。");
  }
  if (!response.ok) {
    throw new HttpError(502, "取得できませんでした。");
  }
  const type = response.headers.get("Content-Type") || "";
  if (!/text\/html/i.test(type)) {
    throw new HttpError(502, "応答を確認できませんでした。");
  }
  const html = await response.text();
  if (html.length > 3000000) throw new HttpError(502, "処理できませんでした。");
  return html;
}

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin");
    if (origin && !responseHeaders(origin).has("Access-Control-Allow-Origin")) {
      return json({ error: "アクセスが許可されていません。" }, 403, origin);
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders(origin) });
    if (request.method !== "GET") return json({ error: "許可されていない操作です。" }, 405, origin);
    try {
      const endpoint = new URL(request.url);
      if (endpoint.pathname === "/api/images") {
        const gallery = galleryFrom(endpoint.searchParams.get("url"));
        const pageValue = endpoint.searchParams.get("page") || "0";
        if (!/^\d+$/.test(pageValue) || !Number.isSafeInteger(Number(pageValue))) {
          throw new HttpError(400, "入力内容を確認してください。");
        }
        const page = Number(pageValue);
        const html = await fetchHtml(gallery.url + (page ? "?p=" + page : ""));
        return json(parseGallery(html, gallery, page), 200, origin);
      }
      if (endpoint.pathname === "/api/image") {
        const page = imagePageFrom(endpoint.searchParams.get("url"));
        return json(parseImage(await fetchHtml(page.url), page), 200, origin);
      }
      throw new HttpError(404, "見つかりませんでした。");
    } catch (error) {
      return json({ error: error instanceof HttpError ? error.message : "処理中にエラーが発生しました。",
        code: error.code, diagnostics: error.diagnostics },
        error instanceof HttpError ? error.status : 500, origin);
    }
  }
};
