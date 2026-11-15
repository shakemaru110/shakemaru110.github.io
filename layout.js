// All geometry is in millimetres. Walls, floor regions, and furniture are rectangles.
export const EPSILON = 0.000001;

export function overlaps(a, b) {
  return a.x < b.x + b.width - EPSILON && a.x + a.width > b.x + EPSILON &&
    a.y < b.y + b.height - EPSILON && a.y + a.height > b.y + EPSILON;
}

function coveredByFloor(rect, areas) {
  let remaining = [rect];
  for (const area of areas) {
    const next = [];
    for (const part of remaining) {
      if (!overlaps(part, area)) { next.push(part); continue; }
      const left = Math.max(part.x, area.x);
      const top = Math.max(part.y, area.y);
      const right = Math.min(part.x + part.width, area.x + area.width);
      const bottom = Math.min(part.y + part.height, area.y + area.height);
      if (top > part.y + EPSILON) next.push({ x: part.x, y: part.y, width: part.width, height: top - part.y });
      if (bottom < part.y + part.height - EPSILON) next.push({ x: part.x, y: bottom, width: part.width, height: part.y + part.height - bottom });
      if (left > part.x + EPSILON) next.push({ x: part.x, y: top, width: left - part.x, height: bottom - top });
      if (right < part.x + part.width - EPSILON) next.push({ x: right, y: top, width: part.x + part.width - right, height: bottom - top });
    }
    remaining = next;
    if (!remaining.length) return true;
  }
  return false;
}

export function canPlace(room, furniture, item, position) {
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return false;
  const rect = { ...position, width: item.width, height: item.height };
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > room.width + EPSILON ||
      rect.y + rect.height > room.height + EPSILON || !coveredByFloor(rect, room.areas)) return false;
  return !room.walls.some(wall => overlaps(rect, wall)) &&
    !furniture.some(other => other.id !== item.id && other.position && overlaps(rect, { ...other.position, width: other.width, height: other.height }));
}

export function nearestPosition(room, furniture, item, target, previous = target) {
  if (item.width > room.width || item.height > room.height) return null;
  if (canPlace(room, furniture, item, target)) return target;
  const maxX = room.width - item.width;
  const maxY = room.height - item.height;
  const clampX = x => Math.max(0, Math.min(maxX, x));
  const clampY = y => Math.max(0, Math.min(maxY, y));
  const xs = new Set([clampX(target.x), 0, maxX]);
  const ys = new Set([clampY(target.y), 0, maxY]);
  const obstacles = [...room.walls, ...furniture.filter(other => other.id !== item.id && other.position)
    .map(other => ({ ...other.position, width: other.width, height: other.height }))];
  for (const rect of obstacles) {
    xs.add(clampX(rect.x - item.width)); xs.add(clampX(rect.x + rect.width));
    ys.add(clampY(rect.y - item.height)); ys.add(clampY(rect.y + rect.height));
  }
  // Concave floor boundaries can constrain either side of the moving rectangle.
  for (const area of room.areas) {
    for (const x of [area.x, area.x + area.width, area.x - item.width, area.x + area.width - item.width]) xs.add(clampX(x));
    for (const y of [area.y, area.y + area.height, area.y - item.height, area.y + area.height - item.height]) ys.add(clampY(y));
  }
  let best = null;
  let bestDistance = Infinity;
  let bestPreviousDistance = Infinity;
  for (const y of ys) {
    for (const x of xs) {
      const distance = (x - target.x) ** 2 + (y - target.y) ** 2;
      if (distance > bestDistance + EPSILON) continue;
      if (!canPlace(room, furniture, item, { x, y })) continue;
      const previousDistance = (x - previous.x) ** 2 + (y - previous.y) ** 2;
      if (distance < bestDistance - EPSILON || previousDistance < bestPreviousDistance) {
        best = { x, y }; bestDistance = distance; bestPreviousDistance = previousDistance;
      }
    }
  }
  return best;
}

export function validateProject(value) {
  const fail = () => { throw new Error("家具配置シミュレータの有効な保存ファイルではありません。"); };
  const number = (n, min, max) => typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
  const text = (s, max) => typeof s === "string" && s.length <= max;
  if (!value || value.format !== "furniture-layout" || value.version !== 1 || value.unit !== "mm") fail();
  const room = value.room;
  if (!room || !number(room.width, 1, 100000) || !number(room.height, 1, 100000) ||
      typeof room.calibrated !== "boolean" || !Array.isArray(room.areas) || !Array.isArray(room.walls)) fail();
  for (const rect of [...room.areas, ...room.walls]) {
    if (!rect || !text(rect.id, 100) || !rect.id || !number(rect.x, 0, room.width) || !number(rect.y, 0, room.height) ||
        !number(rect.width, EPSILON, room.width) || !number(rect.height, EPSILON, room.height) ||
        rect.x + rect.width > room.width + EPSILON || rect.y + rect.height > room.height + EPSILON) fail();
  }
  if (room.background !== null && (!room.background || !text(room.background.name, 300) ||
      typeof room.background.dataUrl !== "string" || !/^data:image\/(png|jpeg|webp|avif);base64,[A-Za-z0-9+/=]+$/.test(room.background.dataUrl))) fail();
  if (!Array.isArray(value.furniture)) fail();
  const ids = new Set();
  const furniture = [];
  for (const item of value.furniture) {
    if (!item || !text(item.id, 100) || !item.id || ids.has(item.id) || !text(item.name, 80) || !item.name.trim() ||
        !text(item.label, 40) || !number(item.width, 1, 100000) || !number(item.height, 1, 100000) ||
        !/^#[0-9a-f]{6}$/i.test(item.color)) fail();
    ids.add(item.id);
    const clean = { id: item.id, name: item.name, label: item.label, width: item.width, height: item.height, color: item.color,
      position: item.position === null ? null : { x: item.position?.x, y: item.position?.y } };
    if (item.position !== null && !canPlace(room, furniture, clean, item.position)) fail();
    furniture.push(clean);
  }
  const rectIds = [...room.areas, ...room.walls].map(rect => rect.id);
  if (new Set(rectIds).size !== rectIds.length) fail();
  return {
    format: "furniture-layout", version: 1, unit: "mm",
    room: { width: room.width, height: room.height, calibrated: room.calibrated,
      background: room.background ? { name: room.background.name, dataUrl: room.background.dataUrl } : null,
      areas: room.areas.map(({ id, x, y, width, height }) => ({ id, x, y, width, height })),
      walls: room.walls.map(({ id, x, y, width, height }) => ({ id, x, y, width, height })) },
    furniture,
    view: { zoom: number(value.view?.zoom, .25, 4) ? value.view.zoom : 1, showPlan: value.view?.showPlan !== false }
  };
}
