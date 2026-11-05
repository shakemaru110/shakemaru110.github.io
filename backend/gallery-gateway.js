// State is per Worker isolate, not a global rate limit across Cloudflare's shared IPs.
export function createGalleryGateway({ now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), interval = 1000,
  capacity = 128 } = {}) {
  const cache = new Map();
  const pending = new Map();
  let queue = Promise.resolve();
  let lastStart = -Infinity;
  let blockedUntil = 0;
  let blockedError;

  async function load(key, loader, { ttl = 60000, refresh = false } = {}) {
    const cached = cache.get(key);
    if (cached && cached.expires > now() && !refresh) {
      cache.delete(key);
      cache.set(key, cached);
      return cached.value;
    }
    if (cached && cached.expires <= now()) cache.delete(key);
    if (pending.has(key)) return pending.get(key);
    const operation = queue.then(async () => {
      if (blockedUntil > now()) {
        blockedError.retryAfter = Math.ceil((blockedUntil - now()) / 1000);
        throw blockedError;
      }
      const delay = lastStart + interval - now();
      if (delay > 0) await sleep(delay);
      lastStart = now();
      try {
        const value = await loader();
        cache.delete(key);
        cache.set(key, { value, expires: now() + ttl });
        while (cache.size > capacity) cache.delete(cache.keys().next().value);
        return value;
      } catch (error) {
        if (error.code === "UPSTREAM_BLOCKED") {
          error.retryAfter = Number.isSafeInteger(error.retryAfter) && error.retryAfter > 0 ? error.retryAfter : 900;
          blockedUntil = now() + error.retryAfter * 1000;
          blockedError = error;
        }
        throw error;
      }
    });
    queue = operation.catch(() => {});
    pending.set(key, operation);
    try { return await operation; }
    finally { pending.delete(key); }
  }

  return { load };
}
