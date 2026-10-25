import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createBridge } from '../bridge.mjs';

async function setup(enabled = true) {
  const bridge = createBridge({
    isEnabled: () => enabled,
    authenticate: async h => h === 'Bearer alpha' ? {id:'user-alpha'} :
                              h === 'Bearer bravo' ? {id:'user-bravo'} : null,
  });
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    bridge.handle(req, res, pathname).then(handled => {
      if (!handled) { res.writeHead(404); res.end(); }
    }).catch(error => { res.writeHead(500); res.end(String(error)); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, server, bridge };
}

test('status reports limitations and default-disabled bridge', async () => {
  const { base, server } = await setup(false);
  try {
    const status = await (await fetch(base+'/api/v1/bridge/status')).json();
    assert.equal(status.enabled, false);
    assert.equal(status.modelLoading, false);
    assert.equal((await fetch(base+'/api/v1/bridge/states')).status, 503);
  } finally { await new Promise(r=>server.close(r)); }
});

test('authentication, validation, per-user state, and removal', async () => {
  const { base, server } = await setup();
  const post = async (token, payload) => fetch(base+'/api/v1/bridge/state', {
    method:'POST',headers:{Authorization:token,'Content-Type':'application/json'},body:JSON.stringify(payload)});
  try {
    assert.equal((await fetch(base+'/api/v1/bridge/states')).status, 401);
    assert.equal((await post('Bearer alpha',{modelId:'NO SPACE',textureId:'skin_pink'})).status,400);
    assert.equal((await post('Bearer alpha',{modelId:'momo',textureId:'skin_pink'})).status,200);
    const response = await fetch(base+'/api/v1/bridge/states',{headers:{Authorization:'Bearer bravo'}});
    assert.equal(response.status,200);
    const state = (await response.json()).states;
    assert.equal(state.length,1);
    assert.equal(state[0].userId,'user-alpha');
    assert.equal(state[0].modelId,'momo');
    assert.equal((await post('Bearer alpha',{modelId:null})).status,200);
    assert.equal((await (await fetch(base+'/api/v1/bridge/states',{headers:{Authorization:'Bearer bravo'}})).json()).states.length,0);
  } finally { await new Promise(r=>server.close(r)); }
});

test('SSE receives updates made by another authenticated user', async () => {
  const { base, server } = await setup();
  const ctl = new AbortController();
  try {
    const sse = await fetch(base+'/api/v1/bridge/events',{headers:{Authorization:'Bearer bravo'},signal:ctl.signal});
    assert.equal(sse.status,200);
    const reader=sse.body.getReader();
    const first=await reader.read();
    assert.match(new TextDecoder().decode(first.value), /event: snapshot/);
    const post=await fetch(base+'/api/v1/bridge/state',{method:'POST',headers:{Authorization:'Bearer alpha','Content-Type':'application/json'},body:JSON.stringify({modelId:'momo',textureId:'skin_pink'})});
    assert.equal(post.status,200);
    const second=await reader.read();
    assert.match(new TextDecoder().decode(second.value), /event: appearance/);
    assert.match(new TextDecoder().decode(second.value), /momo/);
    ctl.abort();
  } finally { await new Promise(r=>server.close(r)); }
});
