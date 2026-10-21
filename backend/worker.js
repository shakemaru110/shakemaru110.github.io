// Cloudflare Workers: HTMLからリンクだけを取得し、画像ファイルは保存・中継しません。
const SITE_ORIGIN = "https://shakemaru110.github.io";
const GALLERY_ORIGIN = "https://e-hentai.org";

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
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
  catch { throw new HttpError(400, "正しいギャラリーURLを入力してください。"); }
  if (url.origin !== GALLERY_ORIGIN || url.username || url.password) {
    throw new HttpError(400, "https://e-hentai.org/ のギャラリーに対応しています。");
  }
  return url;
}

function galleryFrom(value) {
  const url = parseUrl(value);
  const match = url.pathname.match(/^\/g\/(\d+)\/([a-f0-9]{10})\/?$/i);
  if (!match) throw new HttpError(400, "/g/番号/トークン/ のギャラリーURLを入力してください。");
  return { id: match[1], url: GALLERY_ORIGIN + "/g/" + match[1] + "/" + match[2] + "/" };
}

function imagePageFrom(value) {
  const url = parseUrl(value);
  const match = url.pathname.match(/^\/s\/([a-f0-9]{10})\/(\d+)-([1-9]\d*)\/?$/i);
  if (!match) throw new HttpError(400, "画像ページのURLが正しくありません。");
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

// 一致したタグの属性のみを読み、取得先のスクリプトは実行しない。
function tags(html, name) {
  return html.match(new RegExp("<" + name + "\\b(?:[^>\"']|\"[^\"]*\"|'[^']*')*>", "gi")) || [];
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
    if (url.origin !== GALLERY_ORIGIN || url.username || url.password) continue;
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
    throw new HttpError(422, "画像一覧が見つかりません。公開状態・ログイン要求・アクセス制限をご確認ください。");
  }
  return { source: gallery.url, galleryId: gallery.id, page: requestedPage, pageCount: lastPage + 1,
    entries: [...entries.values()].sort(function (a, b) { return a.index - b.index; }) };
}

function checkedImageUrl(value) {
  let url;
  try { url = new URL(value, GALLERY_ORIGIN); }
  catch { throw new HttpError(502, "本文画像のリンクを確認できませんでした。"); }
  const allowed = url.hostname.endsWith(".hath.network") ||
    ["ehgt.org", "e-hentai.org"].includes(url.hostname);
  if (url.protocol !== "https:" || !allowed || url.username || url.password ||
      /\/(?:509|503|kokomade)\.(?:gif|png|jpg)$/i.test(url.pathname)) {
    throw new HttpError(422, "本文画像を表示できません。配信元の制限や画像リンクをご確認ください。");
  }
  return url.href;
}

function parseImage(html, page) {
  const mainImages = tags(html, "img").map(attributes).filter(function (attrs) { return attrs.get("id") === "img"; });
  if (mainImages.length !== 1 || !mainImages[0].get("src")) {
    throw new HttpError(422, "本文画像が見つかりません。公開状態・ログイン要求・アクセス制限をご確認ください。");
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
    throw new HttpError(502, "取得先に接続できませんでした。時間をおいて再度お試しください。");
  }
  if (!response.ok) {
    throw new HttpError(502, "取得先が応答しませんでした（HTTP " + response.status + "）。アクセス制限は解除できません。");
  }
  const type = response.headers.get("Content-Type") || "";
  if (!/text\/html/i.test(type)) {
    throw new HttpError(502, "取得先からHTML以外の応答が返されました。");
  }
  const html = await response.text();
  if (html.length > 3000000) throw new HttpError(502, "ページが大きすぎるため取得を中止しました。");
  return html;
}

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin");
    if (origin && !responseHeaders(origin).has("Access-Control-Allow-Origin")) {
      return json({ error: "このサイトからのアクセスは許可されていません。" }, 403, origin);
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders(origin) });
    if (request.method !== "GET") return json({ error: "GETに対応しています。" }, 405, origin);
    try {
      const endpoint = new URL(request.url);
      if (endpoint.pathname === "/api/images") {
        const gallery = galleryFrom(endpoint.searchParams.get("url"));
        const pageValue = endpoint.searchParams.get("page") || "0";
        if (!/^\d+$/.test(pageValue) || !Number.isSafeInteger(Number(pageValue))) {
          throw new HttpError(400, "一覧のページ番号が正しくありません。");
        }
        const page = Number(pageValue);
        const html = await fetchHtml(gallery.url + (page ? "?p=" + page : ""));
        return json(parseGallery(html, gallery, page), 200, origin);
      }
      if (endpoint.pathname === "/api/image") {
        const page = imagePageFrom(endpoint.searchParams.get("url"));
        return json(parseImage(await fetchHtml(page.url), page), 200, origin);
      }
      throw new HttpError(404, "指定した機能が見つかりませんでした。");
    } catch (error) {
      return json({ error: error instanceof HttpError ? error.message : "画像リンクの取得中にエラーが発生しました。" },
        error instanceof HttpError ? error.status : 500, origin);
    }
  }
};
