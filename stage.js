import { canPlace, nearestPosition, rotateFurniture, validateProject } from './layout.js';
import { fitLabel, LABEL_FONT } from './label.js';

const $ = id => document.getElementById(id);
const stage = $('stage');
const viewport = $('viewport');
const list = $('object-list');
const compactLayout = matchMedia('(max-width: 1100px), (hover: none) and (pointer: coarse)');
const colors = ['#e6a271', '#a7b6d0', '#b5c99c', '#c5accd'];
const nodes = new Map();
const uid = () => crypto.randomUUID();
const fullFloor = (width, height) => ({ id: uid(), x: 0, y: 0, width, height });
let project = {
  format: 'furniture-layout', version: 1, unit: 'mm', name: '家具配置データ',
  room: { width: 4000, height: 4000, calibrated: true, background: null, areas: [fullFloor(4000, 4000)], walls: [] },
  furniture: [], view: { zoom: 1, showPlan: true }
};
let backgroundImage = null;
let mode = 'furniture';
let selectedId = null;
let editorId = null;
let selectedRegion = null;
let gesture = null;
let scalePoints = [];
let loadRevision = 0;
let serial = 0;
let navigation = null;
const touchPoints = new Map();
const labelContext = document.createElement('canvas').getContext('2d');

function renderLabel(element, item, maximum = 18) {
  const angle = item.rotation || 0;
  const bounds = element.getBoundingClientRect();
  const sideways = angle % 180 !== 0;
  const width = sideways ? bounds.height : bounds.width;
  const height = sideways ? bounds.width : bounds.height;
  const text = fitLabel(labelContext, item.label, width, height, maximum);
  const span = element.querySelector('span');
  span.textContent = text.lines.join('\n');
  Object.assign(span.style, { fontSize: `${text.size}px`, lineHeight: `${text.lineHeight}px`, transform: `translate(-50%, -50%) rotate(${angle}deg)` });
}

