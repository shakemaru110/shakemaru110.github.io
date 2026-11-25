import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
const context = vm.createContext({ window: {}, crypto: { randomUUID }, URL, URLSearchParams });
for (const file of ['model.js', 'player.js']) vm.runInContext(await readFile(new URL(file, import.meta.url), 'utf8'), context);
const M = context.window.PlaylistModel;
const Queue = context.window.SegmentQueue;
const plain = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const list = M.newList();
  list.clips = [
    { id: 'first', videoId: 'M7lc1UVf-VE', title: 'first', start: 10, end: 20 },
    { id: 'second', videoId: 'M7lc1UVf-VE', title: 'second', start: 40, end: 50 },
    { id: 'third', videoId: 'dQw4w9WgXcQ', title: 'whole', start: 0, end: null }
  ];
  const calls = [];
  const api = { time: 0, duration: 100, id: '', paused: false,
    loadVideoById(request) { calls.push(plain(request)); this.time = request.startSeconds; this.id = request.videoId; },
    playVideo() { this.paused = false; }, pauseVideo() { this.paused = true; },
    getCurrentTime() { return this.time; }, getDuration() { return this.duration; }, getVideoData() { return { video_id: this.id }; } };
  const queue = new Queue(() => {}, () => {});
  queue.attach(api); queue.setList(list);
  return { list, api, queue, calls };
}
test('time syntax and default bounds', () => {
  for (const [text, expected] of [['',0],['90',90],['1:30',90],['1:02:03.5',3723.5],['0.25',.25]]) assert.equal(M.parseTime(text), expected);
  assert.equal(M.parseTime('', null), null);
  assert.equal(M.formatTime(59.9999), '1:00');
  for (const text of ['-1','NaN','Infinity','1:60','1:2:60','1::2','1e3','0x10','12:34:56:78']) assert.throws(() => M.parseTime(text));
});
test('YouTube URL parsing and rejecting unrelated origins', () => {
  for (const url of ['M7lc1UVf-VE','https://youtu.be/M7lc1UVf-VE','https://www.youtube.com/watch?v=M7lc1UVf-VE','https://m.youtube.com/shorts/M7lc1UVf-VE','https://www.youtube.com/embed/M7lc1UVf-VE','https://youtube.com/live/M7lc1UVf-VE']) assert.equal(M.parseVideo(url).videoId, 'M7lc1UVf-VE');
  assert.equal(M.parseVideo('https://youtu.be/M7lc1UVf-VE?t=1h2m3s').start, 3723);
  for (const url of ['https://evil.test/watch?v=M7lc1UVf-VE','https://youtube.com.evil.test/watch?v=M7lc1UVf-VE','https://user:password@youtube.com/watch?v=M7lc1UVf-VE','https://youtube.com/playlist?list=abc','javascript:alert(1)']) assert.throws(() => M.parseVideo(url));
});
test('clip editing validates explicit end and blank means the whole video', () => {
  const draft = { url: 'https://youtu.be/M7lc1UVf-VE', title: 'test', start: '', end: '' };
  const clip = M.clipFromDraft(draft);
  assert.equal(clip.start, 0); assert.equal(clip.end, null);
  assert.throws(() => M.clipFromDraft({ ...draft, start: '30', end: '20' }));
  assert.throws(() => M.clipFromDraft({ ...draft, start: '20', end: '20' }));
});
test('JSON round trip preserves unfinished drafts and ordered clip ranges', () => {
  const library = M.newLibrary();
  library.playlists[0] = fixture().list; library.selectedId = library.playlists[0].id;
  library.playlists[0].draft = { editingId: 'second', url: 'https://youtu.be/M7lc1UVf-VE', title: 'unfinished', start: '1:', end: '' };
  const snapshot = plain(library);
  assert.deepEqual(plain(M.validateLibrary(snapshot)), snapshot);
  for (const mutate of [x => x.version = 9, x => x.playlists[0].clips[0].start = -1, x => x.playlists[0].clips[0].end = 5, x => x.playlists[0].clips[1].id = 'first', x => x.playlists[0].clips[0].videoId = '<script>']) {
    const data = plain(library); mutate(data); assert.throws(() => M.validateLibrary(data));
  }
});
test('explicit end transitions once, even when ENDED arrives again for the previous video', () => {
  const { api, queue, calls } = fixture();
  queue.play(); assert.deepEqual(calls[0], { videoId: 'M7lc1UVf-VE', startSeconds: 10, endSeconds: 20 });
  queue.state(1); api.time = 20; queue.tick();
  assert.equal(queue.currentId, 'second'); assert.equal(calls.length, 2); assert.equal(calls[1].startSeconds, 40);
  queue.state(0); assert.equal(calls.length, 2);
  queue.state(1); api.time = 50; queue.tick();
  assert.equal(queue.currentId, 'third'); assert.equal(calls[2].startSeconds, 0); assert.equal('endSeconds' in calls[2], false);
});
test('natural video end advances and the final video stops, or loops when enabled', () => {
  const { list, queue, calls } = fixture();
  queue.play(); queue.state(1); queue.state(0); assert.equal(queue.currentId, 'second');
  queue.state(1); queue.state(0); assert.equal(queue.currentId, 'third');
  queue.state(1); queue.state(0); assert.equal(queue.finished, true); assert.equal(queue.intent, false);
  queue.play(); assert.equal(queue.currentId, 'first');
  list.loop = true; queue.select('third', true); queue.state(1); queue.state(0);
  assert.equal(queue.currentId, 'first'); assert.equal(calls.at(-1).startSeconds, 10);
});
test('pause and autoplay blocking never silently advance the queue', () => {
  const { api, queue, calls } = fixture();
  queue.play(); queue.state(1); queue.pause(); api.time = 21; queue.tick(); queue.state(0);
  assert.equal(queue.currentId, 'first'); assert.equal(calls.length, 1);
  queue.blocked(); assert.equal(queue.intent, false); assert.match(queue.message, /自動再生/);
});
test('resume cursor is used within bounds, and out-of-duration starts report an error', () => {
  const { list, api, queue, calls } = fixture();
  queue.setList(list, { playlistId: list.id, clipId: 'second', time: 45 }); queue.play(); assert.equal(calls.at(-1).startSeconds, 45);
  api.duration = 30; queue.state(1); assert.equal(queue.intent, false); assert.match(queue.message, /開始時刻/);
});
test('after completing the playlist the saved cursor points to its beginning', () => {
  const { queue, list, api } = fixture();
  let cursor;
  queue.onCursor = value => { cursor = value; };
  queue.select('third', true); queue.state(1); api.time = 100; queue.state(0);
  queue.remember();
  assert.equal(cursor.playlistId, list.id);
  assert.equal(cursor.clipId, 'first');
  assert.equal(cursor.time, 10);
});
