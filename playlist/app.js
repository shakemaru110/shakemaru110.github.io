'use strict';
(() => {
  const M = window.PlaylistModel;
  const $ = id => document.getElementById(id);
  let library;
  let bootMessage = '';
  let rawRecovery = null;
  try {
    const raw = localStorage.getItem(M.KEY);
    library = raw ? M.validateLibrary(JSON.parse(raw)) : M.newLibrary();
  } catch (error) {
    try { rawRecovery = localStorage.getItem(M.KEY); } catch {}
    library = M.newLibrary();
    bootMessage = '保存内容を読み込めませんでした。ブラウザの保存設定を確認してください。既存データがある場合、最初のJSON書き出しで元データを取り出せます。';
  }
  let storageFailed = false;
  let playerPromise = null;
  let player = null;
  let requestGeneration = 0;
  let lastCursorSave = 0;
  let titleVersion = 0;
  let manualTitleVersion = 0;
  let titleTimer = null;
  let pendingVideoId = null;
  let pendingManualVersion = 0;
  const pendingClipTitles = new Set();
  function playerVisible() {
    const rect = $('player-frame').getBoundingClientRect();
    return rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
  }
  function updateFloatingPlayer() {
    const rect = $('player-slot').getBoundingClientRect();
    const floating = Boolean(player && queue.loadedId && (rect.top < 12 || rect.bottom > innerHeight - 12));
    $('player-frame').classList.toggle('is-floating', floating);
    $('floating-controls').hidden = !floating;
    document.body.classList.toggle('has-floating-player', floating);
  }
  const selected = () => library.playlists.find(list => list.id === library.selectedId);
  function storageError(message) { $('storage-error').textContent = message; $('storage-error').hidden = !message; }
  function save() {
    if (rawRecovery !== null) {
      storageError('既存データを読み込めなかったため、自動保存を止めています。「JSONを書き出す」で元データを退避すると保存を再開できます。');
      return;
    }
    try {
      localStorage.setItem(M.KEY, JSON.stringify(library));
      $('save-state').textContent = 'このブラウザに保存済み';
      if (storageFailed) storageError('');
      storageFailed = false;
    } catch {
      storageFailed = true;
      $('save-state').textContent = '自動保存できません';
      storageError('ブラウザの保存容量・設定により自動保存できません。このページを閉じる前にJSONを書き出してください。');
    }
  }
  const queue = new window.SegmentQueue(renderPlayer, cursor => { library.cursor = cursor; save(); });
  function renderLibrary() {
    const options = library.playlists.map(list => {
      const option = document.createElement('option'); option.value = list.id; option.textContent = list.name || '名前のないリスト'; return option;
    });
    $('playlist-select').replaceChildren(...options);
    $('playlist-select').value = library.selectedId;
    $('playlist-name').value = selected().name;
    $('loop').checked = selected().loop;
  }
  function titleOf(clip, index) {
    return clip.title || (pendingClipTitles.has(clip.id) ? '動画タイトルを取得中…' : `動画 ${index + 1}（タイトル未取得）`);
  }
  function titleStatus(message) {
    $('title-status').textContent = message;
    $('title-status').hidden = !message;
  }
  function scheduleDraftTitle(force = false, refresh = false) {
    clearTimeout(titleTimer);
    const version = ++titleVersion;
    const list = selected();
    const draft = list.draft;
    pendingVideoId = null;
    titleStatus('');
    if (!draft.url.trim() || (!force && draft.title.trim())) return;
    let videoId;
    try { videoId = M.parseVideo(draft.url).videoId; } catch { return; }
    pendingVideoId = videoId;
    pendingManualVersion = manualTitleVersion;
    const manualVersion = manualTitleVersion;
    const previousTitle = draft.title;
    titleStatus('元動画のタイトルを取得しています…');
    titleTimer = setTimeout(async () => {
      try {
        const title = await window.YouTubeTitles[refresh ? 'refresh' : 'load'](videoId);
        if (version !== titleVersion || selected() !== list || list.draft !== draft ||
            manualVersion !== manualTitleVersion || draft.title !== previousTitle) return;
        draft.title = title;
        $('video-title').value = title;
        titleStatus('元動画のタイトルを取得しました。');
        save();
      } catch {
        if (version === titleVersion && selected() === list && list.draft === draft) {
          titleStatus('タイトルを取得できませんでした。再取得するか、手入力してください。動画はそのまま登録できます。');
        }
      } finally { if (version === titleVersion) pendingVideoId = null; }
    }, refresh ? 0 : 350);
  }
  async function fillClipTitle(listId, clipId, videoId, previousTitle) {
    const originalList = library.playlists.find(p => p.id === listId);
    const originalClip = originalList?.clips.find(c => c.id === clipId);
    pendingClipTitles.add(clipId);
    renderRows();
    try {
      const title = await window.YouTubeTitles.load(videoId);
      const list = library.playlists.find(p => p.id === listId);
      const clip = list?.clips.find(c => c.id === clipId);
      if (!clip || list !== originalList || clip !== originalClip || clip.videoId !== videoId || clip.title !== previousTitle) return;
      clip.title = title;
      let draftVideoId = null;
      try { draftVideoId = M.parseVideo(list.draft.url).videoId; } catch {}
      if (list.draft.editingId === clipId && list.draft.title === previousTitle && draftVideoId === videoId) {
        list.draft.title = title;
        if (selected() === list) $('video-title').value = title;
      }
      save();
    } catch { /* A missing title never discards the clip or its time bounds. */ }
    finally { pendingClipTitles.delete(clipId); renderRows(); }
  }
  function renderRows() {
    const list = selected();
    $('empty-state').hidden = list.clips.length > 0;
    $('clip-count').textContent = `${list.clips.length}本`;
    $('clip-list').replaceChildren(...list.clips.map((clip, index) => {
      const row = $('clip-template').content.firstElementChild.cloneNode(true);
      row.dataset.id = clip.id;
      row.querySelector('h3').textContent = titleOf(clip, index);
      row.querySelector('.clip-range').textContent = M.rangeLabel(clip);
      row.querySelector('.video-id').textContent = clip.videoId;
      const volume = row.querySelector('.clip-volume-input');
      const volumeValue = row.querySelector('.clip-volume output');
      volume.value = clip.volume;
      volume.setAttribute('aria-label', `${titleOf(clip, index)}の音量`);
      volumeValue.value = `${clip.volume}%`;
      volume.addEventListener('input', () => {
        clip.volume = Number(volume.value);
        volumeValue.value = `${clip.volume}%`;
        if (list.draft.editingId === clip.id) {
          list.draft.volume = clip.volume;
          $('video-volume').value = clip.volume;
          $('video-volume-value').value = `${clip.volume}%`;
        }
        if (queue.list === list && queue.loadedId === clip.id) queue.applyVolume();
        save();
      });
      const play = row.querySelector('.clip-play');
      play.setAttribute('aria-label', `${titleOf(clip, index)}を再生`);
      play.addEventListener('click', () => start(clip.id));
      row.querySelector('[data-action="up"]').disabled = index === 0;
      row.querySelector('[data-action="down"]').disabled = index === list.clips.length - 1;
      for (const button of row.querySelectorAll('[data-action]')) {
        button.addEventListener('click', () => rowAction(button.dataset.action, clip.id));
      }
      return row;
    }));
    renderPlayer();
  }
  function renderForm() {
    const draft = selected().draft;
    $('video-url').value = draft.url; $('video-title').value = draft.title;
    $('start-time').value = draft.start; $('end-time').value = draft.end;
    $('video-volume').value = draft.volume;
    $('video-volume-value').value = `${draft.volume}%`;
    $('form-heading').textContent = draft.editingId ? '動画の区間を編集' : '動画を追加';
    $('save-clip').textContent = draft.editingId ? '変更を保存' : 'リストに追加';
    $('cancel-edit').hidden = !draft.editingId;
    $('form-error').hidden = true;
    scheduleDraftTitle();
  }
  function renderPlayer() {
    const clip = queue.current();
    const list = queue.list;
    const index = list?.clips.findIndex(c => c.id === clip?.id) ?? -1;
    $('player-heading').textContent = clip ? titleOf(clip, index) : '再生する動画を選択';
    $('playing-range').textContent = clip ? M.rangeLabel(clip) : '追加した動画は、指定した区間で順番に再生します。';
    $('playing-order').textContent = clip ? `${index + 1} / ${list.clips.length}` : '';
    $('play-status').textContent = queue.message || '再生すると、次の動画へ自動で切り替わります。';
    $('play').textContent = queue.intent ? '一時停止' : '再生';
    $('floating-play').textContent = queue.intent ? '一時停止' : '再生';
    $('play').disabled = !selected().clips.length;
    $('previous').disabled = !selected().clips.length;
    $('next').disabled = !selected().clips.length;
    $('open-youtube').href = clip ? M.watchUrl(clip) : 'https://www.youtube.com/';
    for (const row of $('clip-list').children) row.classList.toggle('current', row.dataset.id === clip?.id);
    updateFloatingPlayer();
  }
  function bindSelected() {
    requestGeneration++;
    queue.setList(selected(), library.cursor);
    renderLibrary(); renderRows(); renderForm();
  }
  function captureDraft() {
    Object.assign(selected().draft, { url: $('video-url').value.slice(0, 3000), title: $('video-title').value.slice(0, 200),
      start: $('start-time').value.slice(0, 40), end: $('end-time').value.slice(0, 40), volume: Number($('video-volume').value) });
    save();
  }
  function rowAction(action, id) {
    const list = selected();
    const index = list.clips.findIndex(c => c.id === id);
    if (index < 0) return;
    const clip = list.clips[index];
    if (action === 'edit') {
      list.draft = { editingId: id, url: `https://www.youtube.com/watch?v=${clip.videoId}`, title: clip.title, start: M.formatTime(clip.start), end: clip.end === null ? '' : M.formatTime(clip.end), volume: clip.volume };
      renderForm(); save(); $('video-url').focus(); return;
    }
    if (action === 'remove') {
      if (!confirm(`${titleOf(clip, index)}をこのリストから削除しますか？`)) return;
      const current = queue.currentId === id;
      if (current) { requestGeneration++; queue.pause(); }
      list.clips.splice(index, 1);
      if (current) {
        queue.currentId = list.clips[Math.min(index, list.clips.length - 1)]?.id || null;
        queue.loadedId = null; queue.armed = false; queue.resumeTime = null;
        queue.message = '動画を削除しました。再生する動画を選んでください。';
        if (!list.clips.length) library.cursor = null;
      }
      if (list.draft.editingId === id) { list.draft = M.blankDraft(); renderForm(); }
    } else {
      const target = index + (action === 'up' ? -1 : 1);
      if (target < 0 || target >= list.clips.length) return;
      [list.clips[index], list.clips[target]] = [list.clips[target], list.clips[index]];
    }
    renderRows(); save();
  }
  function resetPlayerHost() {
    if (player) { try { player.destroy(); } catch {} }
    player = null;
    queue.api = null;
    $('youtube-player')?.remove();
    const host = document.createElement('div'); host.id = 'youtube-player';
    $('player-frame').prepend(host);
  }
  function ensurePlayer() {
    if (playerPromise) return playerPromise;
    playerPromise = new Promise((resolve, reject) => {
      let settled = false;
      const fail = message => {
        if (settled) return;
        settled = true; clearTimeout(timeout); playerPromise = null;
        resetPlayerHost(); $('player-placeholder').hidden = false;
        reject(new Error(message));
      };
      const timeout = setTimeout(() => fail('YouTubeに接続できません。通信・広告ブロック設定を確認して再生を押してください。'), 15000);
      const create = () => {
        if (settled) return;
        try {
          $('player-placeholder').hidden = true;
          player = new YT.Player('youtube-player', {
            width: '100%', height: '100%', host: 'https://www.youtube.com',
            playerVars: { playsinline: 1, controls: 1, rel: 0, origin: location.origin },
            events: {
              onReady: event => {
                if (settled) return;
                settled = true; clearTimeout(timeout);
                const iframe = event.target.getIframe();
                iframe.referrerPolicy = 'strict-origin-when-cross-origin';
                iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
                queue.attach(event.target); resolve(event.target);
              },
              onStateChange: event => {
                queue.state(event.data);
                if (event.data === 1 && document.hidden) queue.pause('ページを離れたため一時停止しました。再生を押すと続きから再開します。');
              },
              onError: event => queue.error(event.data),
              onAutoplayBlocked: () => queue.blocked()
            }
          });
        } catch { fail('YouTubeプレーヤーを読み込めませんでした。もう一度再生を押してください。'); }
      };
      if (window.YT?.Player) create();
      else {
        window.onYouTubeIframeAPIReady = create;
        document.getElementById('youtube-api')?.remove();
        const script = document.createElement('script'); script.id = 'youtube-api';
        script.src = 'https://www.youtube.com/iframe_api'; script.onerror = () => fail('YouTubeに接続できません。ネットワークを確認してください。');
        document.head.append(script);
      }
    });
    return playerPromise;
  }
  async function start(id = null) {
    const target = id || queue.currentId || selected().clips[0]?.id;
    if (!target) return;
    const generation = ++requestGeneration;
    if (queue.intent && !id) { queue.pause('一時停止中です。'); return; }
    if (id || queue.currentId !== target) queue.select(target);
    if (!playerVisible()) $('player-frame').scrollIntoView({ block: 'center' });
    $('play-status').textContent = 'YouTubeに接続しています。';
    try {
      await ensurePlayer();
      if (generation !== requestGeneration || document.hidden) return;
      queue.play();
    } catch (error) { if (generation === requestGeneration) { queue.message = error.message; renderPlayer(); } }
  }
  $('playlist-select').addEventListener('change', () => { queue.pause(); library.selectedId = $('playlist-select').value; bindSelected(); save(); });
  $('playlist-name').addEventListener('input', () => { selected().name = $('playlist-name').value.slice(0, 100); renderLibrary(); save(); });
  $('loop').addEventListener('change', () => { selected().loop = $('loop').checked; save(); });
  $('new-playlist').addEventListener('click', () => {
    queue.pause();
    const list = M.newList(`新しいプレイリスト ${library.playlists.length + 1}`);
    library.playlists.push(list); library.selectedId = list.id; bindSelected(); save();
    $('playlist-name').focus(); $('playlist-name').select();
  });
  $('delete-playlist').addEventListener('click', () => {
    if (!confirm(`「${selected().name || '名前のないリスト'}」と登録動画を削除しますか？`)) return;
    requestGeneration++; queue.pause();
    library.playlists = library.playlists.filter(list => list.id !== library.selectedId);
    if (!library.playlists.length) library.playlists.push(M.newList());
    library.selectedId = library.playlists[0].id; library.cursor = null;
    bindSelected(); save();
  });
  for (const id of ['video-url', 'video-title', 'start-time', 'end-time']) $(id).addEventListener('input', () => {
    if (id === 'video-title') manualTitleVersion++;
    captureDraft();
    if (id === 'video-url') scheduleDraftTitle(true);
  });
  $('refresh-title').addEventListener('click', () => {
    captureDraft();
    try { M.parseVideo(selected().draft.url); scheduleDraftTitle(true, true); }
    catch (error) { titleStatus(error.message); }
  });
  $('video-volume').addEventListener('input', () => {
    $('video-volume-value').value = `${$('video-volume').value}%`;
    captureDraft();
  });
  $('video-url').addEventListener('change', () => {
    try {
      const video = M.parseVideo($('video-url').value);
      if (!$('start-time').value.trim() && video.start !== null) $('start-time').value = M.formatTime(video.start);
      if (!$('end-time').value.trim() && video.end !== null) $('end-time').value = M.formatTime(video.end);
      captureDraft();
    } catch {}
  });
  $('clip-form').addEventListener('submit', event => {
    event.preventDefault(); captureDraft();
    const list = selected();
    try {
      const id = list.draft.editingId;
      const clip = M.clipFromDraft(list.draft, id);
      const fetchTitle = !clip.title || (pendingVideoId === clip.videoId && pendingManualVersion === manualTitleVersion);
      if (id) {
        const index = list.clips.findIndex(c => c.id === id);
        if (index < 0) throw new Error('編集対象が見つかりません。リストを確認してください。');
        list.clips[index] = clip;
        if (queue.currentId === id) { requestGeneration++; queue.select(id); }
      } else list.clips.push(clip);
      list.draft = M.blankDraft();
      if (!queue.currentId) queue.currentId = clip.id;
      renderForm(); renderRows(); save();
      if (fetchTitle) fillClipTitle(list.id, clip.id, clip.videoId, clip.title);
    } catch (error) { $('form-error').textContent = error.message; $('form-error').hidden = false; }
  });
  $('cancel-edit').addEventListener('click', () => { selected().draft = M.blankDraft(); renderForm(); save(); });
  $('play').addEventListener('click', () => start());
  $('floating-play').addEventListener('click', () => start());
  $('return-player').addEventListener('click', () => $('player-slot').scrollIntoView({ block: 'center', behavior: 'smooth' }));
  $('previous').addEventListener('click', () => { requestGeneration++; queue.move(-1); });
  $('next').addEventListener('click', () => { requestGeneration++; queue.move(1); });
  setInterval(() => {
    if (document.hidden) return;
    queue.tick();
    if (queue.intent && Date.now() - lastCursorSave > 3000) { lastCursorSave = Date.now(); queue.remember(); }
  }, 250);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    requestGeneration++;
    queue.pause('ページを離れたため一時停止しました。再生を押すと続きから再開します。');
  });
  window.addEventListener('scroll', updateFloatingPlayer, { passive: true });
  window.addEventListener('resize', updateFloatingPlayer);
  new ResizeObserver(updateFloatingPlayer).observe($('player-slot'));
  window.addEventListener('pagehide', () => { requestGeneration++; queue.pause(); save(); });
  window.addEventListener('storage', event => {
    if (event.key !== M.KEY) return;
    if (!event.newValue) { storageError('別の画面で保存データが削除されました。現在の内容はJSONで保管できます。'); return; }
    try {
      const next = M.validateLibrary(JSON.parse(event.newValue));
      requestGeneration++; queue.intent = false; queue.loadedId = null; queue.armed = false; queue.api?.pauseVideo();
      library = next; rawRecovery = null; bindSelected();
      storageError('別のタブの変更を読み込みました。最新の編集内容を表示しています。');
    } catch { storageError('別のタブの保存内容を読み込めませんでした。現在の内容はJSONで保管してください。'); }
  });
  function download(content, filename) {
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = filename;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  $('export').addEventListener('click', () => {
    if (rawRecovery !== null) {
      download(rawRecovery, 'Playlist-recovery.json'); rawRecovery = null;
      storageError('元の保存データを書き出しました。現在の内容は次回の編集から自動保存します。'); return;
    }
    queue.remember(); download(JSON.stringify(library, null, 2), 'Playlist.json');
  });
  $('import').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      const next = M.validateLibrary(JSON.parse(await file.text()));
      if (!confirm('現在のプレイリストを読み込むファイルの内容に置き換えます。続けますか？')) return;
      requestGeneration++; queue.pause(); library = next; rawRecovery = null;
      bindSelected(); save(); storageError('JSONを読み込みました。続けて編集・再生できます。');
    } catch (error) { storageError(`読み込めませんでした。${error instanceof SyntaxError ? 'JSONの内容を確認してください。' : error.message}`); }
    finally { event.target.value = ''; }
  });
  for (const id of ['video-url', 'start-time', 'end-time']) $(id).maxLength = id === 'video-url' ? 3000 : 40;
  bindSelected();
  if (bootMessage) storageError(bootMessage);
})();