function status(message) { $('status').textContent = message; }
function itemById(id) { return project.furniture.find(item => item.id === id); }
function geometry(item, room = project.room) {
  return { left: `${item.x / room.width * 100}%`, top: `${item.y / room.height * 100}%`,
    width: `${item.width / room.width * 100}%`, height: `${item.height / room.height * 100}%` };
}
function selectItem(id) {
  selectedId = id;
  for (const [key, node] of nodes) {
    node.element.classList.toggle('selected', key === id);
    node.card.classList.toggle('active', key === id);
  }
}
function fitStage() {
  const padding = innerWidth <= 700 ? 32 : 52;
  const availableWidth = Math.max(100, viewport.clientWidth - padding);
  const availableHeight = Math.max(100, viewport.clientHeight - padding);
  const scale = Math.min(availableWidth / project.room.width, availableHeight / project.room.height) * project.view.zoom;
  stage.style.width = `${project.room.width * scale}px`;
  stage.style.height = `${project.room.height * scale}px`;
  $('zoom-label').textContent = `${Math.round(project.view.zoom * 100)}%`;
  $('zoom-out').disabled = project.view.zoom <= .25;
  $('zoom-in').disabled = project.view.zoom >= 4;
  drawScaleLine();
  for (const item of project.furniture) {
    const node = nodes.get(item.id);
    if (node) renderLabel(node.element, item, item.position ? Math.min(18, 12 * project.view.zoom) : 11);
  }
}
function renderRegions() {
  for (const [kind, values, layer] of [['floor', project.room.areas, $('floor-layer')], ['wall', project.room.walls, $('wall-layer')]]) {
    layer.replaceChildren(...values.map(rect => {
      const element = document.createElement('div');
      element.className = kind === 'wall' ? 'wall' : 'floor-region';
      element.dataset.regionId = rect.id;
      element.dataset.kind = kind;
      element.classList.toggle('chosen', selectedRegion?.id === rect.id && selectedRegion.kind === kind);
      Object.assign(element.style, geometry(rect));
      return element;
    }));
  }
  $('delete-region').hidden = !selectedRegion;
}
function render() {
  const room = project.room;
  $('project-name').value = project.name;
  for (const item of project.furniture) {
    const node = nodes.get(item.id);
    const parent = item.position ? stage : node.slot;
    if (node.element.parentElement !== parent) parent.append(node.element);
    const { element } = node;
    element.classList.toggle('placed', Boolean(item.position));
    element.style.setProperty('--color', item.color);
    element.querySelector('span').textContent = item.label;
    element.style.fontSize = item.position ? `${Math.max(8, Math.min(18, 12 * project.view.zoom))}px` : '11px';
    if (item.position) {
      Object.assign(element.style, geometry({ ...item.position, width: item.width, height: item.height }));
    } else {
      const max = Math.max(item.width, item.height);
      Object.assign(element.style, { left: '50%', top: '50%', width: `${item.width / max * 100}%`, height: `${item.height / max * 100}%` });
    }
    element.setAttribute('aria-label', `${item.name}、W ${item.width}mm、H ${item.height}mm。${item.position ? '配置済み。ダブルクリックで未配置に戻す' : 'ドラッグまたはEnterで配置'}`);
    node.slot.querySelector('.slot-placeholder').hidden = !item.position;
    node.card.querySelector('.object-name').textContent = item.name;
    node.card.querySelector('.object-dimensions').textContent = `W ${item.width} × H ${item.height} mm`;
    node.card.querySelector('.place-object').textContent = item.position ? '戻す' : '配置';
    node.card.querySelector('.rotate-object').setAttribute('aria-label', `${item.name}を90度回転`);
  }
  $('placement-count').textContent = `${project.furniture.filter(item => item.position).length} / ${project.furniture.length} 配置済み`;
  $('plan-image').hidden = !room.background || !project.view.showPlan;
  $('show-plan').checked = project.view.showPlan;
  $('room-width').value = Number(room.width.toFixed(3));
  $('room-height').value = Number(room.height.toFixed(3));
  $('scale-state').textContent = room.calibrated ? '単位 mm' : '縮尺は仮設定です。既知の長さで合わせてください。';
  selectItem(selectedId);
  renderRegions();
  fitStage();
}
function beginNew() {
  editorId = null;
  $('editor-heading').textContent = '家具を追加';
  $('object-name').value = '';
  $('object-label').value = '';
  $('object-width').value = 1000;
  $('object-height').value = 1000;
  $('save-object').textContent = '追加する';
  $('new-object').hidden = true;
  $('delete-object').hidden = true;
}
function editItem(item) {
  editorId = item.id;
  selectItem(item.id);
  $('editor-heading').textContent = '家具を編集';
  $('object-name').value = item.name;
  $('object-label').value = item.label;
  $('object-width').value = item.width;
  $('object-height').value = item.height;
  $('save-object').textContent = '変更を保存';
  $('new-object').hidden = false;
  $('delete-object').hidden = false;
}
function addNode(item) {
  const card = $('object-template').content.firstElementChild.cloneNode(true);
  const element = card.querySelector('.object');
  const slot = card.querySelector('.object-slot');
  element.dataset.id = item.id;
  const node = { card, element, slot, lastWasDrag: false };
  nodes.set(item.id, node);
  list.append(card);
  element.addEventListener('pointerdown', event => startFurniture(event, item.id));
  element.addEventListener('focus', () => selectItem(item.id));
  element.addEventListener('keydown', event => furnitureKey(event, item.id));
  element.addEventListener('dblclick', event => { event.preventDefault(); if (!node.lastWasDrag) returnToTray(item.id); });
  element.addEventListener('lostpointercapture', () => { if (gesture?.id === item.id) finishGesture(false); });
  card.querySelector('.edit-object').addEventListener('click', () => editItem(itemById(item.id)));
  card.querySelector('.rotate-object').addEventListener('click', () => rotateItem(item.id));
  card.querySelector('.place-object').addEventListener('click', () => {
    if (itemById(item.id).position) returnToTray(item.id);
    else {
      placeFurniture(item.id);
      if (innerWidth <= 700 && itemById(item.id).position) stage.scrollIntoView({ block: 'center' });
    }
  });
}
function rebuild() {
  finishGesture(false);
  for (const node of nodes.values()) node.element.remove();
  list.replaceChildren(); nodes.clear();
  for (const item of project.furniture) addNode(item);
  selectedId = null; selectedRegion = null; scalePoints = [];
  beginNew(); setMode('furniture'); render();
}
function returnToTray(id) {
  const item = itemById(id);
  if (!item?.position) return;
  finishGesture(false);
  item.position = null;
  render(); nodes.get(id).element.focus({ preventScroll: true });
  status(`${item.name}を未配置に戻しました。`);
}
function placeFurniture(id) {
  finishGesture(false);
  if (mode !== 'furniture') setMode('furniture');
  const item = itemById(id);
  item.position = nearestPosition(project.room, project.furniture, item, { x: 0, y: 0 });
  render(); nodes.get(id).element.focus({ preventScroll: true });
  status(item.position ? `${item.name}を配置しました。` : 'この家具を配置できるスペースがありません。');
}
function rotateItem(id) {
  finishGesture(false);
  const item = itemById(id);
  const rotated = rotateFurniture(project.room, project.furniture, item);
  if (!rotated) {
    status(`${item.name}は回転後のサイズで配置できる場所がありません。未配置に戻してから回転できます。`);
    return;
  }
  Object.assign(item, rotated);
  if (editorId === id) {
    $('object-width').value = item.width;
    $('object-height').value = item.height;
  }
  selectItem(id);
  render();
  status(`${item.name}を90度回転しました。W ${item.width} × H ${item.height} mm。`);
}
function furnitureKey(event, id) {
  if (gesture) return;
  if (event.key.toLowerCase() === 'r' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    rotateItem(id);
    return;
  }
  const item = itemById(id);
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (!item.position) {
      placeFurniture(id);
    } else editItem(item);
    return;
  }
  if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); returnToTray(id); return; }
  const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (!directions[event.key] || !item.position) return;
  event.preventDefault();
  const [dx, dy] = directions[event.key];
  const step = event.shiftKey ? 100 : 10;
  const target = { x: item.position.x + dx * step, y: item.position.y + dy * step };
  const position = nearestPosition(project.room, project.furniture, item, target, item.position);
  if (position) item.position = position;
  render();
}
function worldPoint(event) {
  const bounds = stage.getBoundingClientRect();
  return { x: (event.clientX - bounds.left) / bounds.width * project.room.width,
    y: (event.clientY - bounds.top) / bounds.height * project.room.height };
}
function startFurniture(event, id) {
  if (gesture || event.button !== 0 || !event.isPrimary) return;
  if (mode !== 'furniture') setMode('furniture');
  event.preventDefault(); event.stopPropagation();
  const node = nodes.get(id);
  const bounds = node.element.getBoundingClientRect();
  const view = viewport.getBoundingClientRect();
  selectItem(id);
  gesture = { kind: 'furniture', id, pointerId: event.pointerId, target: node.element,
    enteredViewport: event.clientX >= view.left && event.clientX <= view.left + viewport.clientWidth &&
      event.clientY >= view.top && event.clientY <= view.top + viewport.clientHeight,
    startX: event.clientX, startY: event.clientY,
    grabX: (event.clientX - bounds.left) / bounds.width, grabY: (event.clientY - bounds.top) / bounds.height,
    ghost: null, position: null };
  node.element.setPointerCapture(event.pointerId);
  node.element.focus({ preventScroll: true });
}
function updateFurniture(event) {
  const g = gesture;
  g.pointer = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY };
  const item = itemById(g.id);
  const node = nodes.get(g.id);
  if (!g.ghost) {
    if (Math.hypot(event.clientX - g.startX, event.clientY - g.startY) < 4) return;
    g.ghost = document.createElement('div');
    g.ghost.className = 'object drag-ghost';
    g.ghost.style.setProperty('--color', item.color);
    g.ghost.append(document.createElement('span'));
    g.ghost.setAttribute('aria-hidden', 'true');
    document.body.append(g.ghost);
    node.element.classList.add('dragging'); document.body.classList.add('is-dragging');
    g.autoPanFrame = requestAnimationFrame(autoPanFurniture);
  }
  const view = viewport.getBoundingClientRect();
  if (event.clientX >= view.left && event.clientX <= view.left + viewport.clientWidth &&
      event.clientY >= view.top && event.clientY <= view.top + viewport.clientHeight) g.enteredViewport = true;
  const bounds = stage.getBoundingClientRect();
  const scale = bounds.width / project.room.width;
  const point = worldPoint(event);
  const target = { x: point.x - g.grabX * item.width, y: point.y - g.grabY * item.height };
  // A new item stays in its tray when released away from the plan.
  const nearPlan = point.x >= 0 && point.y >= 0 && point.x <= project.room.width && point.y <= project.room.height;
  g.position = item.position || nearPlan ? nearestPosition(project.room, project.furniture, item, target, g.position || item.position || target) : null;
  const displayed = g.position || target;
  Object.assign(g.ghost.style, { left: `${bounds.left + displayed.x * scale}px`, top: `${bounds.top + displayed.y * scale}px`,
    width: `${item.width * scale}px`, height: `${item.height * scale}px`, fontSize: `${Math.max(8, Math.min(18, 12 * project.view.zoom))}px` });
  g.ghost.classList.toggle('invalid', !g.position);
  renderLabel(g.ghost, item, Math.min(18, 12 * project.view.zoom));
}
function autoPanFurniture(time) {
  const g = gesture;
  if (g?.kind !== 'furniture' || !g.ghost) return;
  const seconds = Math.min(32, time - (g.lastPanTime || time - 16)) / 1000;
  g.lastPanTime = time;
  if (g.enteredViewport) {
    const bounds = viewport.getBoundingClientRect();
    const edge = Math.min(48, viewport.clientWidth / 5, viewport.clientHeight / 5);
    const velocity = (point, start, end) => {
      if (point < start + edge) return -800 * Math.min(1, (start + edge - point) / edge);
      if (point > end - edge) return 800 * Math.min(1, (point - end + edge) / edge);
      return 0;
    };
    const left = viewport.scrollLeft;
    const top = viewport.scrollTop;
    viewport.scrollLeft += velocity(g.pointer.clientX, bounds.left, bounds.left + viewport.clientWidth) * seconds;
    viewport.scrollTop += velocity(g.pointer.clientY, bounds.top, bounds.top + viewport.clientHeight) * seconds;
    if (viewport.scrollLeft !== left || viewport.scrollTop !== top) updateFurniture(g.pointer);
  }
  g.autoPanFrame = requestAnimationFrame(autoPanFurniture);
}
function reconcileFurniture() {
  let changed = 0;
  for (const item of project.furniture) {
    if (item.position && !canPlace(project.room, project.furniture, item, item.position)) {
      item.position = nearestPosition(project.room, project.furniture, item, item.position);
      changed++;
    }
  }
  return changed ? ` ${changed}点の家具の位置を調整しました。空きがない家具は未配置に戻しました。` : '';
}
function finishGesture(commit) {
  if (!gesture) return;
  const g = gesture; gesture = null;
  if (g.autoPanFrame) cancelAnimationFrame(g.autoPanFrame);
  if (g.target.hasPointerCapture(g.pointerId)) g.target.releasePointerCapture(g.pointerId);
  if (g.kind === 'furniture') {
    const node = nodes.get(g.id);
    node.lastWasDrag = Boolean(g.ghost);
    if (g.ghost) {
      if (commit && g.position) { itemById(g.id).position = g.position; status(`${itemById(g.id).name}を配置しました。`); }
      else status(commit ? '配置できる床の空きがありません。床範囲・壁・家具の寸法を確認してください。' : '移動を中止しました。');
      g.ghost.remove(); node.element.classList.remove('dragging'); document.body.classList.remove('is-dragging');
    }
    render(); node.element.focus({ preventScroll: true });
  } else {
    $('drawing-preview').hidden = true;
    if (commit && g.rect && g.moved) {
      const rect = { id: uid(), ...g.rect };
      if (g.mode === 'wall') project.room.walls.push(rect);
      else {
        const areas = project.room.areas;
        const whole = areas.length === 1 && areas[0].x === 0 && areas[0].y === 0 && areas[0].width === project.room.width && areas[0].height === project.room.height;
        project.room.areas = whole ? [rect] : [...areas, rect];
      }
      selectedRegion = { id: rect.id, kind: g.mode };
      status(`${g.mode === 'wall' ? '壁' : '床範囲'}を追加しました。${reconcileFurniture()}`);
    }
    render();
  }
}
function setMode(next) {
  finishGesture(false); mode = next; selectedRegion = null; scalePoints = [];
  stage.className = `stage edit-${mode}`;
  for (const button of document.querySelectorAll('[data-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  $('mode-help').textContent = {
    furniture: '家具をドラッグして配置。配置後はダブルクリックで手元に戻せます。',
    wall: '画像の壁に沿って長方形をドラッグ。既存の壁はクリックで選択して削除できます。',
    floor: '配置できる床を長方形で指定。複数の範囲をつないで使えます。床の外には配置できません。',
    scale: '実際の長さが分かる線の両端を2回クリックし、その長さをmmで入力してください。'
  }[mode];
  $('scale-form').hidden = true; $('scale-line').hidden = true;
  renderRegions();
}
function drawScaleLine() {
  if (!scalePoints.length) { $('scale-line').hidden = true; return; }
  const scale = parseFloat(stage.style.width) / project.room.width;
  const a = scalePoints[0], b = scalePoints[1] || a;
  Object.assign($('scale-line').style, { left: `${a.x * scale}px`, top: `${a.y * scale}px`,
    width: `${Math.hypot(b.x - a.x, b.y - a.y) * scale}px`, transform: `rotate(${Math.atan2(b.y - a.y, b.x - a.x)}rad)` });
  $('scale-line').hidden = false;
}

stage.addEventListener('pointerdown', event => {
  if (gesture || event.button !== 0 || !event.isPrimary || mode === 'furniture') return;
  event.preventDefault();
  const point = worldPoint(event);
  if (mode === 'scale') {
    if (scalePoints.length === 2) scalePoints = [];
    scalePoints.push(point); drawScaleLine();
    $('scale-form').hidden = scalePoints.length !== 2;
    return;
  }
  const region = event.target.closest('[data-region-id]');
  selectedRegion = region ? { id: region.dataset.regionId, kind: region.dataset.kind } : null;
  gesture = { kind: 'region', mode, pointerId: event.pointerId, target: stage, start: point, startX: event.clientX, startY: event.clientY, rect: null, moved: false };
  stage.setPointerCapture(event.pointerId);
});
window.addEventListener('pointermove', event => {
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  if (gesture.kind === 'furniture') { updateFurniture(event); return; }
  const g = gesture;
  const point = worldPoint(event);
  const x = Math.max(0, Math.min(project.room.width, point.x));
  const y = Math.max(0, Math.min(project.room.height, point.y));
  const width = Math.abs(x - g.start.x), height = Math.abs(y - g.start.y);
  g.moved = Math.hypot(event.clientX - g.startX, event.clientY - g.startY) >= 3;
  g.rect = width >= 1 && height >= 1 ? { x: Math.min(x, g.start.x), y: Math.min(y, g.start.y), width, height } : null;
  $('drawing-preview').hidden = !g.rect || !g.moved;
  if (g.rect) Object.assign($('drawing-preview').style, geometry(g.rect));
}, { passive: true });
window.addEventListener('pointerup', event => {
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  if (gesture.kind === 'furniture') updateFurniture(event);
  finishGesture(true);
});
window.addEventListener('pointercancel', event => { if (gesture?.pointerId === event.pointerId) finishGesture(false); });
stage.addEventListener('lostpointercapture', () => { if (gesture?.kind === 'region') finishGesture(false); });
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') { finishGesture(false); scalePoints = []; drawScaleLine(); $('scale-form').hidden = true; }
});
window.addEventListener('blur', () => finishGesture(false));
viewport.addEventListener('scroll', () => {
  if (gesture?.kind === 'furniture' && gesture.ghost) updateFurniture(gesture.pointer);
  else if (!navigation) finishGesture(false);
}, { passive: true });
window.addEventListener('scroll', () => finishGesture(false), { passive: true });
new ResizeObserver(() => { finishGesture(false); fitStage(); }).observe(viewport);
for (const button of document.querySelectorAll('[data-mode]')) button.addEventListener('click', () => setMode(button.dataset.mode));
function setZoom(value, anchor = null, fraction = null) {
  finishGesture(false);
  const before = stage.getBoundingClientRect();
  const viewBounds = viewport.getBoundingClientRect();
  const point = anchor || { x: viewBounds.left + viewport.clientWidth / 2, y: viewBounds.top + viewport.clientHeight / 2 };
  const relative = fraction || { x: (point.x - before.left) / before.width, y: (point.y - before.top) / before.height };
  project.view.zoom = Math.max(.25, Math.min(4, value));
  render();
  const after = stage.getBoundingClientRect();
  viewport.scrollLeft += after.left + relative.x * after.width - point.x;
  viewport.scrollTop += after.top + relative.y * after.height - point.y;
}
function beginPinch() {
  finishGesture(false);
  const [a, b] = [...touchPoints.values()];
  const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const bounds = stage.getBoundingClientRect();
  navigation = {
    kind: 'pinch', zoom: project.view.zoom,
    distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
    fraction: { x: (midpoint.x - bounds.left) / bounds.width, y: (midpoint.y - bounds.top) / bounds.height }
  };
  for (const id of touchPoints.keys()) viewport.setPointerCapture(id);
}
viewport.addEventListener('pointerdown', event => {
  if (event.pointerType !== 'touch') return;
  touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (touchPoints.size >= 2) {
    event.preventDefault();
    event.stopPropagation();
    beginPinch();
  }
}, { capture: true });
viewport.addEventListener('pointerdown', event => {
  if (navigation || gesture || mode !== 'furniture' || event.button !== 0) return;
  event.preventDefault();
  navigation = { kind: 'pan', pointerId: event.pointerId, x: event.clientX, y: event.clientY,
    left: viewport.scrollLeft, top: viewport.scrollTop };
  viewport.setPointerCapture(event.pointerId);
});
window.addEventListener('pointermove', event => {
  if (touchPoints.has(event.pointerId)) touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (!navigation) return;
  if (navigation.kind === 'pinch') {
    if (!touchPoints.has(event.pointerId) || touchPoints.size < 2) return;
    const [a, b] = [...touchPoints.values()];
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    setZoom(navigation.zoom * distance / navigation.distance,
      { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, navigation.fraction);
  } else if (navigation.pointerId === event.pointerId) {
    viewport.scrollLeft = navigation.left + navigation.x - event.clientX;
    viewport.scrollTop = navigation.top + navigation.y - event.clientY;
  } else return;
  event.preventDefault();
  event.stopPropagation();
}, { capture: true, passive: false });
function endViewPointer(event) {
  touchPoints.delete(event.pointerId);
  if (!navigation) return;
  if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
  if (navigation.kind === 'pinch') {
    if (touchPoints.size >= 2) beginPinch();
    else if (touchPoints.size === 1) {
      const [pointerId, point] = [...touchPoints.entries()][0];
      navigation = { kind: 'pan', pointerId, ...point, left: viewport.scrollLeft, top: viewport.scrollTop };
    } else navigation = null;
  } else if (navigation.pointerId === event.pointerId) navigation = null;
}
window.addEventListener('pointerup', endViewPointer, { capture: true });
window.addEventListener('pointercancel', endViewPointer, { capture: true });
window.addEventListener('blur', () => { navigation = null; touchPoints.clear(); });
viewport.addEventListener('wheel', event => {
  event.preventDefault();
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
  if (event.ctrlKey) {
    setZoom(project.view.zoom * Math.exp(-event.deltaY * unit * .002), { x: event.clientX, y: event.clientY });
  } else if (event.shiftKey) viewport.scrollLeft += (event.deltaY || event.deltaX) * unit;
  else viewport.scrollBy(event.deltaX * unit, event.deltaY * unit);
}, { passive: false });
$('zoom-in').addEventListener('click', () => setZoom(project.view.zoom * 1.25));
$('zoom-out').addEventListener('click', () => setZoom(project.view.zoom / 1.25));
$('zoom-fit').addEventListener('click', () => { setZoom(1); viewport.scrollTo(0, 0); });
$('show-plan').addEventListener('change', () => { project.view.showPlan = $('show-plan').checked; render(); });
$('delete-region').addEventListener('click', () => {
  if (!selectedRegion) return;
  const key = selectedRegion.kind === 'wall' ? 'walls' : 'areas';
  project.room[key] = project.room[key].filter(rect => rect.id !== selectedRegion.id);
  selectedRegion = null; status(`選択した範囲を削除しました。${reconcileFurniture()}`); render();
});
$('reset').addEventListener('click', () => {
  finishGesture(false); for (const item of project.furniture) item.position = null;
  render(); status('家具をすべて未配置に戻しました。');
});
$('object-name').addEventListener('input', () => $('object-name').setCustomValidity(''));
$('new-object').addEventListener('click', beginNew);
$('object-form').addEventListener('submit', event => {
  event.preventDefault();
  $('object-name').setCustomValidity($('object-name').value.trim() ? '' : '家具の名前を入力してください。');
  if (!$('object-form').reportValidity()) return;
  const existing = itemById(editorId);
  const item = { id: existing?.id || uid(), name: $('object-name').value.trim(), label: $('object-label').value.trim(),
    width: $('object-width').valueAsNumber, height: $('object-height').valueAsNumber,
    color: existing?.color || colors[serial % colors.length], position: existing?.position || null };
  item.rotation = existing?.rotation || 0;
  if (item.position) item.position = nearestPosition(project.room, project.furniture, item, item.position);
  if (existing) Object.assign(existing, item);
  else { project.furniture.push(item); serial++; addNode(item); }
  selectItem(item.id); render();
  status(existing ? `${item.name}の変更を保存しました。${existing.position ? '' : '現在は未配置です。'}` : `${item.name}を追加しました。ドラッグして配置できます。`);
  if (!existing) {
    beginNew();
    if (compactLayout.matches) list.scrollLeft = list.scrollWidth;
    else list.scrollTop = list.scrollHeight;
  }
});
$('delete-object').addEventListener('click', () => {
  const item = itemById(editorId); if (!item) return;
  finishGesture(false);
  const node = nodes.get(item.id); node.element.remove(); node.card.remove(); nodes.delete(item.id);
  project.furniture = project.furniture.filter(other => other.id !== item.id);
  if (selectedId === item.id) selectedId = null;
  beginNew(); render(); status(`${item.name}を削除しました。`);
});

function decodeImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => image.naturalWidth && image.naturalHeight ? resolve(image) : reject(new Error('画像を読み込めませんでした。'));
    image.onerror = () => reject(new Error('画像を読み込めませんでした。PNG・JPEG・WebP・AVIFを選択してください。'));
    image.src = src;
  });
}
function readDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('ファイルを読み込めませんでした。')); reader.readAsDataURL(file);
  });
}
function rasterize(image, crop = { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight }) {
  const scale = Math.min(1, 2400 / Math.max(crop.width, crop.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(crop.width * scale)); canvas.height = Math.max(1, Math.round(crop.height * scale));
  canvas.getContext('2d').drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
}
async function installRoom(room, image, revision) {
  if (revision !== loadRevision) return;
  finishGesture(false);
  project.room = room; backgroundImage = image;
  $('plan-image').src = room.background.dataUrl;
  for (const item of project.furniture) item.position = null;
  project.view.zoom = 1; project.view.showPlan = true;
  setMode(room.areas.length ? 'furniture' : 'floor'); render(); viewport.scrollTo(0, 0);
  status('画像を読み込みました。配置できる床範囲を描き、縮尺と壁を設定してください。家具は未配置に戻しました。');
}
$('plan-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  const revision = ++loadRevision;
  try {
    if (!/^image\/(png|jpeg|webp|avif)$/.test(file.type)) throw new Error('PNG・JPEG・WebP・AVIFの画像を選択してください。');
    const source = await decodeImage(await readDataUrl(file));
    const raster = rasterize(source);
    const image = await decodeImage(raster.dataUrl);
    await installRoom({ width: raster.width * 20, height: raster.height * 20, calibrated: false,
      background: { name: file.name, dataUrl: raster.dataUrl }, areas: [], walls: [] }, image, revision);
  } catch (error) { if (revision === loadRevision) status(error.message); }
  finally { event.target.value = ''; }
});
function rescaleRoom(widthFactor, heightFactor) {
  finishGesture(false);
  const room = project.room;
  const newWidth = room.width * widthFactor, newHeight = room.height * heightFactor;
  if (!Number.isFinite(newWidth) || !Number.isFinite(newHeight) || newWidth < 1 || newHeight < 1 || newWidth > 100000 || newHeight > 100000) throw new Error('部屋全体のW・Hが1〜100000 mmに収まる縮尺を設定してください。');
  room.width = newWidth; room.height = newHeight; room.calibrated = true;
  for (const rect of [...room.areas, ...room.walls]) {
    rect.x *= widthFactor; rect.width *= widthFactor; rect.y *= heightFactor; rect.height *= heightFactor;
  }
  const positions = project.furniture.map(item => item.position ? { x: item.position.x * widthFactor, y: item.position.y * heightFactor } : null);
  for (const item of project.furniture) item.position = null;
  project.furniture.forEach((item, index) => {
    if (positions[index]) item.position = nearestPosition(room, project.furniture, item, positions[index]);
  });
  scalePoints = []; $('scale-form').hidden = true; drawScaleLine(); render();
}
$('scale-form').addEventListener('submit', event => {
  event.preventDefault(); if (!$('scale-form').reportValidity() || scalePoints.length !== 2) return;
  const distance = Math.hypot(scalePoints[1].x - scalePoints[0].x, scalePoints[1].y - scalePoints[0].y);
  if (distance < .001) { status('離れた2点を指定してください。'); return; }
  try { const factor = $('known-length').valueAsNumber / distance; rescaleRoom(factor, factor); status('縮尺を適用しました。家具の寸法はmmの設定値を保ち、位置を調整しています。'); }
  catch (error) { status(error.message); }
});
$('room-form').addEventListener('submit', event => {
  event.preventDefault(); if (!$('room-form').reportValidity()) return;
  try { rescaleRoom($('room-width').valueAsNumber / project.room.width, $('room-height').valueAsNumber / project.room.height); status('部屋全体のサイズを適用しました。家具の寸法を保って位置を調整しています。'); }
  catch (error) { status(error.message); }
});
function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
$('project-name').addEventListener('input', () => { project.name = $('project-name').value; });
$('export-project').addEventListener('click', () => {
  finishGesture(true);
  project.name = project.name.trim() || '家具配置データ';
  $('project-name').value = project.name;
  const filename = project.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '') || '家具配置データ';
  download(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), `${filename}.json`);
  status('画像・壁・床範囲・家具を含む編集データを保存しました。同じサイトで読み込むと編集を続けられます。');
});
$('project-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  const revision = ++loadRevision;
  try {
    const next = validateProject(JSON.parse(await file.text()));
    const image = next.room.background ? await decodeImage(next.room.background.dataUrl) : null;
    if (revision !== loadRevision) return;
    next.name = file.name.replace(/\.json$/i, '').trim().slice(0, 80) || next.name;
    finishGesture(false); project = next; backgroundImage = image;
    $('plan-image').src = next.room.background?.dataUrl || '';
    serial = next.furniture.length; rebuild(); viewport.scrollTo(0, 0);
    status('編集データを読み込みました。家具と間取りの編集を続けられます。');
  } catch (error) { if (revision === loadRevision) status(`読み込みに失敗しました。${error instanceof SyntaxError ? 'JSONファイルの内容を確認してください。' : error.message}`); }
  finally { event.target.value = ''; }
});
$('export-image').addEventListener('click', async () => {
  const button = $('export-image'); button.disabled = true;
  try {
    finishGesture(true);
    const room = project.room;
    const scale = 2048 / Math.max(room.width, room.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(room.width * scale)); canvas.height = Math.max(1, Math.round(room.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fffefa'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (backgroundImage && project.view.showPlan) ctx.drawImage(backgroundImage, 0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#66765ed9';
    for (const rect of room.walls) ctx.fillRect(rect.x * scale, rect.y * scale, rect.width * scale, rect.height * scale);
    for (const item of project.furniture) {
      if (!item.position) continue;
      const x = item.position.x * scale, y = item.position.y * scale, w = item.width * scale, h = item.height * scale;
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      ctx.fillStyle = item.color; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#00000030'; ctx.strokeRect(x, y, w, h);
      ctx.translate(x + w / 2, y + h / 2);
      const angle = item.rotation || 0;
      ctx.rotate(angle * Math.PI / 180);
      const sideways = angle % 180 !== 0;
      const text = fitLabel(ctx, item.label, sideways ? h : w, sideways ? w : h, 28);
      ctx.fillStyle = '#29352d'; ctx.font = `${text.size}px ${LABEL_FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      text.lines.forEach((line, index) => ctx.fillText(line, 0, (index - (text.lines.length - 1) / 2) * text.lineHeight));
      ctx.restore();
    }
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('画像を書き出せませんでした。');
    download(blob, '家具配置イメージ.png'); status('配置図をPNG画像に書き出しました。');
  } catch (error) { status(error.message); }
  finally { button.disabled = false; }
});
for (const [index, label] of ['A', 'B'].entries()) {
  const item = { id: uid(), name: `家具 ${label}`, label, width: 1000, height: 1000, color: colors[index], position: null, rotation: 0 };
  project.furniture.push(item); addNode(item); serial++;
}
beginNew(); setMode('furniture'); render();
document.fonts.ready.then(() => fitStage());
