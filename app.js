"use strict";

const form = document.getElementById("url-form");
const input = document.getElementById("url");
const button = document.getElementById("enter");
const status = document.getElementById("status");
const results = document.getElementById("results");
const images = document.getElementById("images");
let activeJob = null;

function showStatus(message, state) {
  status.textContent = message;
  status.dataset.state = state || "";
}

function parseGallery(value) {
  let url;
  try { url = new URL(value.trim()); }
  catch { throw new Error("正式な形式で入力してください"); }
  const match = url.pathname.match(/^\/g\/(\d+)\/([a-f0-9]{10})\/?$/i);
  if (url.origin !== "https://e-hentai.org" || url.username || url.password || !match) {
    throw new Error("正式な形式で入力してください");
  }
  return { id: match[1], url: "https://e-hentai.org/g/" + match[1] + "/" + match[2] + "/" };
}

function apiBase() {
  const value = window.IMAGE_VIEWER_CONFIG?.API_BASE;
  if (!value) throw new Error("設定を確認してください。");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("設定を確認してください。");
  }
  return url.origin;
}

function isCurrent(job) {
  return activeJob === job && !job.controller.signal.aborted;
}

function progress(job) {
  if (!isCurrent(job)) return;
  const failed = [...job.entries.values()].filter(function (entry) { return entry.state === "error"; }).length;
  if (job.listError) showStatus(job.listError, "error");
  else if (failed) showStatus(failed + "枚の画像を読み込めませんでした。", "error");
  else showStatus(job.complete ? "" : "読み込み中…");
}

async function getJson(job, path, values) {
  const endpoint = new URL(path, job.apiBase);
  Object.entries(values).forEach(function (entry) { endpoint.searchParams.set(entry[0], entry[1]); });
  const controller = new AbortController();
  const cancel = function () { controller.abort(); };
  job.controller.signal.addEventListener("abort", cancel, { once: true });
  if (job.controller.signal.aborted) controller.abort();
  const timer = setTimeout(cancel, 25000);
  try {
    const response = await fetch(endpoint, { signal: controller.signal, credentials: "omit", cache: "no-store" });
    let data;
    try { data = await response.json(); }
    catch { throw new Error("応答を確認できませんでした。"); }
    if (!response.ok) throw new Error(response.status === 400 ? "正式な形式で入力してください" : "取得できませんでした。");
    return data;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("取得が中断されたか、時間がかかりすぎています。");
    if (error instanceof TypeError) throw new Error("接続できませんでした。");
    throw error;
  } finally {
    clearTimeout(timer);
    job.controller.signal.removeEventListener("abort", cancel);
  }
}

function validImageUrl(value) {
  const url = new URL(value);
  const allowed = url.hostname.endsWith(".hath.network") || ["ehgt.org", "e-hentai.org"].includes(url.hostname);
  if (url.protocol !== "https:" || !allowed || url.username || url.password) {
    throw new Error("応答を確認できませんでした。");
  }
  return url.href;
}

function failEntry(job, entry, message) {
  if (!isCurrent(job)) return;
  entry.state = "error";
  entry.image.removeAttribute("src");
  entry.image.hidden = true;
  entry.figure.classList.remove("pending");
  entry.message.textContent = message;
  entry.message.hidden = false;
  entry.retry.hidden = false;
  progress(job);
}

async function resolveEntry(job, entry) {
  entry.state = "loading";
  entry.message.textContent = "読み込み中…";
  entry.message.hidden = false;
  entry.retry.hidden = true;
  try {
    const data = await getJson(job, "/api/image", { url: entry.pageUrl });
    if (!isCurrent(job)) return;
    if (data.source !== entry.pageUrl || data.index !== entry.index) {
      throw new Error("応答を確認できませんでした。");
    }
    const url = validImageUrl(data.imageUrl);
    entry.image.hidden = false;
    const loadingTimer = setTimeout(function () {
      if (entry.state === "loading") failEntry(job, entry, "読み込めませんでした。再度お試しください。");
    }, 45000);
    job.timers.add(loadingTimer);
    entry.image.onload = function () {
      clearTimeout(loadingTimer);
      job.timers.delete(loadingTimer);
      if (!isCurrent(job) || entry.state !== "loading") return;
      entry.state = "loaded";
      entry.figure.classList.remove("pending");
      entry.message.hidden = true;
      progress(job);
    };
    entry.image.onerror = function () {
      clearTimeout(loadingTimer);
      job.timers.delete(loadingTimer);
      if (entry.state === "loading") failEntry(job, entry, "読み込めませんでした。再度お試しください。");
    };
    entry.image.src = url;
  } catch (error) {
    failEntry(job, entry, error.message);
  }
}

