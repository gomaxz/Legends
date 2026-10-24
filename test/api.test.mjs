import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../server.mjs';

async function withServer(run) {
  const server = createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('health devuelve servicio y versión', async () => {
  await withServer(async (url) => {
    const resp = await fetch(`${url}/health`);
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(body.ok, true);
    assert.equal(body.service, 'legends-ysm-api');
  });
});

test('catálogo vacío es válido y no inventa personajes cargados', async () => {
  await withServer(async (url) => {
    const resp = await fetch(`${url}/api/v1/models`);
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(body.count, 0);
    assert.deepEqual(body.models, []);
  });
});

test('no se puede subir modelos sin autorización', async () => {
  await withServer(async (url) => {
    const resp = await fetch(`${url}/api/v1/models`, { method: 'POST' });
    assert.equal(resp.status, 405);
  });
});

test('un modelo inexistente no genera una descarga', async () => {
  await withServer(async (url) => {
    const resp = await fetch(`${url}/api/v1/models/inexistente/assets/geometry`);
    assert.equal(resp.status, 404);
  });
});
