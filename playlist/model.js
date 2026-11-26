'use strict';
window.PlaylistModel = (() => {
  const KEY = 'shakemaru.playlist.library.v1';
  const uid = () => crypto.randomUUID();
  const blankDraft = () => ({ editingId: null, url: '', title: '', start: '', end: '', volume: 100 });
  const validVolume = value => value === undefined || (Number.isInteger(value) && value >= 0 && value <= 100);
  const newList = (name = 'マイプレイリスト') => ({ id: uid(), name, loop: false, clips: [], draft: blankDraft() });
  function newLibrary() {
    const list = newList();
    return { format: 'youtube-segment-playlists', version: 1, selectedId: list.id, playlists: [list], cursor: null };
  }
  function parseTime(value, fallback = 0) {
    const text = String(value).trim();
    if (!text) return fallback;
    const parts = text.split(':');
    if (parts.length > 3 || parts.some((part, i) => !(i === parts.length - 1 ? /^\d+(?:\.\d+)?$/ : /^\d+$/).test(part))) throw new Error('時刻は秒数、分:秒、時:分:秒で入力してください。');
    const values = parts.map(Number);
    if (values.slice(1).some(n => n >= 60)) throw new Error('コロンの後の分・秒は60未満で入力してください。');
    const seconds = values.reduce((sum, n) => sum * 60 + n, 0);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 2147483647) throw new Error('時刻が大きすぎます。');
    return seconds;
  }
  function timeHint(value) {
    if (!value) return null;
    if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value);
    const match = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/);
    return match && (match[1] || match[2] || match[3]) ? Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0) : null;
  }
  function parseVideo(value) {
    const text = String(value).trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(text)) return { videoId: text, start: null, end: null };
    let url;
    try { url = new URL(/^https?:\/\//i.test(text) ? text : 'https://' + text); } catch { throw new Error('有効なYouTube動画のURLを入力してください。'); }
    const host = url.hostname.toLowerCase();
    let id;
    if (host === 'youtu.be' || host === 'www.youtu.be') id = url.pathname.split('/')[1];
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host)) {
      const parts = url.pathname.split('/').filter(Boolean);
      id = parts[0] === 'watch' ? url.searchParams.get('v') : ['embed', 'shorts', 'live'].includes(parts[0]) ? parts[1] : null;
    }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || !id || !/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error('YouTubeの動画URLを入力してください。再生リストだけのURLは使えません。');
    const hash = new URLSearchParams(url.hash.slice(1));
    return { videoId: id, start: timeHint(url.searchParams.get('start') || url.searchParams.get('t') || hash.get('t')), end: timeHint(url.searchParams.get('end')) };
  }
  function formatTime(seconds) {
    const rounded = Math.round(seconds * 1000) / 1000;
    const whole = Math.floor(rounded);
    const fraction = Number((rounded - whole).toFixed(3));
    const s = String(whole % 60).padStart(2, '0') + (fraction ? String(fraction).slice(1) : '');
    const minutes = Math.floor(whole / 60);
    return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${s}` : `${minutes}:${s}`;
  }
  const rangeLabel = clip => `${formatTime(clip.start)} 〜 ${clip.end === null ? '最後まで' : formatTime(clip.end)}`;
  const watchUrl = clip => `https://www.youtube.com/watch?v=${clip.videoId}&t=${Math.floor(clip.start)}s`;
  function clipFromDraft(draft, existingId = null) {
    const video = parseVideo(draft.url);
    const start = parseTime(draft.start, 0);
    const end = parseTime(draft.end, null);
    if (end !== null && end <= start) throw new Error('終了時刻は開始時刻より後にしてください。');
    if (!validVolume(draft.volume)) throw new Error('音量は0〜100の整数で指定してください。');
    return { id: existingId || uid(), videoId: video.videoId, title: draft.title.trim().slice(0, 200), start, end, volume: draft.volume ?? 100 };
  }
  function validateLibrary(data) {
    const fail = () => { throw new Error('このページで書き出した有効なプレイリストJSONを選択してください。'); };
    const text = (value, max) => typeof value === 'string' && value.length <= max;
    const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
    const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 2147483647;
    if (!data || data.format !== 'youtube-segment-playlists' || data.version !== 1 || !Array.isArray(data.playlists) || !data.playlists.length) fail();
    const listIds = new Set();
    const playlists = data.playlists.map(list => {
      if (!list || !validId(list.id) || listIds.has(list.id) || !text(list.name, 100) || !Array.isArray(list.clips) || typeof list.loop !== 'boolean') fail();
      listIds.add(list.id);
      const clipIds = new Set();
      const clips = list.clips.map(clip => {
        if (!clip || !validId(clip.id) || clipIds.has(clip.id) || !/^[A-Za-z0-9_-]{11}$/.test(clip.videoId) || !text(clip.title, 200) || !number(clip.start) ||
            (clip.end !== null && (!number(clip.end) || clip.end <= clip.start)) || !validVolume(clip.volume)) fail();
        clipIds.add(clip.id);
        return { id: clip.id, videoId: clip.videoId, title: clip.title, start: clip.start, end: clip.end, volume: clip.volume ?? 100 };
      });
      const draft = list.draft || blankDraft();
      if (!text(draft.url, 3000) || !text(draft.title, 200) || !text(draft.start, 40) || !text(draft.end, 40) || !validVolume(draft.volume)) fail();
      return { id: list.id, name: list.name, loop: list.loop, clips, draft: {
        editingId: clipIds.has(draft.editingId) ? draft.editingId : null, url: draft.url, title: draft.title, start: draft.start, end: draft.end, volume: draft.volume ?? 100
      } };
    });
    let cursor = null;
    if (data.cursor && number(data.cursor.time)) {
      const list = playlists.find(p => p.id === data.cursor.playlistId);
      const clip = list?.clips.find(c => c.id === data.cursor.clipId);
      if (clip) cursor = { playlistId: list.id, clipId: clip.id, time: Math.max(clip.start, Math.min(data.cursor.time, clip.end ?? Infinity)) };
    }
    return { format: data.format, version: 1, selectedId: listIds.has(data.selectedId) ? data.selectedId : playlists[0].id, playlists, cursor };
  }
  return { KEY, uid, newList, newLibrary, blankDraft, parseTime, parseVideo, formatTime, rangeLabel, watchUrl, clipFromDraft, validateLibrary };
})();
