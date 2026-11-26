'use strict';
window.YouTubeTitles = (() => {
  const requests = new Map();
  function load(videoId) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return Promise.reject(new Error('Invalid video ID'));
    if (requests.has(videoId)) return requests.get(videoId);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const url = new URL('https://www.youtube.com/oembed');
    url.searchParams.set('url', `https://www.youtube.com/watch?v=${videoId}`);
    url.searchParams.set('format', 'json');
    const request = fetch(url.href, { credentials: 'omit', signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error('Title lookup failed');
        return response.json();
      })
      .then(data => {
        if (typeof data.title !== 'string' || !data.title.trim()) throw new Error('Title unavailable');
        return data.title.trim().slice(0, 200);
      })
      .catch(error => { if (requests.get(videoId) === request) requests.delete(videoId); throw error; })
      .finally(() => clearTimeout(timer));
    requests.set(videoId, request);
    return request;
  }
  return { load, refresh(videoId) { requests.delete(videoId); return load(videoId); } };
})();
