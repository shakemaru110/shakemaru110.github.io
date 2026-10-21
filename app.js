"use strict";

const form = document.getElementById("url-form");
const input = document.getElementById("url");
const button = document.getElementById("enter");
const status = document.getElementById("status");
const results = document.getElementById("results");
const images = document.getElementById("images");
let activeRequest = null;

function showStatus(message, state) {
  status.textContent = message;
  status.dataset.state = state || "";
}

function parseArtwork(value) {
  let url;
  try { url = new URL(value.trim()); }
  catch { throw new Error("Pixivの作品ページのURLを入力してください。"); }
  const match = url.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?artworks\/(\d+)\/?$/i);
  if (url.protocol !== "https:" || !["www.pixiv.net", "pixiv.net"].includes(url.hostname) ||
      url.port || url.username || url.password || !match) {
    throw new Error("https://www.pixiv.net/artworks/作品ID の形式で入力してください。");
  }
  return { id: match[1], url: "https://www.pixiv.net/artworks/" + match[1] };
}

function getApiBase() {
  const value = window.IMAGE_VIEWER_CONFIG?.API_BASE;
  if (!value) {
    throw new Error("画像取得サーバーが未設定です。公開後のサーバーURLをconfig.jsに設定してください。");
  }
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("画像取得サーバーの設定を確認してください。");
  }
  return url.origin;
}

function renderImages(data, apiBase, artwork) {
  if (!Array.isArray(data.images) || !data.images.length) {
    throw new Error("この作品から表示できる画像が見つかりませんでした。");
  }
  const entries = data.images.map(function (entry) {
    const displayUrl = new URL(entry.displayUrl, apiBase);
    const originalUrl = new URL(entry.originalUrl);
    if (displayUrl.origin !== apiBase || displayUrl.pathname !== "/image" ||
        originalUrl.protocol !== "https:" || originalUrl.hostname !== "i.pximg.net") {
      throw new Error("画像取得サーバーから正しい画像リンクが返されませんでした。");
    }
    return { displayUrl: displayUrl.href, originalUrl: originalUrl.href,
      width: entry.width, height: entry.height };
  });

  document.getElementById("result-title").textContent = "作品 " + artwork.id + " · " + entries.length + "枚";
  document.getElementById("source").href = artwork.url;
  let loaded = 0;
  let failed = 0;
  const fragment = document.createDocumentFragment();
  entries.forEach(function (entry, index) {
    const item = document.createElement("li");
    const figure = document.createElement("figure");
    const img = document.createElement("img");
    img.alt = "作品 " + artwork.id + " の画像 " + (index + 1);
    img.loading = index === 0 ? "eager" : "lazy";
    img.decoding = "async";
    if (Number.isInteger(entry.width) && entry.width > 0 &&
        Number.isInteger(entry.height) && entry.height > 0) {
      img.width = entry.width;
      img.height = entry.height;
    }
    const caption = document.createElement("figcaption");
    caption.textContent = (index + 1) + " / " + entries.length;
    const error = document.createElement("p");
    error.className = "image-error";
    error.hidden = true;
    error.textContent = "画像を読み込めませんでした。Pixiv側の制限や作品の公開状態をご確認ください。";
    function updateCount() {
      if (!item.isConnected) return;
      showStatus(entries.length + "枚の画像リンクを取得しました。表示済み " + loaded + "枚" +
        (failed ? " / 読み込み失敗 " + failed + "枚" : ""), failed ? "error" : "");
    }
    img.addEventListener("load", function () { loaded += 1; updateCount(); }, { once: true });
    img.addEventListener("error", function () {
      failed += 1;
      img.hidden = true;
      error.hidden = false;
      updateCount();
    }, { once: true });
    // 画像データをJavaScriptで保存せず、取得したリンクをimg要素に指定する。
    img.src = entry.displayUrl;
    figure.append(img, error, caption);
    item.append(figure);
    fragment.append(item);
  });
  images.replaceChildren(fragment);
  results.hidden = false;
  showStatus(entries.length + "枚の画像リンクを取得しました。画像を読み込んでいます。");
}

form.addEventListener("submit", async function (event) {
  event.preventDefault();
  if (activeRequest) activeRequest.abort();
  const controller = new AbortController();
  activeRequest = controller;
  results.hidden = true;
  images.replaceChildren();
  button.disabled = true;
  button.textContent = "取得中…";
  showStatus("作品の画像リンクを取得しています。");
  const timer = setTimeout(function () { controller.abort(); }, 25000);
  try {
    const artwork = parseArtwork(input.value);
    const apiBase = getApiBase();
    const endpoint = new URL("/api/images", apiBase);
    endpoint.searchParams.set("url", artwork.url);
    const response = await fetch(endpoint, { signal: controller.signal, credentials: "omit" });
    let data;
    try { data = await response.json(); }
    catch { throw new Error("画像取得サーバーの応答を確認できませんでした。"); }
    if (!response.ok) throw new Error(data.error || "画像リンクを取得できませんでした。");
    if (activeRequest !== controller) return;
    renderImages(data, apiBase, artwork);
  } catch (error) {
    if (activeRequest !== controller) return;
    const message = controller.signal.aborted
      ? "取得に時間がかかっています。時間をおいて再度お試しください。"
      : error instanceof TypeError
        ? "画像取得サーバーに接続できませんでした。サーバーのURLと公開状態を確認してください。"
        : error.message;
    showStatus(message, "error");
  } finally {
    clearTimeout(timer);
    if (activeRequest === controller) {
      activeRequest = null;
      button.disabled = false;
      button.textContent = "Enter";
    }
  }
});

