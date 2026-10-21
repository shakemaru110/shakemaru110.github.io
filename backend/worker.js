// Cloudflare Workers: 外部パッケージ、画像ストレージ、ログイン情報は使用しません。
const SITE_ORIGIN = "https://shakemaru110.github.io";
const PIXIV_ORIGIN = "https://www.pixiv.net";

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function headersFor(origin) {
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
  const headers = headersFor(origin);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { status, headers });
}

function getArtworkId(value) {
  let url;
  try { url = new URL(value); }
  catch { throw new HttpError(400, "Pixivの作品URLを入力してください。"); }
  const match = url.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?artworks\/(\d+)\/?$/i);
  if (url.protocol !== "https:" || !["www.pixiv.net", "pixiv.net"].includes(url.hostname) ||
      url.port || url.username || url.password || !match) {
    throw new HttpError(400, "現在はPixivの作品URLに対応しています。");
  }
  return match[1];
}

async function pixivFetch(url, accept) {
  try {
    return await fetch(url, {
      headers: { "Referer": PIXIV_ORIGIN + "/", "Accept": accept },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    throw new HttpError(502, "Pixivに接続できませんでした。時間をおいて再度お試しください。");
  }
}

function originalUrl(page, id, index) {
  let url;
  try { url = new URL(page?.urls?.original); }
  catch { throw new HttpError(502, "作品の画像URLを確認できませんでした。"); }
  const file = new RegExp("^/img-original/img/[0-9/]+/" + id + "_p" + index + "\\.(jpg|jpeg|png|gif|webp|avif)$", "i");
  if (url.origin !== "https://i.pximg.net" || url.username || url.password ||
      url.search || !file.test(url.pathname)) {
    throw new HttpError(422, "この作品形式にはまだ対応していません。");
  }
  return url.href;
}

async function getPages(id) {
  // ページ全体のimgを収集せず、作品本文の画像一覧だけを取得する。
  // Pixivのサイト内部で使われるエンドポイントのため、仕様変更時は対応が必要。
  const response = await pixivFetch(PIXIV_ORIGIN + "/ajax/illust/" + id + "/pages", "application/json");
  if (!response.ok) {
    throw new HttpError(502, "Pixivから画像一覧を取得できませんでした。非公開・削除済み・ログインが必要な作品は表示できません。");
  }
  let data;
  try { data = await response.json(); }
  catch { throw new HttpError(502, "Pixivの応答形式を確認できませんでした。"); }
  if (data.error || !Array.isArray(data.body) || !data.body.length) {
    throw new HttpError(422, "公開された作品画像が見つかりませんでした。ログインが必要な作品には対応していません。");
  }
  return data.body;
}

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin");
    if (origin && !headersFor(origin).has("Access-Control-Allow-Origin")) {
      return json({ error: "このサイトからのアクセスは許可されていません。" }, 403, origin);
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: headersFor(origin) });
    }
    if (request.method !== "GET") {
      return json({ error: "GETに対応しています。" }, 405, origin);
    }
    try {
      const url = new URL(request.url);
      if (url.pathname === "/api/images") {
        const id = getArtworkId(url.searchParams.get("url"));
        const pages = await getPages(id);
        const images = pages.map(function (page, index) {
          return {
            originalUrl: originalUrl(page, id, index),
            displayUrl: "/image?id=" + id + "&page=" + index,
            width: page.width,
            height: page.height
          };
        });
        return json({ source: PIXIV_ORIGIN + "/artworks/" + id, images }, 200, origin);
      }
      if (url.pathname === "/image") {
        const id = url.searchParams.get("id") || "";
        const pageValue = url.searchParams.get("page") || "";
        if (!/^\d+$/.test(id) || !/^\d+$/.test(pageValue)) {
          throw new HttpError(400, "作品IDまたはページ番号が正しくありません。");
        }
        const index = Number(pageValue);
        const pages = await getPages(id);
        if (!Number.isSafeInteger(index) || index >= pages.length) {
          throw new HttpError(404, "指定したページは見つかりませんでした。");
        }
        const image = await pixivFetch(originalUrl(pages[index], id, index), "image/*");
        if (!image.ok) throw new HttpError(502, "Pixivの画像を読み込めませんでした。");
        const type = image.headers.get("Content-Type") || "";
        if (!/^image\/(png|jpe?g|gif|webp|avif)(;|$)/i.test(type)) {
          if (image.body) await image.body.cancel();
          throw new HttpError(502, "画像以外の応答を受信しました。");
        }
        const headers = headersFor(origin);
        headers.set("Content-Type", type);
        headers.set("Content-Disposition", "inline");
        // arrayBufferやファイル保存を使わず、受信ストリームをそのままブラウザに渡す。
        return new Response(image.body, { status: 200, headers });
      }
      throw new HttpError(404, "指定した機能が見つかりませんでした。");
    } catch (error) {
      return json({ error: error instanceof HttpError ? error.message : "画像の取得中にエラーが発生しました。" },
        error instanceof HttpError ? error.status : 500, origin);
    }
  }
};

