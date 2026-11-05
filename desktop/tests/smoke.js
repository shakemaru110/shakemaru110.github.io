(async () => {
  const checks = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); checks.push(message); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const byId = id => document.getElementById(id);
  const change = (id, value, event = 'change') => {
    byId(id).value = value;
    byId(id).dispatchEvent(new Event(event, { bubbles: true }));
  };
  async function render(onbeat, offbeat, master = 70, accent = false) {
    const offline = new OfflineAudioContext(1, 48000 * 2.2, 48000);
    let now = 0;
    const settings = { tempo: 120, beats: 4, subdivision: 4, sound: 'beep', accent, onbeat, offbeat, master };
    const engine = new MetronomeAudio.Engine(settings, () => {}, () => {});
    engine.context = { get currentTime() { return now; }, createOscillator: () => offline.createOscillator(), createGain: () => offline.createGain() };
    engine.master = offline.createGain(); engine.master.connect(offline.destination);
    engine.onbeat = offline.createGain(); engine.onbeat.connect(engine.master);
    engine.offbeat = offline.createGain(); engine.offbeat.connect(engine.master);
    engine.updateVolumes(true);
    engine.playing = true; engine.step = 0; engine.nextTime = .04;
    for (now = 0; now < 1.91; now += .025) engine.schedule();
    const data = (await offline.startRendering()).getChannelData(0);
    const rms = Array.from({ length: 16 }, (_, step) => {
      const from = Math.round((.04 + step * .125) * 48000);
      let sum = 0; for (let i = from; i < from + 2400; i++) sum += data[i] ** 2;
      return Math.sqrt(sum / 2400);
    });
    return { rms, data };
  }
  async function renderSparse(subdivision, beats, gap) {
    const sampleRate = 8000;
    const quarters = gap * 2 + 1;
    const seconds = .04 + (quarters - 1) * .5 + .1;
    const offline = new OfflineAudioContext(1, Math.ceil(sampleRate * seconds), sampleRate);
    const starts = [];
    let now = 0;
    const settings = { tempo: 120, beats, subdivision, sound: 'beep', accent: true, onbeat: 80, offbeat: 0, master: 70 };
    const engine = new MetronomeAudio.Engine(settings, () => {}, () => {});
    engine.context = {
      get currentTime() { return now; },
      createGain: () => offline.createGain(),
      createOscillator: () => {
        const source = offline.createOscillator();
        const start = source.start.bind(source);
        source.start = time => { starts.push(time); start(time); };
        return source;
      }
    };
    engine.master = offline.createGain(); engine.master.connect(offline.destination);
    engine.onbeat = offline.createGain(); engine.onbeat.connect(engine.master);
    engine.offbeat = offline.createGain(); engine.offbeat.connect(engine.master);
    engine.updateVolumes(true);
    engine.playing = true; engine.step = 0; engine.nextTime = .04;
    for (now = 0; now < seconds - .05; now += .025) engine.schedule();
    const data = (await offline.startRendering()).getChannelData(0);
    assert(starts.length === 3 && starts.every((time, i) => Math.abs(time - (.04 + i * gap * .5)) < 1e-7),
      `Accurate audio scheduling: ${subdivision}, ${beats}/4, ${gap} quarter notes between pulses`);
    const correctSilence = Array.from({ length: quarters }, (_, quarter) => {
      const from = Math.round((.04 + quarter * .5) * sampleRate);
      let sum = 0;
      for (let i = from; i < from + 400; i++) sum += data[i] ** 2;
      const rms = Math.sqrt(sum / 400);
      return quarter % gap === 0 ? rms > .01 : rms === 0;
    });
    assert(correctSilence.every(Boolean), `Rendered sound and silent beats: ${subdivision}, ${beats}/4`);
  }
  try {
    assert(location.origin === 'https://metronome.example' && isSecureContext, 'Embedded page has a secure, persistent origin');
    assert(!document.querySelector('nav'), 'Desktop UI removes the website home link');
    assert(document.querySelector('.footer-note').textContent.includes('このアプリ'), 'Desktop UI explains app settings');
    const balanced = await render(80, 40);
    assert(Math.abs(balanced.rms[0] / balanced.rms[1] - 2) < .02, 'Rendered onbeat/offbeat amplitude ratio is 2:1');
    const mutedOff = await render(80, 0);
    assert(mutedOff.rms.every((v, i) => i % 4 === 0 ? v > .01 : v === 0), 'Offbeat mute leaves every quarter note audible');
    const mutedOn = await render(0, 40, 70, true);
    assert(mutedOn.rms.every((v, i) => i % 4 === 0 ? v === 0 : v > .01), 'Onbeat mute includes the accented first beat and preserves offbeats');
    assert((await render(80, 40, 0)).data.every(v => v === 0), 'Master mute produces silence');
    for (const n of [1, 2, 3, 4, 5, 6, 8]) {
      const ticks = Array.from({ length: 4 * n }, (_, i) => MetronomeAudio.position(i, n, 4));
      assert(ticks.filter(t => t.onbeat).length === 4 && ticks.filter(t => t.accent).length === 1, 'Quarter notes and accent classified correctly for subdivision ' + n);
    }
    for (const beats of [3, 4, 5]) {
      for (const [subdivision, gap] of [[.5, 2], [.25, 4], ['bars-2', beats * 2], ['bars-4', beats * 4], ['bars-8', beats * 8]]) {
        await renderSparse(subdivision, beats, gap);
      }
    }
    await renderSparse('bars-8', 1, 8);
    await renderSparse('bars-8', 16, 128);
    const wholeNoteTicks = [0, 4, 8, 12].map(step => MetronomeAudio.position(step, .25, 3));
    assert(wholeNoteTicks.map(t => t.beat).join(',') === '0,1,2,0' && wholeNoteTicks.map(t => t.accent).join(',') === 'true,false,false,true',
      'Whole notes cross 3/4 bar lines without resetting, and accent only actual downbeats');
    const phaseSettings = { tempo: 120, beats: 4, subdivision: 'bars-8' };
    const phaseEngine = new MetronomeAudio.Engine(phaseSettings, () => {}, () => {});
    phaseEngine.context = { currentTime: .25 };
    phaseEngine.playing = true; phaseEngine.nextTime = .55; phaseEngine.lastScheduledTime = .05;
    phaseEngine.setTempo(240);
    assert(Math.abs(phaseEngine.nextTime - .4) < 1e-9, 'Tempo changes preserve progress through a silent quarter note');
    let actualTempo;
    let activeEngine;
    const originalSetTempo = MetronomeAudio.Engine.prototype.setTempo;
    MetronomeAudio.Engine.prototype.setTempo = function(value) { activeEngine = this; actualTempo = value; originalSetTempo.call(this, value); };
    change('tempo', '123.4', 'input'); change('tempo', '123.4');
    assert(actualTempo === 123.4 && byId('tempo').value === '123.4', 'Manual entry preserves decimal tempo in the audio engine');
    assert(byId('tempo-range').step === '1', 'Slider has integer steps');
    change('tempo-range', '124', 'input');
    assert(actualTempo === 124 && byId('tempo').value === '124', 'Slider updates the engine to an integer');
    for (const delta of [-10, -5, -1, 1, 5, 10]) {
      change('tempo', '120');
      document.querySelector(`[data-tempo-change="${delta}"]`).click();
      assert(actualTempo === 120 + delta && Number(byId('tempo').value) === 120 + delta, 'BPM adjustment ' + delta + ' reaches the audio engine');
    }
    change('tempo', '298'); document.querySelector('[data-tempo-change="10"]').click();
    assert(actualTempo === 300, 'BPM upper limit is enforced');
    change('tempo', '22'); document.querySelector('[data-tempo-change="-10"]').click();
    assert(actualTempo === 20, 'BPM lower limit is enforced');
    change('tempo', '120.4'); document.querySelector('[data-tempo-change="5"]').click();
    assert(actualTempo === 125, 'Button adjustment rounds a previously decimal BPM');
    const originalNow = performance.now.bind(performance);
    let fakeTime = 10000;
    Object.defineProperty(performance, 'now', { configurable: true, value: () => fakeTime });
    byId('tap').click(); fakeTime += 487; byId('tap').click();
    Object.defineProperty(performance, 'now', { configurable: true, value: originalNow });
    assert(actualTempo === 123 && byId('tempo').value === '123', 'Tap tempo rounds the actual engine BPM to an integer');
    change('beats', '3'); change('subdivision', '4');
    assert(byId('beat-display').children.length === 3 && byId('offbeat-hint').textContent.includes('3音'), 'Rhythm controls update the beat display');
    change('onbeat-volume', '0', 'input'); change('offbeat-volume', '65', 'input');
    assert(byId('onbeat-value').value === '0%' && byId('offbeat-value').value === '65%', 'Independent volume controls update correctly');
    byId('toggle').click(); await wait(250);
    assert(byId('toggle').getAttribute('aria-pressed') === 'true', 'Real WebView2 AudioContext starts playback');
    change('subdivision', '3'); await wait(250);
    assert(byId('toggle').getAttribute('aria-pressed') === 'true', 'Changing subdivisions restarts playback');
    byId('toggle').click(); await wait(100);
    assert(byId('toggle').getAttribute('aria-pressed') === 'false', 'Playback stops');
    for (const subdivision of [.5, .25, 'bars-2', 'bars-4', 'bars-8']) {
      change('subdivision', String(subdivision));
      const stored = JSON.parse(localStorage.getItem('shakemaru.metronome.v1'));
      assert(byId('subdivision').value === String(subdivision) && stored.subdivision === subdivision
        && byId('offbeat-hint').textContent.includes('オフビートは鳴りません'), 'Sparse rhythm selection and persistence: ' + subdivision);
    }
    activeEngine.onTick(MetronomeAudio.position(4, 'bars-8', 3));
    assert(byId('position').textContent.includes('2 / 8小節') && byId('position').textContent.includes('休符')
      && byId('beat-display').children[1].classList.contains('silent'), 'Silent beats show the beat and bar position without a fractional subdivision counter');
    byId('toggle').click(); await wait(200);
    change('subdivision', '.5'); await wait(200);
    assert(byId('toggle').getAttribute('aria-pressed') === 'true', 'Switching from multi-bar pulses to half notes restarts playback');
    byId('toggle').click();
    change('subdivision', 'bars-8');
    MetronomeAudio.Engine.prototype.setTempo = originalSetTempo;
    const stored = JSON.parse(localStorage.getItem('shakemaru.metronome.v1'));
    assert(stored.tempo === 123 && stored.offbeat === 65, 'Settings are stored in the desktop profile');
    chrome.webview.postMessage({ success: true, count: checks.length, checks });
  } catch (error) { chrome.webview.postMessage({ success: false, error: error.stack, checks }); }
})();
