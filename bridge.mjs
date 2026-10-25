// Legends YSM Bridge v0.2: authenticated metadata signaling over SSE + HTTP.
// Does NOT patch YSM Waiting, load geometry or apply skins; client integration is separate.
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_BODY = 4096;
const TTL = 90000;
const MAX_PEERS = 100;
const MAX_PER_USER = 2;

function json(res, code, data) {
  if (res.headersSent) return;
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  const ct = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (ct !== 'application/json') throw Object.assign(new Error('Content-Type must be application/json'), { status: 415 });
  let bytes = 0;
  const parts = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY) throw Object.assign(new Error('Body too large'), { status: 413 });
    parts.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

export function createBridge({ authenticate, isEnabled = () => process.env.ENABLE_BRIDGE === 'true' } = {}) {
  if (typeof authenticate !== 'function') throw new TypeError('authenticate required');
  const peers = new Set();
  const states = new Map();
  let eventNumber = 0;

  function prune() {
    const now = Date.now();
    for (const [userId, state] of states) if (now - state.updatedAt > TTL) states.delete(userId);
  }

  function snapshot() {
    prune();
    return [...states.entries()].map(([userId, state]) => ({
      userId,
      modelId: state.modelId,
      textureId: state.textureId,
      updatedAt: state.updatedAt,
    }));
  }

  function broadcast(type, payload) {
    const event = `id: ${++eventNumber}\nevent: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const peer of [...peers]) {
      if (peer.res.destroyed || peer.res.writableEnded) { peers.delete(peer); continue; }
      // Disconnect slow readers, rather than accumulating memory indefinitely.
      if (!peer.res.write(event)) peer.res.end();
    }
  }

  async function handle(req, res, pathname) {
    if (pathname === '/api/v1/bridge/status') {
      if (req.method !== 'GET') json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
      else json(res, 200, { protocol: 'sse', version: 1, enabled: isEnabled(),
        modelLoading: false, characterApplication: false, serverYsmEmulation: false });
      return true;
    }
    if (!pathname.startsWith('/api/v1/bridge/')) return false;
    if (!isEnabled()) { json(res, 503, { error: 'BRIDGE_DISABLED' }); return true; }
    if (!['GET', 'POST'].includes(req.method)) { json(res, 405, { error: 'METHOD_NOT_ALLOWED' }); return true; }

    let user;
    try { user = await authenticate(req.headers.authorization); }
    catch { json(res, 503, { error: 'AUTH_UNAVAILABLE' }); return true; }
    if (!user || typeof user.id !== 'string' || user.id.length > 128) {
      json(res, 401, { error: 'AUTH_REQUIRED' }); return true;
    }
    const userId = user.id;
    if (pathname === '/api/v1/bridge/states' && req.method === 'GET') {
      json(res, 200, { states: snapshot(), ttlSeconds: TTL / 1000 }); return true;
    }
    if (pathname === '/api/v1/bridge/events' && req.method === 'GET') {
      if (peers.size >= MAX_PEERS || [...peers].filter(p => p.userId === userId).length >= MAX_PER_USER) {
        json(res, 429, { error: 'TOO_MANY_SUBSCRIPTIONS' }); return true;
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'X-Content-Type-Options': 'nosniff',
      });
      res.write(`retry: 5000\nevent: snapshot\ndata: ${JSON.stringify({ states: snapshot() })}\n\n`);
      const peer = { userId, res };
      peers.add(peer);
      const heartbeat = setInterval(() => {
        if (!res.destroyed && !res.writableEnded) res.write(': keepalive\n\n');
      }, 20000);
      heartbeat.unref?.();
      const cleanup = () => { clearInterval(heartbeat); peers.delete(peer); };
      req.on('close', cleanup);
      res.on('close', cleanup);
      return true;
    }
    if (pathname === '/api/v1/bridge/state' && req.method === 'POST') {
      try {
        const payload = await readJson(req);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
            !((payload.modelId === null) ||
               (typeof payload.modelId === 'string' && ID.test(payload.modelId))) ||
            (payload.modelId !== null && !(typeof payload.textureId === 'string' && ID.test(payload.textureId))) ||
            (payload.modelId === null && payload.textureId != null)) {
          json(res, 400, { error: 'INVALID_MODEL_SELECTION' }); return true;
        }
        if (payload.modelId === null) {
          states.delete(userId);
          broadcast('appearance', { userId, modelId: null, textureId: null });
        } else {
          states.set(userId, { modelId: payload.modelId, textureId: payload.textureId, updatedAt: Date.now() });
          broadcast('appearance', { userId, modelId: payload.modelId, textureId: payload.textureId });
        }
        json(res, 200, { ok: true, stored: true, appliedInYsm: false });
      } catch (error) {
        json(res, error.status || 400, { error: 'BAD_REQUEST' });
      }
      return true;
    }
    json(res, 404, { error: 'NOT_FOUND' }); return true;
  }

  return { handle, snapshot };
}
