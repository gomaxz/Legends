import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';

test('existing health and models routes plus bridge status, no auth disabled by default', async () => {
  const app = createApp();
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const base=`http://127.0.0.1:${app.address().port}`;
  try {
    const health=await fetch(base+'/health');
    assert.equal(health.status,200);
    assert.equal((await health.json()).service,'legends-ysm-api');
    const models=await fetch(base+'/api/v1/models');
    assert.equal(models.status,200);
    assert.equal((await models.json()).version,1);
    const status=await fetch(base+'/api/v1/bridge/status');
    assert.equal(status.status,200);
    const obj=await status.json();
    assert.equal(obj.modelLoading,false);
    assert.equal(obj.serverYsmEmulation,false);
    assert.equal(obj.enabled,false);
    assert.equal((await fetch(base+'/api/v1/bridge/states')).status,503);
    assert.equal((await fetch(base+'/api/v1/not-found')).status,404);
  } finally { await new Promise(resolve=>app.close(resolve)); }
});
