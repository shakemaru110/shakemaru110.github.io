'use strict';
window.SegmentQueue = class SegmentQueue {
  constructor(onChange, onCursor) {
    this.onChange = onChange;
    this.onCursor = onCursor;
    this.api = null;
    this.list = null;
    this.currentId = null;
    this.loadedId = null;
    this.intent = false;
    this.armed = false;
    this.finished = false;
    this.resumeTime = null;
    this.message = '';
  }
  current() { return this.list?.clips.find(clip => clip.id === this.currentId) || null; }
  attach(api) { this.api = api; }
  setList(list, cursor = null) {
    this.intent = false;
    this.armed = false;
    this.loadedId = null;
    this.api?.pauseVideo();
    this.list = list;
    this.currentId = cursor?.playlistId === list.id && list.clips.some(c => c.id === cursor.clipId) ? cursor.clipId : list.clips[0]?.id || null;
    this.resumeTime = cursor?.playlistId === list.id ? cursor.time : null;
    this.loadedId = null;
    this.finished = false;
    this.message = '再生ボタンで、選択した動画から始められます。';
    this.notify();
  }
  notify() { this.onChange(this); }
  remember() {
    const clip = this.finished ? this.list?.clips[0] : this.current();
    if (!clip) return;
    const time = this.finished ? clip.start : this.loadedId === clip.id && this.api ? this.api.getCurrentTime() : this.resumeTime ?? clip.start;
    this.onCursor({ playlistId: this.list.id, clipId: clip.id, time: Math.max(clip.start, Number(time) || clip.start) });
  }
  select(id, play = false) {
    const clip = this.list.clips.find(c => c.id === id);
    if (!clip) return;
    this.pause();
    this.currentId = id;
    this.loadedId = null;
    this.resumeTime = clip.start;
    this.finished = false;
    this.armed = false;
    if (play) this.play();
    else { this.remember(); this.notify(); }
  }
  play() {
    if (!this.api || !this.list?.clips.length) return;
    if (this.finished || !this.current()) {
      this.currentId = this.list.clips[0].id;
      this.loadedId = null;
      this.resumeTime = null;
      this.finished = false;
    }
    const clip = this.current();
    this.intent = true;
    this.message = 'YouTubeから動画を読み込んでいます。';
    if (this.loadedId !== clip.id) {
      this.armed = false;
      const start = this.resumeTime !== null && this.resumeTime >= clip.start && (clip.end === null || this.resumeTime < clip.end) ? this.resumeTime : clip.start;
      const request = { videoId: clip.videoId, startSeconds: start };
      if (clip.end !== null) request.endSeconds = clip.end;
      this.loadedId = clip.id;
      this.resumeTime = null;
      this.api.loadVideoById(request);
    } else this.api.playVideo();
    this.remember(); this.notify();
  }
  pause(message = null) {
    this.intent = false;
    if (this.api) this.api.pauseVideo();
    if (message) this.message = message;
    this.remember();
    this.notify();
  }
  move(direction, automatic = false) {
    if (!this.list?.clips.length) return;
    const index = this.list.clips.findIndex(c => c.id === this.currentId);
    let next = index + direction;
    if (next >= this.list.clips.length) {
      if (this.list.loop) next = 0;
      else {
        this.intent = false; this.armed = false; this.finished = true;
        this.api?.pauseVideo();
        this.message = 'プレイリストの再生が終了しました。';
        this.remember(); this.notify(); return;
      }
    }
    next = Math.max(0, next);
    const shouldPlay = automatic || this.intent;
    this.select(this.list.clips[next].id, shouldPlay);
  }
  state(code) {
    const clip = this.current();
    if (!clip || this.loadedId !== clip.id) return;
    if (code === 1) {
      const videoId = this.api.getVideoData?.().video_id;
      if (videoId && videoId !== clip.videoId) return;
      this.intent = true; this.armed = true;
      this.message = '指定した区間を再生中です。';
      this.tick();
    } else if (code === 0 && this.intent && this.armed) {
      this.armed = false; this.move(1, true);
    } else if (code === 2) {
      this.intent = false;
      if (!this.finished) this.message = '一時停止中です。再生ボタンで続きから再開します。';
    }
    this.remember(); this.notify();
  }
  tick() {
    const clip = this.current();
    if (!this.api || !clip || !this.intent || !this.armed) return;
    const duration = this.api.getDuration();
    if (duration > 0 && clip.start >= duration) { this.pause('開始時刻が動画の長さ以上です。編集で開始時刻を修正してください。'); return; }
    const time = this.api.getCurrentTime();
    if (clip.end !== null && time >= clip.end) {
      this.armed = false;
      this.move(1, true);
    }
  }
  blocked() {
    this.intent = false; this.armed = false;
    this.message = 'ブラウザが自動再生を止めました。再生ボタン、または動画内の再生を押してください。';
    this.notify();
  }
  error(code) {
    this.intent = false; this.armed = false;
    this.message = ({ 2: '動画URLを確認してください。', 5: 'このブラウザでは動画を読み込めませんでした。',
      100: 'この動画は削除・非公開などの理由で再生できません。', 101: 'この動画は埋め込み再生が許可されていません。',
      150: 'この動画は埋め込み再生が許可されていません。', 153: 'サイトの公開URLから開き、参照元を送信するブラウザ設定を確認してください。' })[code] || '動画を再生できませんでした。';
    this.message += ' YouTubeで開くか、次の動画を選んでください。';
    this.notify();
  }
};
