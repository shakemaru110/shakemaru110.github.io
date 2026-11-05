import test from "node:test";
import assert from "node:assert/strict";
import { createGalleryGateway } from "./gallery-gateway.js";

function clock(options = {}) {
  let time = 0;
  return { set: value => { time = value; }, gateway: createGalleryGateway({
    now: () => time, sleep: async delay => { time += delay; }, ...options
  }) };
}

test("concurrent identical requests share a single upstream load", async () => {
  const { gateway } = clock();
  let calls = 0;
  const loader = async () => { calls++; await Promise.resolve(); return { entries: [1, 2] }; };
  const values = await Promise.all([gateway.load("a", loader), gateway.load("a", loader)]);
  assert.equal(calls, 1);
  assert.deepEqual(values[0], values[1]);
});

test("successful data is reused until TTL, and manual refresh bypasses it", async () => {
  const { gateway, set } = clock();
  let calls = 0;
  const loader = async () => ++calls;
  assert.equal(await gateway.load("a", loader, { ttl: 50 }), 1);
  assert.equal(await gateway.load("a", loader), 1);
  set(1000);
  assert.equal(await gateway.load("a", loader, { ttl: 50 }), 2);
  assert.equal(await gateway.load("a", loader, { refresh: true }), 3);
});

test("different upstream requests are serialized and spaced apart", async () => {
  let now = 0, active = 0;
  const starts = [];
  const gateway = createGalleryGateway({ now: () => now, sleep: async ms => { now += ms; } });
  const loader = async () => {
    assert.equal(active++, 0);
    starts.push(now);
    await Promise.resolve();
    active--;
    return "ok";
  };
  await Promise.all(["a", "b", "c"].map(key => gateway.load(key, loader)));
  assert.deepEqual(starts, [0, 1000, 2000]);
});

test("blocked requests start a cooldown that suppresses queued requests and expires", async () => {
  const { gateway, set } = clock();
  let calls = 0;
  const loader = async () => { calls++; throw Object.assign(new Error("blocked"), { code: "UPSTREAM_BLOCKED" }); };
  const results = await Promise.allSettled([gateway.load("a", loader), gateway.load("b", loader)]);
  assert.equal(calls, 1);
  assert.ok(results.every(result => result.status === "rejected" && result.reason.retryAfter === 900));
  set(1000);
  await assert.rejects(gateway.load("c", loader), error => error.retryAfter === 899);
  assert.equal(calls, 1);
  set(900001);
  assert.equal(await gateway.load("c", async () => "recovered"), "recovered");
});

test("valid cached data stays available during cooldown", async () => {
  const { gateway } = clock();
  await gateway.load("a", async () => "cached");
  await assert.rejects(gateway.load("b", async () => {
    throw Object.assign(new Error("blocked"), { code: "UPSTREAM_BLOCKED", retryAfter: 30 });
  }));
  assert.equal(await gateway.load("a", () => { throw new Error("must not load"); }), "cached");
});

test("ordinary failures are not cached", async () => {
  const { gateway } = clock();
  await assert.rejects(gateway.load("a", async () => { throw new Error("invalid markup"); }));
  assert.equal(await gateway.load("a", async () => "fixed"), "fixed");
});

test("cache capacity evicts the least recently used entry", async () => {
  const { gateway } = clock({ capacity: 2, interval: 0 });
  await gateway.load("a", async () => "a");
  await gateway.load("b", async () => "b");
  await gateway.load("a", () => { throw new Error("must hit cache"); });
  await gateway.load("c", async () => "c");
  assert.equal(await gateway.load("b", async () => "new b"), "new b");
});
