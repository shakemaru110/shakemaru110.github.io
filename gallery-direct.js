"use strict";

(() => {
  // This function must remain self-contained: the bookmark contains all its code.
  function directGallery() {
    const match = location.pathname.match(/^\/g\/(\d+)\/([a-f0-9]{10})\/?$/i);
    if (location.origin !== "https://e-hentai.org" || !match) {
      alert("e-hentai.orgのギャラリーページを開いてから、このブックマークを押してください。");
      return;
    }
    const id = "shakemaru-vertical-gallery";
    const existing = document.getElementById(id);
    if (existing) { existing.querySelector("button").focus(); return; }
    const galleryId = match[1];
    const galleryUrl = location.origin + "/g/" + galleryId + "/" + match[2] + "/";
    const controller = new AbortController();
    const entries = new Map();
    const queue = [];
    const timers = new Set();
    let closed = false, paused = false, pumping = false, pageLoading = false;
    let currentPage = -1, pageCount = 1, lastRequest = -Infinity;
    let requests = Promise.resolve();
    const previousOverflow = document.documentElement.style.overflow;

    function element(tag, text, styles = {}) {
      const node = document.createElement(tag);
      if (text) node.textContent = text;
      Object.assign(node.style, styles);
      return node;
    }
    const dialog = element("dialog", "", { position: "fixed", inset: "0", width: "100%", maxWidth: "none",
      height: "100%", maxHeight: "none", margin: "0", padding: "0", border: "0", overflowY: "auto",
      background: "#f5f7fa", color: "#202938", fontFamily: "sans-serif", fontSize: "16px", boxSizing: "border-box" });
    dialog.id = id;
    dialog.setAttribute("aria-label", "ギャラリーの縦表示");
    const header = element("header", "", { position: "sticky", top: "0", zIndex: "1", background: "white",
      padding: "14px 18px", borderBottom: "1px solid #d6dce6", textAlign: "left" });
    const close = element("button", "元のページへ戻る", { padding: "10px 16px", cursor: "pointer" });
    close.type = "button";
    const status = element("p", "読み込み中…", { margin: "12px 0 0", lineHeight: "1.7" });
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    header.append(close, status);
    const list = element("ol", "", { display: "flex", flexDirection: "column", gap: "24px", listStyle: "none",
      margin: "24px auto", padding: "0 16px", maxWidth: "900px", boxSizing: "border-box" });
    const more = element("button", "次の画像を読み込む", { display: "block", margin: "24px auto", padding: "14px 20px", cursor: "pointer" });
    more.type = "button";
    dialog.append(header, list, more);
    document.body.append(dialog);
    document.documentElement.style.overflow = "hidden";
    dialog.showModal();
    close.focus();

    function updateStatus() {
      if (closed || paused) return;
      const loaded = [...entries.values()].filter(entry => entry.state === "loaded").length;
      const failed = [...entries.values()].filter(entry => entry.state === "error").length;
      status.textContent = `画像 ${loaded} / ${entries.size}枚 · ${currentPage + 1} / ${pageCount}ページ`
        + (failed ? ` · ${failed}枚を読み込めませんでした。各画像の再読み込みを押してください。` : "");
    }
    function fatal(message) { return Object.assign(new Error(message), { halt: true }); }
    function report(error) {
      if (closed || error.name === "AbortError") return;
      status.textContent = error.message;
      if (error.halt) {
        paused = true;
        queue.length = 0;
        imageObserver.disconnect();
        pageObserver?.disconnect();
        more.disabled = true;
      }
    }
    function checkDocument(doc) {
      const text = doc.body?.textContent || "";
      if (/your ip address[\s\S]{0,200}(?:banned|blocked)|temporarily banned|excessive pageloads|opening pages too fast|access denied|^\s*nope\.?\s*$/i.test(text))
        throw fatal("元サイトでアクセスが制限されています。読み込みを停止しました。時間をおいてご利用ください。");
      if (doc.querySelector('script[src*="challenge-platform"], [id^="cf-chl-"], .g-recaptcha') || /just a moment|verify (?:that )?you are human/i.test(text))
        throw fatal("元サイトで確認が必要です。縦表示を閉じて、元のページで確認してください。");
      if (/must be logged in|please (?:log|sign) in to|login required/i.test(text))
        throw fatal("元サイトへのログインが必要です。縦表示を閉じて確認してください。");
    }
    function getDocument(url) {
      const operation = requests.then(async () => {
        if (closed || paused) throw new DOMException("Stopped", "AbortError");
        const wait = lastRequest + 1000 - performance.now();
        if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
        if (closed || paused) throw new DOMException("Stopped", "AbortError");
        lastRequest = performance.now();
        const timeout = new AbortController();
        const cancel = () => timeout.abort();
        controller.signal.addEventListener("abort", cancel, { once: true });
        const timer = setTimeout(cancel, 20000);
        try {
          const response = await fetch(url, { credentials: "same-origin", mode: "same-origin", redirect: "error",
            cache: "no-store", signal: timeout.signal });
          if ([403, 429].includes(response.status)) throw fatal("元サイトでアクセスが制限されています。読み込みを停止しました。時間をおいてご利用ください。");
          if (!response.ok) throw new Error("元サイトから取得できませんでした。時間をおいて再度お試しください。");
          if (!/text\/html/i.test(response.headers.get("Content-Type") || "")) throw new Error("元サイトの応答を確認できませんでした。");
          const html = await response.text();
          if (html.length > 3000000) throw new Error("元サイトの応答が大きすぎるため、読み込めませんでした。");
          const doc = new DOMParser().parseFromString(html, "text/html");
          checkDocument(doc);
          return doc;
        } catch (error) {
          if (closed) throw new DOMException("Closed", "AbortError");
          if (timeout.signal.aborted) throw new Error("読み込みに時間がかかりすぎています。再読み込みをお試しください。");
          throw error;
        } finally {
          clearTimeout(timer);
          controller.signal.removeEventListener("abort", cancel);
        }
      });
      requests = operation.catch(() => {});
      return operation;
    }
    function imageUrl(doc) {
      const image = doc.querySelector("img#img[src]");
      if (!image) throw new Error("画像が見つかりませんでした。元のページで表示できるか確認してください。");
      const url = new URL(image.getAttribute("src"), location.origin);
      if (/\/(?:509|503|kokomade)\.(?:gif|png|jpg)$/i.test(url.pathname)) throw fatal("元サイトの画像表示上限に達しています。読み込みを停止しました。");
      if (url.protocol !== "https:" || url.username || url.password ||
          (!url.hostname.endsWith(".hath.network") && !["ehgt.org", "e-hentai.org"].includes(url.hostname)))
        throw new Error("画像URLを確認できませんでした。");
      return url.href;
    }
    function fail(entry, error) {
      if (closed) return;
      entry.state = "error";
      entry.image.hidden = true;
      entry.image.style.display = "none";
      entry.image.removeAttribute("src");
      entry.item.style.minHeight = "0";
      entry.message.textContent = error.message;
      entry.message.hidden = false;
      entry.retry.hidden = Boolean(error.halt || paused);
      if (error.halt) report(error);
      else updateStatus();
    }
    async function pump() {
      if (pumping) return;
      pumping = true;
      try {
        while (queue.length && !closed && !paused) {
          const entry = queue.shift();
          entry.state = "loading";
          entry.message.textContent = "読み込み中…";
          entry.message.hidden = false;
          entry.retry.hidden = true;
          try {
            const doc = await getDocument(entry.pageUrl);
            if (closed || paused) break;
            const url = imageUrl(doc);
            const timer = setTimeout(() => {
              timers.delete(timer);
              if (entry.state === "loading") fail(entry, new Error("画像を読み込めませんでした。再読み込みをお試しください。"));
            }, 45000);
            timers.add(timer);
            const finished = () => { clearTimeout(timer); timers.delete(timer); };
            entry.image.onload = () => {
              finished();
              if (closed || entry.state !== "loading") return;
              entry.state = "loaded";
              entry.item.style.minHeight = "0";
              entry.message.hidden = true;
              updateStatus();
            };
            entry.image.onerror = () => { finished(); if (entry.state === "loading") fail(entry, new Error("画像を読み込めませんでした。再読み込みをお試しください。")); };
            entry.image.hidden = false;
            entry.image.style.display = "block";
            entry.image.src = url;
          } catch (error) { if (!closed && error.name !== "AbortError") fail(entry, error); }
        }
      } finally { pumping = false; }
    }
    function enqueue(entry) {
      if (closed || paused || !["waiting", "error"].includes(entry.state)) return;
      entry.state = "queued";
      queue.push(entry);
      pump();
    }
    const imageObserver = new IntersectionObserver(observed => {
      for (const item of observed) if (item.isIntersecting) {
        imageObserver.unobserve(item.target);
        enqueue(entries.get(Number(item.target.dataset.index)));
      }
    }, { root: dialog, rootMargin: "1000px 0px" });
    function appendPage(doc, page) {
      if (closed || paused) return;
      checkDocument(doc);
      const found = new Map();
      for (const anchor of doc.querySelectorAll("a[href]")) {
        let url;
        try { url = new URL(anchor.getAttribute("href"), galleryUrl); } catch { continue; }
        if (url.hostname !== "e-hentai.org" || !["https:", "http:"].includes(url.protocol) || url.port || url.username || url.password) continue;
        url.protocol = "https:";
        const image = url.pathname.match(/^\/s\/[a-f0-9]{10}\/(\d+)-([1-9]\d*)\/?$/i);
        if (image && image[1] === galleryId && Number.isSafeInteger(Number(image[2])))
          found.set(Number(image[2]), location.origin + url.pathname.replace(/\/$/, ""));
        if (url.pathname === new URL(galleryUrl).pathname) {
          const p = url.searchParams.get("p");
          if (p && /^\d+$/.test(p) && Number(p) < 10000) pageCount = Math.max(pageCount, Number(p) + 1);
        }
      }
      if (!found.size) throw fatal("画像一覧が見つかりませんでした。縦表示を閉じて、元サイトでギャラリーが表示できるか確認してください。");
      for (const [index, pageUrl] of [...found].sort((a, b) => a[0] - b[0])) {
        if (entries.has(index)) continue;
        const item = element("li", "", { minHeight: "60vh", margin: "0", padding: "0", textAlign: "left" });
        item.dataset.index = index;
        const image = element("img", "", { display: "block", width: "auto", maxWidth: "100%", height: "auto", margin: "0 auto" });
        image.alt = index + "ページ目";
        image.decoding = "async";
        image.referrerPolicy = "no-referrer";
        image.hidden = true;
        image.style.display = "none";
        const number = element("p", index + "ページ目", { margin: "12px 0", color: "#586477" });
        const message = element("p", "読み込み待ち…", { padding: "12px 0", lineHeight: "1.7" });
        const retry = element("button", "再読み込み", { padding: "10px 16px", cursor: "pointer" });
        retry.type = "button";
        retry.hidden = true;
        const entry = { index, pageUrl, item, image, message, retry, state: "waiting" };
        retry.addEventListener("click", () => enqueue(entry));
        item.append(number, image, message, retry);
        list.append(item);
        entries.set(index, entry);
        imageObserver.observe(item);
      }
      currentPage = page;
      more.hidden = currentPage + 1 >= pageCount;
      updateStatus();
    }
    async function loadNext() {
      if (closed || paused || pageLoading || currentPage + 1 >= pageCount) return;
      pageLoading = true;
      more.disabled = true;
      try {
        const page = currentPage + 1;
        appendPage(await getDocument(galleryUrl + "?p=" + page), page);
      } catch (error) { report(error); }
      finally { pageLoading = false; if (!paused) more.disabled = false; }
    }
    const pageObserver = new IntersectionObserver(items => {
      if (items.some(item => item.isIntersecting)) loadNext();
    }, { root: dialog, rootMargin: "1000px 0px" });
    more.addEventListener("click", loadNext);
    close.addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => {
      closed = true;
      controller.abort();
      imageObserver.disconnect();
      pageObserver.disconnect();
      timers.forEach(clearTimeout);
      for (const entry of entries.values()) {
        entry.image.onload = null;
        entry.image.onerror = null;
        if (entry.state !== "loaded") entry.image.removeAttribute("src");
      }
      document.documentElement.style.overflow = previousOverflow;
      dialog.remove();
    }, { once: true });
    (async () => {
      try {
        const firstPage = new URL(location.href).searchParams.get("p");
        appendPage(!firstPage || firstPage === "0" ? document : await getDocument(galleryUrl), 0);
        pageObserver.observe(more);
      } catch (error) { report(error); }
    })();
  }

  const bookmark = document.getElementById("gallery-bookmarklet");
  const open = document.getElementById("open-original");
  const status = document.getElementById("direct-status");
  if (!bookmark || !open || !status) return;
  bookmark.href = "javascript:" + encodeURIComponent("(" + directGallery.toString() + ")();void 0;");
  bookmark.addEventListener("click", event => {
    event.preventDefault();
    status.textContent = "このリンクをブックマークバーへドラッグして登録し、元サイト上で使ってください。";
  });
  open.addEventListener("click", () => {
    const input = document.getElementById("url");
    try {
      const gallery = parseGallery(input.value);
      if (gallery.kind !== "gallery") throw new Error("この方式はe-hentai.orgのギャラリーURLに対応しています。");
      status.textContent = "";
      window.open(gallery.url, "_blank", "noopener,noreferrer");
    } catch (error) { status.textContent = error.message; input.focus(); }
  });
})();