function pump(job) {
  if (!isCurrent(job)) return;
  while (job.running < 2 && job.queue.length) {
    const entry = job.queue.shift();
    job.running += 1;
    resolveEntry(job, entry).finally(function () { job.running -= 1; pump(job); });
  }
}

function enqueue(job, entry) {
  if (!isCurrent(job) || !["waiting", "error"].includes(entry.state)) return;
  entry.state = "queued";
  job.queue.push(entry);
  pump(job);
}

function appendEntries(job, data) {
  if (!Array.isArray(data.entries) || !data.entries.length ||
      !Number.isSafeInteger(data.pageCount) || data.pageCount < 1 || data.source !== job.gallery.url) {
    throw new Error("応答を確認できませんでした。");
  }
  const sorted = [...data.entries].sort(function (a, b) { return a.index - b.index; });
  const fragment = document.createDocumentFragment();
  const added = [];
  for (const dataEntry of sorted) {
    if (!Number.isSafeInteger(dataEntry.index) || dataEntry.index < 1) {
      throw new Error("入力内容を確認してください。");
    }
    if (job.entries.has(dataEntry.index)) continue;
    const pageUrl = new URL(dataEntry.pageUrl);
    const match = pageUrl.pathname.match(/^\/s\/[a-f0-9]{10}\/(\d+)-([1-9]\d*)$/i);
    if (pageUrl.origin !== "https://e-hentai.org" || pageUrl.username || pageUrl.password ||
        pageUrl.search || pageUrl.hash || !match || match[1] !== job.gallery.id ||
        Number(match[2]) !== dataEntry.index) {
      throw new Error("応答を確認できませんでした。");
    }
    const item = document.createElement("li");
    const figure = document.createElement("figure");
    figure.className = "pending";
    const image = document.createElement("img");
    image.alt = dataEntry.index + "ページ目";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.hidden = true;
    const message = document.createElement("p");
    message.className = "image-message";
    message.hidden = true;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "retry";
    retry.textContent = "再読み込み";
    retry.hidden = true;
    figure.append(image, message, retry);
    item.append(figure);
    const entry = { index: dataEntry.index, pageUrl: pageUrl.href, item, figure, image, message, retry, state: "waiting" };
    retry.addEventListener("click", function () { enqueue(job, entry); });
    job.entries.set(entry.index, entry);
    job.byItem.set(item, entry);
    fragment.append(item);
    added.push(entry);
  }
  images.append(fragment);
  for (const entry of added) {
    if (job.observer) job.observer.observe(entry.item);
    else enqueue(job, entry);
  }
}

form.addEventListener("submit", async function (event) {
  event.preventDefault();
  if (activeJob) {
    activeJob.controller.abort();
    activeJob.observer?.disconnect();
    activeJob.timers.forEach(clearTimeout);
  }
  images.replaceChildren();
  results.hidden = true;
  activeJob = null;
  let job;
  try {
    const gallery = parseGallery(input.value);
    job = { gallery, apiBase: apiBase(), controller: new AbortController(), entries: new Map(),
      byItem: new WeakMap(), timers: new Set(), queue: [], running: 0, observer: null,
      pageCount: 1, pagesRead: 0, complete: false, listError: "" };
    activeJob = job;
    if ("IntersectionObserver" in window) {
      job.observer = new IntersectionObserver(function (entries) {
        for (const observed of entries) {
          if (observed.isIntersecting) {
            job.observer.unobserve(observed.target);
            enqueue(job, job.byItem.get(observed.target));
          }
        }
      }, { rootMargin: "800px 0px" });
    }
    button.textContent = "取得中…";
    showStatus("読み込み中…");
    for (let page = 0; page < job.pageCount; page += 1) {
      const data = await getJson(job, "/api/images", { url: gallery.url, page: String(page) });
      if (!isCurrent(job)) return;
      if (data.page !== page) throw new Error("応答を確認できませんでした。");
      appendEntries(job, data);
      job.pageCount = Math.max(job.pageCount, data.pageCount);
      job.pagesRead = page + 1;
      results.hidden = false;
      progress(job);
    }
    job.complete = true;
    progress(job);
  } catch (error) {
    if (job && !isCurrent(job)) return;
    if (job && job.entries.size) {
      job.listError = error.message;
      progress(job);
    } else showStatus(error.message, "error");
  } finally {
    if (!job || activeJob === job) button.textContent = "Enter";
  }
});
