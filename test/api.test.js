'use strict';
// node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { create } = require('../server');

async function board(t, options) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-test-'));
  const file = path.join(dir, 'board.json');
  const server = create(Object.assign({ file }, options));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (method, url, body, headers) => {
    const res = await fetch(base + '/api/v1' + url, { method, headers: Object.assign(body === undefined ? {} : { 'content-type': 'application/json' }, headers), body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  return { server, base, call, file };
}
const titles = async (call, status) => (await call('GET', '/cards?status=' + status)).body.map(c => c.title);

test('projects are registered, validated and deleted only with confirmation', async t => {
  const { call } = await board(t);
  let r = await call('POST', '/projects', { key: 'web', name: 'Website', areas: ['UI', 'API'] });
  assert.equal(r.status, 201);
  assert.equal(r.body.key, 'WEB');
  assert.equal(r.body.stats.total, 0);
  assert.equal((await call('POST', '/projects', { key: 'WEB', name: 'Again' })).status, 409);
  for (const bad of [{ key: '1A', name: 'x' }, { key: 'OK', name: '' }, { key: 'OK', name: 'x', color: 'pink' }, { key: 'OK', name: 'x', repository: 'javascript:alert(1)' }, { key: 'OK', name: 'x', extra: 1 }]) {
    assert.equal((await call('POST', '/projects', bad)).status, 400, JSON.stringify(bad));
  }
  await call('POST', '/projects/WEB/cards', { title: 'a' });
  assert.equal((await call('DELETE', '/projects/WEB')).status, 409);
  assert.equal((await call('DELETE', '/projects/WEB?confirm=WEB')).status, 200);
  assert.deepEqual((await call('GET', '/cards')).body, []);
});

test('cards: add, classify, move, order, comment, history', async t => {
  const { call } = await board(t);
  await call('POST', '/projects', { key: 'WEB', name: 'Website', areas: ['UI'] });
  const low = (await call('POST', '/projects/WEB/cards', { title: 'low', priority: 'P4' })).body;
  assert.equal(low.id, 'WEB-1');
  await call('POST', '/projects/WEB/cards', { title: 'urgent', priority: 'P1', type: 'bug', area: 'UI' });
  await call('POST', '/projects/WEB/cards', { title: 'middle' });
  assert.deepEqual(await titles(call, 'todo'), ['urgent', 'middle', 'low']);
  await call('PATCH', '/cards/web-1', { position: 0 });
  assert.deepEqual(await titles(call, 'todo'), ['low', 'urgent', 'middle']);
  let r = await call('PATCH', '/cards/WEB-2', { status: 'fixed', note: 'done', commit: 'abc' });
  assert.equal(r.body.status, 'fixed');
  assert.deepEqual(r.body.history.map(h => [h.from, h.to]), [[undefined, 'todo'], ['todo', 'fixed']]);
  assert.deepEqual((await call('GET', '/cards?status=todo')).body.map(c => c.rank), [0, 1]);
  r = await call('POST', '/cards/WEB-2/comments', { text: 'looks good', author: 'me' });
  assert.equal(r.body.comments.length, 1);
  for (const bad of [{ status: 'nope' }, { area: 'Nowhere' }, { title: ' ' }, { due: 'soon' }, { id: 'WEB-9' }, { position: -1 }]) {
    assert.equal((await call('PATCH', '/cards/WEB-2', bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await call('PATCH', '/cards/WEB-2', { title: 'x', version: 1 })).status, 409);
  assert.equal((await call('GET', '/projects/WEB')).body.stats.byStatus.fixed, 1);
  assert.equal((await call('GET', '/cards?q=urg')).body.length, 1);
  assert.equal((await call('GET', '/activity?card=WEB-2')).body[0].action, 'card.commented');
});

test('batch and bulk moves are all or nothing', async t => {
  const { call } = await board(t);
  await call('POST', '/projects', { key: 'APP', name: 'App' });
  assert.equal((await call('POST', '/projects/APP/cards/batch', { cards: [{ title: 'ok' }, { title: '' }] })).status, 400);
  assert.deepEqual((await call('GET', '/cards')).body, []);
  assert.equal((await call('POST', '/projects/APP/cards/batch', { cards: [{ title: 'a', status: 'pushed' }, { title: 'b', status: 'pushed' }] })).body.length, 2);
  assert.equal((await call('POST', '/cards/move', { ids: ['APP-1', 'APP-99'], to: 'todo' })).status, 404);
  assert.deepEqual(await titles(call, 'pushed'), ['a', 'b']);
  assert.equal((await call('POST', '/cards/move', { project: 'APP', from: 'pushed', to: 'deployed' })).body.length, 2);
  assert.deepEqual(await titles(call, 'deployed'), ['a', 'b']);
});

test('delete can be undone and ids are never reused', async t => {
  const { call } = await board(t);
  await call('POST', '/projects', { key: 'APP', name: 'App' });
  await call('POST', '/projects/APP/cards', { title: 'keep me' });
  await call('POST', '/cards/APP-1/comments', { text: 'hello' });
  const gone = (await call('DELETE', '/cards/APP-1')).body;
  assert.equal((await call('POST', '/projects/APP/cards', { title: 'next' })).body.id, 'APP-2');
  const back = (await call('POST', '/cards/restore', { card: gone })).body;
  assert.equal(back.id, 'APP-1');
  assert.equal(back.comments[0].text, 'hello');
  assert.equal((await call('POST', '/cards/restore', { card: gone })).status, 409);
  assert.equal((await call('POST', '/cards/restore', { card: Object.assign({}, gone, { id: 'APP-50' }) })).status, 400);
});

test('data survives a restart, and a damaged file is never overwritten', async t => {
  const { call, file } = await board(t);
  await call('POST', '/projects', { key: 'APP', name: 'App' });
  const again = create({ file });
  assert.equal(again.store.projects()[0].key, 'APP');
  fs.writeFileSync(file, '{ broken');
  assert.throws(() => create({ file }));
});

test('only this computer and JSON may write; routes and errors are consistent', async t => {
  const { call, base } = await board(t);
  assert.equal((await call('POST', '/projects', '{"key":"AB","name":"x"}', { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await call('POST', '/projects', '{', {})).status, 400);
  assert.equal((await call('GET', '/projects', undefined, { origin: 'http://example.com' })).status, 403);
  const port = Number(new URL(base).port);
  const rebound = await new Promise(resolve => http.get({ host: '127.0.0.1', port, path: '/api/v1/projects', headers: { host: 'evil.example:' + port } }, r => { r.resume(); resolve(r.statusCode); }));
  assert.equal(rebound, 403);
  assert.equal((await call('PUT', '/projects')).status, 405);
  assert.equal((await call('GET', '/nope')).body.error.code, 'not_found');
  assert.equal((await call('GET', '/cards/%ZZ')).status, 400);
  assert.equal((await fetch(base + '/../server.js')).status, 404);
  const spec = (await call('GET', '/openapi.json')).body;
  assert.ok(spec.paths['/projects/{key}/cards'].post);
});

test('with a token every API call needs it', async t => {
  const { call, base } = await board(t, { token: 's3cret' });
  assert.equal((await call('GET', '/projects')).status, 401);
  assert.equal((await call('GET', '/openapi.json', undefined, { authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await call('GET', '/projects', undefined, { authorization: 'Bearer s3cret' })).status, 200);
  assert.equal((await fetch(base + '/')).status, 200);
});
