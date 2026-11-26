'use strict';
// The routes of /api/v1. The OpenAPI document is built from the same table, so every route is documented.
const meta = require('./meta');
const { ApiError } = require('./store');

const S = { type: 'string' };
const I = { type: 'integer' };
const B = { type: 'boolean' };
const A = { type: 'array', items: S };
const pick = list => ({ type: 'string', enum: list.map(x => x.id || x) });

const card = {
  title: S, description: S, type: pick(meta.TYPES), priority: pick(meta.PRIORITIES), status: pick(meta.STATUSES),
  area: Object.assign({ description: "One of the project's areas" }, S), labels: A, commit: S,
  ref: Object.assign({ description: 'Your own reference, such as an issue number elsewhere' }, S),
  due: Object.assign({ description: 'YYYY-MM-DD' }, S)
};
const project = { name: S, description: S, color: pick(meta.COLORS), areas: A, repository: S, archived: B };
const filters = { project: 'Project keys, comma separated', status: 'Comma separated', type: 'Comma separated', priority: 'Comma separated', area: 'Comma separated', label: 'One label', ref: 'Exact reference', q: 'Text search' };

/** method, path, summary, handler(store, {params, query, body}), documentation. A handler result of status 201 is marked in the doc. */
const ROUTES = [
  ['GET', '/meta', 'Statuses, types, priorities and colours', () => meta],
  ['GET', '/revision', 'A number that grows with every change (poll it to stay up to date)', s => ({ revision: s.revision })],

  ['GET', '/projects', 'Projects with their counts', s => s.projects()],
  ['POST', '/projects', 'Register a project', (s, r) => s.addProject(r.body), { status: 201, body: Object.assign({ key: S }, project), required: ['key', 'name'] }],
  ['GET', '/projects/{key}', 'One project', (s, r) => s.project(r.params.key)],
  ['PATCH', '/projects/{key}', 'Change or archive a project', (s, r) => s.changeProject(r.params.key, r.body), { body: project }],
  ['DELETE', '/projects/{key}', 'Delete a project; with cards it needs ?confirm=KEY', (s, r) => s.removeProject(r.params.key, r.query.confirm), { query: { confirm: 'The project key' } }],

  ['GET', '/projects/{key}/cards', "A project's cards", (s, r) => (s.project(r.params.key), s.cards(Object.assign({}, r.query, { project: r.params.key }))), { query: filters }],
  ['POST', '/projects/{key}/cards', 'Add a card (bug, task, ...)', (s, r) => s.addCard(r.params.key, r.body), { status: 201, body: card, required: ['title'] }],
  ['POST', '/projects/{key}/cards/batch', 'Add several cards at once (all or none)', (s, r) => s.addCards(r.params.key, r.body.cards), { status: 201, body: { cards: { type: 'array', items: { type: 'object', properties: card, required: ['title'] } } }, required: ['cards'] }],

  ['GET', '/cards', 'Search cards across projects', (s, r) => s.cards(r.query), { query: filters }],
  ['POST', '/cards/move', 'Move many cards: list ids, or give project and from', (s, r) => s.moveMany(r.body), { body: { ids: A, project: S, from: pick(meta.STATUSES), to: pick(meta.STATUSES), note: S, commit: S }, required: ['to'] }],
  ['POST', '/cards/restore', 'Undo a delete: send back the deleted card', (s, r) => s.restoreCard(r.body.card), { status: 201, body: { card: { type: 'object' } }, required: ['card'] }],
  ['GET', '/cards/{id}', 'One card with comments and history', (s, r) => s.card(r.params.id)],
  ['PATCH', '/cards/{id}', 'Change a card: fields, status (with note), position in the column. Send version to refuse overwriting newer changes', (s, r) => s.changeCard(r.params.id, r.body), { body: Object.assign({}, card, { note: S, position: I, version: I }) }],
  ['DELETE', '/cards/{id}', 'Delete a card; the answer can be sent to /cards/restore', (s, r) => s.removeCard(r.params.id)],
  ['POST', '/cards/{id}/comments', 'Comment on a card', (s, r) => s.comment(r.params.id, r.body), { status: 201, body: { text: S, author: S }, required: ['text'] }],

  ['GET', '/activity', 'Latest changes, newest first', (s, r) => s.activity(r.query), { query: { project: 'Project key', card: 'Card id', limit: '1 to 500' } }],
  ['GET', '/export', 'The whole board, for backup', s => s.export()]
].map(([method, path, summary, handler, doc]) => ({
  method, path, summary, handler, doc: doc || {},
  names: [...path.matchAll(/\{(\w+)\}/g)].map(m => m[1]),
  pattern: new RegExp('^' + path.replace(/\{\w+\}/g, '([^/]+)') + '$')
}));

function route(store, method, path, query, body) {
  let allowed = [];
  for (const r of ROUTES) {
    const m = path.match(r.pattern);
    if (!m) { continue; }
    if (r.method !== method) { allowed.push(r.method); continue; }
    let values;
    try { values = m.slice(1).map(decodeURIComponent); } catch (e) { throw new ApiError(400, 'invalid', 'The address is not valid.'); }
    const params = Object.fromEntries(r.names.map((n, i) => [n, values[i]]));
    return { status: r.doc.status || 200, result: r.handler(store, { params, query, body }) };
  }
  if (allowed.length) { throw new ApiError(405, 'method_not_allowed', 'Use ' + allowed.join(', ') + '.'); }
  throw new ApiError(404, 'not_found', 'There is no such route.');
}

function openapi(secured) {
  const paths = {};
  for (const r of ROUTES) {
    const op = { summary: r.summary, tags: [r.path.split('/')[1]], responses: { [r.doc.status || 200]: { description: 'OK' } } };
    const parameters = r.names.map(name => ({ name, in: 'path', required: true, schema: S }))
      .concat(Object.entries(r.doc.query || {}).map(([name, description]) => ({ name, in: 'query', description, schema: S })));
    if (parameters.length) { op.parameters = parameters; }
    if (r.doc.body) {
      const schema = { type: 'object', properties: r.doc.body };
      if (r.doc.required) { schema.required = r.doc.required; }
      op.requestBody = { required: true, content: { 'application/json': { schema } } };
      op.responses[400] = { description: 'Refused: {"error": {"code", "message"}}' };
    }
    (paths[r.path] = paths[r.path] || {})[r.method.toLowerCase()] = op;
  }
  const doc = {
    openapi: '3.0.3',
    info: { title: 'Kanban API', version: '1.0.0', description: 'Projects and their cards. Errors: {"error": {"code": "...", "message": "..."}}. Bodies are JSON with Content-Type application/json.' },
    servers: [{ url: '/api/v1' }],
    paths
  };
  if (secured) {
    doc.security = [{ bearer: [] }];
    doc.components = { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } };
  }
  return doc;
}

module.exports = { route, openapi, ROUTES };
