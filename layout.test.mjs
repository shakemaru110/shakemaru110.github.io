import test from 'node:test';
import assert from 'node:assert/strict';
import { canPlace, nearestPosition, validateProject } from './layout.js';

const rect = (x, y, width, height, id = 'floor') => ({ id, x, y, width, height });
const furniture = (id, width, height, position = null) => ({ id, name: id, label: id, width, height, color: '#a7b6d0', position });
const room = (areas = [rect(0, 0, 4000, 4000)], walls = []) => ({ width: 4000, height: 4000, calibrated: true, background: null, areas, walls });

test('rectangular furniture must fit entirely within the union of floor regions', () => {
  const item = furniture('A', 1200, 600);
  const model = room([rect(0, 0, 2000, 1000), rect(0, 1000, 1000, 2000, 'extension')]);
  assert.equal(canPlace(model, [], item, { x: 500, y: 400 }), true);
  assert.equal(canPlace(model, [], item, { x: 500, y: 500 }), false);
  const adjacent = room([rect(0, 0, 1000, 2000), rect(1000, 0, 1000, 2000, 'other')]);
  assert.equal(canPlace(adjacent, [], item, { x: 400, y: 800 }), true);
  adjacent.areas[1].x += 1;
  assert.equal(canPlace(adjacent, [], item, { x: 400, y: 800 }), false);
  assert.equal(canPlace(room([]), [], item, { x: 0, y: 0 }), false);
});

test('walls and other furniture constrain the nearest position using each rectangle size', () => {
  const model = room(undefined, [rect(2000, 0, 100, 3000, 'wall')]);
  const item = furniture('sofa', 1500, 600);
  assert.deepEqual(nearestPosition(model, [], item, { x: 1700, y: 1000 }), { x: 2100, y: 1000 });
  assert.equal(canPlace(model, [], item, { x: 500, y: 1000 }), true);
  assert.equal(canPlace(model, [], item, { x: 501, y: 1000 }), false);
  const obstacle = furniture('shelf', 500, 1700, { x: 2800, y: 2000 });
  assert.deepEqual(nearestPosition(room(), [obstacle], item, { x: 3000, y: 2100 }), { x: 2500, y: 1400 });
  assert.equal(nearestPosition(room(), [], furniture('large', 4001, 100), { x: 0, y: 0 }), null);
});

test('nearest positions match exhaustive integer search with concave floors and several obstacles', () => {
  const model = { ...room(), width: 20, height: 14,
    areas: [rect(0, 0, 20, 8), rect(0, 8, 9, 6, 'leg')],
    walls: [rect(6, 0, 1, 6, 'wall-a'), rect(13, 4, 3, 1, 'wall-b')] };
  const item = furniture('moving', 3, 2);
  const others = [furniture('occupied', 2, 3, { x: 2, y: 8 })];
  for (let n = 0; n < 100; n++) {
    const target = { x: n * 7 % 27 - 3, y: n * 11 % 23 - 4 };
    let expected = Infinity;
    for (let y = 0; y <= 12; y++) for (let x = 0; x <= 17; x++) {
      if (canPlace(model, others, item, { x, y })) expected = Math.min(expected, (x - target.x) ** 2 + (y - target.y) ** 2);
    }
    const actual = nearestPosition(model, others, item, target);
    assert.ok(actual && canPlace(model, others, item, actual));
    assert.equal((actual.x - target.x) ** 2 + (actual.y - target.y) ** 2, expected);
  }
});

test('project files preserve names, independent labels, images, geometry and unplaced objects', () => {
  const model = { format: 'furniture-layout', version: 1, unit: 'mm', room: room(),
    furniture: [furniture('ソファ', 1500, 600, { x: 100, y: 200 }), furniture('棚', 500, 1000)],
    view: { zoom: 1.5, showPlan: true } };
  model.furniture[0].label = 'S1';
  model.room.background = { name: 'plan.png', dataUrl: 'data:image/png;base64,AAAA' };
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(model))), model);
  const snapshot = JSON.stringify(model);
  for (const change of [
    value => value.unit = 'm', value => value.version = 2,
    value => value.furniture[0].width = -1,
    value => value.furniture[1].id = value.furniture[0].id,
    value => value.furniture[1].position = { x: 100, y: 200 },
    value => value.room.walls.push(rect(100, 200, 10, 10, 'blocked')),
    value => value.room.background.dataUrl = 'data:image/svg+xml;base64,AAAA'
  ]) {
    const altered = JSON.parse(snapshot); change(altered);
    assert.throws(() => validateProject(altered));
  }
  assert.equal(JSON.stringify(model), snapshot);
});

