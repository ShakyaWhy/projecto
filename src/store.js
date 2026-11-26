'use strict';
// All data and every rule about it. One JSON file, written atomically; a copy of the last good version sits beside it.
const fs = require('fs');
const path = require('path');
const { STATUSES, TYPES, PRIORITIES, DEFAULT_AREAS, COLORS } = require('./meta');

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const bad = message => new ApiError(400, 'invalid', message);
const missing = what => new ApiError(404, 'not_found', what + ' was not found.');
const clash = message => new ApiError(409, 'conflict', message);

const now = () => new Date().toISOString();
const ids = list => list.map(x => x.id);

function text(value, name, max, required) {
  if (typeof value !== 'string') { throw bad(name + ' must be text.'); }
  const out = value.replace(/\r\n/g, '\n').trim();
  if (required && !out) { throw bad(name + ' cannot be empty.'); }
  if (out.length > max) { throw bad(name + ' is longer than ' + max + ' characters.'); }
  return out;
}
function oneOf(value, list, name) {
  if (!list.includes(value)) { throw bad(name + ' must be one of: ' + list.join(', ') + '.'); }
  return value;
}
function words(value, name, max, count) {
  if (!Array.isArray(value)) { throw bad(name + ' must be a list.'); }
  const out = [...new Set(value.map(v => text(v, name, max, true)))];
  if (out.length > count) { throw bad(name + ' can hold at most ' + count + ' entries.'); }
  return out;
}
function only(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) { throw bad('Send a JSON object.'); }
  const unknown = Object.keys(input).filter(k => !allowed.includes(k));
  if (unknown.length) { throw bad('Unknown field: ' + unknown.join(', ') + '.'); }
  return input;
}

const PROJECT_FIELDS = ['key', 'name', 'description', 'color', 'areas', 'repository', 'archived'];
const CARD_FIELDS = ['title', 'description', 'type', 'priority', 'status', 'area', 'labels', 'commit', 'ref', 'due'];

class Store {
  constructor(file) {
    this.file = file;
    this.data = { revision: 1, projects: [], cards: [], activity: [] };
    if (fs.existsSync(file)) {
      // a damaged file stops the start-up: carrying on would overwrite it with an empty board
      this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  }

  get revision() { return this.data.revision; }

  /** Applies a change and saves it; if the change fails or cannot be saved, memory is left as it was. */
  commit(work) {
    const before = JSON.stringify(this.data);
    try {
      const result = work();
      this.data.revision++;
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data, null, 1) + '\n');
      if (fs.existsSync(this.file)) { fs.copyFileSync(this.file, this.file + '.bak'); }
      fs.renameSync(this.file + '.tmp', this.file);
      return structuredClone(result);
    } catch (e) {
      this.data = JSON.parse(before);
      throw e;
    }
  }

  log(project, card, action, detail) {
    this.data.activity.push({ at: now(), project, card, action, detail });
    if (this.data.activity.length > 2000) { this.data.activity.splice(0, this.data.activity.length - 2000); }
  }

  /* ------------------------------------------------------------ projects */

  rawProject(key) {
    const p = this.data.projects.find(x => x.key === String(key).toUpperCase());
    if (!p) { throw missing('Project ' + key); }
    return p;
  }

  describe(p) {
    const cards = this.data.cards.filter(c => c.project === p.key);
    const count = (list, field) => Object.fromEntries(ids(list).map(id => [id, cards.filter(c => c[field] === id).length]));
    const open = cards.filter(c => !['deployed', 'wontfix'].includes(c.status));
    const { nextNumber, ...shown } = p;
    return Object.assign(shown, {
      stats: {
        total: cards.length, open: open.length, openBugs: open.filter(c => c.type === 'bug' || c.type === 'security').length,
        urgent: open.filter(c => c.priority === 'P1').length, byStatus: count(STATUSES, 'status')
      }
    });
  }

  projects() { return this.data.projects.map(p => structuredClone(this.describe(p))); }
  project(key) { return structuredClone(this.describe(this.rawProject(key))); }

  projectFields(input) {
    const out = {};
    if (input.name !== undefined) { out.name = text(input.name, 'name', 60, true); }
    if (input.description !== undefined) { out.description = text(input.description, 'description', 500); }
    if (input.color !== undefined) { out.color = oneOf(input.color, COLORS, 'color'); }
    if (input.areas !== undefined) { out.areas = words(input.areas, 'areas', 40, 20); }
    if (input.repository !== undefined) {
      out.repository = text(input.repository, 'repository', 300);
      if (out.repository && !/^https?:\/\//i.test(out.repository)) { throw bad('repository must be an http or https address.'); }
    }
    if (input.archived !== undefined) {
      if (typeof input.archived !== 'boolean') { throw bad('archived must be true or false.'); }
      out.archived = input.archived;
    }
    return out;
  }

  addProject(input) {
    only(input, PROJECT_FIELDS);
    return this.commit(() => {
      const key = text(input.key || '', 'key', 6, true).toUpperCase();
      if (!/^[A-Z][A-Z0-9]{1,5}$/.test(key)) { throw bad('key must be 2 to 6 letters or digits, starting with a letter.'); }
      if (this.data.projects.some(p => p.key === key)) { throw clash('A project with the key ' + key + ' already exists.'); }
      const fields = this.projectFields(Object.assign({ name: '' }, input));
      const project = Object.assign({ key, name: '', description: '', color: COLORS[this.data.projects.length % COLORS.length],
        areas: DEFAULT_AREAS.slice(), repository: '', archived: false }, fields, { created: now(), nextNumber: 1 });
      this.data.projects.push(project);
      this.log(key, null, 'project.created', project.name);
      return this.describe(project);
    });
  }

  changeProject(key, input) {
    only(input, PROJECT_FIELDS.filter(f => f !== 'key'));
    return this.commit(() => {
      const p = this.rawProject(key);
      Object.assign(p, this.projectFields(input));
      this.log(p.key, null, 'project.changed', Object.keys(input).join(', '));
      return this.describe(p);
    });
  }

  removeProject(key, confirm) {
    return this.commit(() => {
      const p = this.rawProject(key);
      const count = this.data.cards.filter(c => c.project === p.key).length;
      if (count && confirm !== p.key) { throw clash('This project has ' + count + ' cards. Repeat with ?confirm=' + p.key + ' to delete it and them, or archive it instead.'); }
      this.data.cards = this.data.cards.filter(c => c.project !== p.key);
      this.data.projects.splice(this.data.projects.indexOf(p), 1);
      this.log(p.key, null, 'project.deleted', p.name);
      return { deleted: p.key, cards: count };
    });
  }

  /* ------------------------------------------------------------ cards */

  rawCard(id) {
    const c = this.data.cards.find(x => x.id === String(id).toUpperCase());
    if (!c) { throw missing('Card ' + id); }
    return c;
  }

  card(id) { return structuredClone(this.rawCard(id)); }

  column(project, status) {
    return this.data.cards.filter(c => c.project === project && c.status === status).sort((a, b) => a.rank - b.rank);
  }

  cards(query) {
    const q = String(query.q || '').toLowerCase();
    const match = (field, c) => !query[field] || String(query[field]).split(',').includes(c[field]);
    const list = this.data.cards.filter(c =>
      (!query.project || String(query.project).toUpperCase().split(',').includes(c.project)) &&
      ['status', 'type', 'priority', 'area'].every(f => match(f, c)) &&
      (!query.label || c.labels.includes(query.label)) &&
      (!query.ref || c.ref === query.ref) &&
      (!q || [c.id, c.title, c.description, c.commit, c.ref, c.labels.join(' ')].join('\n').toLowerCase().includes(q)));
    const order = ids(STATUSES);
    list.sort((a, b) => a.project.localeCompare(b.project) || order.indexOf(a.status) - order.indexOf(b.status) || a.rank - b.rank);
    return structuredClone(list);
  }

  cardFields(project, input) {
    const out = {};
    if (input.title !== undefined) { out.title = text(input.title, 'title', 200, true); }
    if (input.description !== undefined) { out.description = text(input.description, 'description', 10000); }
    if (input.type !== undefined) { out.type = oneOf(input.type, ids(TYPES), 'type'); }
    if (input.priority !== undefined) { out.priority = oneOf(input.priority, ids(PRIORITIES), 'priority'); }
    if (input.status !== undefined) { out.status = oneOf(input.status, ids(STATUSES), 'status'); }
    if (input.area !== undefined) {
      out.area = text(input.area, 'area', 40);
      if (out.area && !project.areas.includes(out.area)) { throw bad('area must be one of: ' + project.areas.join(', ') + '.'); }
    }
    if (input.labels !== undefined) { out.labels = words(input.labels, 'labels', 30, 12); }
    if (input.commit !== undefined) { out.commit = text(input.commit, 'commit', 60); }
    if (input.ref !== undefined) { out.ref = text(input.ref, 'ref', 100); }
    if (input.due !== undefined) {
      out.due = text(input.due, 'due', 10);
      if (out.due && (!/^\d{4}-\d{2}-\d{2}$/.test(out.due) || Number.isNaN(Date.parse(out.due)))) { throw bad('due must be a date like 2027-01-31.'); }
    }
    return out;
  }

  /** Puts a card at a place in its column (0 is the top; the end when no place is given) and renumbers the column. */
  place(card, position) {
    const others = this.column(card.project, card.status).filter(c => c !== card);
    let at = others.length;
    if (position !== undefined && position !== null) {
      if (!Number.isInteger(position) || position < 0) { throw bad('position must be a whole number from 0.'); }
      at = Math.min(position, others.length);
    }
    others.splice(at, 0, card);
    others.forEach((c, i) => { c.rank = i; });
  }

  /** Where a card lands when no place is named: below the last card that is at least as urgent. */
  byPriority(card) {
    const others = this.column(card.project, card.status).filter(c => c !== card);
    let at = 0;
    others.forEach((c, i) => { if (c.priority <= card.priority) { at = i + 1; } });
    return at;
  }

  createCard(projectKey, input) {
    const p = this.rawProject(projectKey);
    if (p.archived) { throw clash('This project is archived.'); }
    const fields = this.cardFields(p, Object.assign({ title: '' }, input));
    const card = Object.assign({ id: p.key + '-' + p.nextNumber++, project: p.key, title: '', description: '', type: 'task', priority: 'P3',
      status: 'todo', area: '', labels: [], commit: '', ref: '', due: '' }, fields,
    { rank: 0, version: 1, created: now(), updated: now(), comments: [], history: [] });
    card.history.push({ at: card.created, to: card.status });
    this.data.cards.push(card);
    this.place(card, this.byPriority(card));
    this.log(p.key, card.id, 'card.created', card.title);
    return card;
  }

  addCard(projectKey, input) {
    only(input, CARD_FIELDS);
    return this.commit(() => this.createCard(projectKey, input));
  }

  /** Several cards in one go: all are added or none. */
  addCards(projectKey, list) {
    if (!Array.isArray(list) || !list.length || list.length > 200) { throw bad('cards must be a list of 1 to 200 cards.'); }
    return this.commit(() => list.map(input => this.createCard(projectKey, only(input, CARD_FIELDS))));
  }

  update(card, input) {
    const fields = this.cardFields(this.rawProject(card.project), input);
    const moved = fields.status !== undefined && fields.status !== card.status;
    const repositioned = input.position !== undefined;
    const changed = Object.keys(fields).filter(k => JSON.stringify(fields[k]) !== JSON.stringify(card[k]));
    const note = input.note === undefined ? '' : text(input.note, 'note', 500);
    if (!changed.length && !repositioned && !note) { return card; }
    const from = card.status;
    Object.assign(card, fields);
    if (moved) {
      this.place(card, repositioned ? input.position : this.byPriority(card));
      this.column(card.project, from).forEach((c, i) => { c.rank = i; });
    } else if (repositioned) {
      this.place(card, input.position);
    }
    if (moved || note) { card.history.push(Object.assign({ at: now(), to: card.status }, moved ? { from } : {}, note ? { note } : {})); }
    card.version++;
    card.updated = now();
    if (moved) {
      this.log(card.project, card.id, 'card.moved', from + ' > ' + card.status);
    } else if (changed.length || note) {
      this.log(card.project, card.id, 'card.changed', changed.join(', ') || 'note');
    }
    return card;
  }

  changeCard(id, input) {
    only(input, CARD_FIELDS.concat(['note', 'position', 'version']));
    return this.commit(() => {
      const card = this.rawCard(id);
      if (input.version !== undefined && input.version !== card.version) { throw clash('The card changed meanwhile (it is now version ' + card.version + ').'); }
      return this.update(card, input);
    });
  }

  /** Moves many cards to one status: those listed in ids, or every card of a project that has the status "from". */
  moveMany(input) {
    only(input, ['ids', 'project', 'from', 'to', 'note', 'commit']);
    oneOf(input.to, ids(STATUSES), 'to');
    return this.commit(() => {
      let cards;
      if (input.ids !== undefined) {
        cards = words(input.ids, 'ids', 20, 500).map(id => this.rawCard(id));
      } else {
        const p = this.rawProject(input.project);
        cards = this.column(p.key, oneOf(input.from, ids(STATUSES), 'from'));
      }
      const change = { status: input.to };
      if (input.note !== undefined) { change.note = input.note; }
      if (input.commit !== undefined) { change.commit = input.commit; }
      return cards.map(c => this.update(c, change));
    });
  }

  removeCard(id) {
    return this.commit(() => {
      const card = this.rawCard(id);
      this.data.cards.splice(this.data.cards.indexOf(card), 1);
      this.column(card.project, card.status).forEach((c, i) => { c.rank = i; });
      this.log(card.project, card.id, 'card.deleted', card.title);
      return card;
    });
  }

  /** Brings back a card as removeCard returned it (undo). Its id was never given to another card. */
  restoreCard(input) {
    return this.commit(() => {
      if (!input || typeof input.id !== 'string') { throw bad('Send the card that was deleted.'); }
      const p = this.rawProject(input.project);
      const match = input.id.match(/^([A-Z][A-Z0-9]{1,5})-(\d+)$/);
      if (!match || match[1] !== p.key || Number(match[2]) >= p.nextNumber) { throw bad('This card did not come from this project.'); }
      if (this.data.cards.some(c => c.id === input.id)) { throw clash(input.id + ' already exists.'); }
      const fields = this.cardFields(p, Object.fromEntries(CARD_FIELDS.filter(f => input[f] !== undefined && !(f === 'area' && !p.areas.includes(input[f]))).map(f => [f, input[f]])));
      const entries = (list, shape) => (Array.isArray(list) ? list.slice(-500).map(shape) : []);
      const card = Object.assign({ id: input.id, project: p.key, title: input.id, description: '', type: 'task', priority: 'P3', status: 'todo', area: '', labels: [], commit: '', ref: '', due: '' }, fields, {
        rank: 0, version: (Number(input.version) || 1) + 1, created: String(input.created || now()), updated: now(),
        comments: entries(input.comments, c => ({ at: String(c.at), author: String(c.author || ''), text: String(c.text || '').slice(0, 4000) })),
        history: entries(input.history, h => ({ at: String(h.at), to: String(h.to), from: h.from === undefined ? undefined : String(h.from), note: h.note === undefined ? undefined : String(h.note) }))
      });
      this.data.cards.push(card);
      this.place(card, Number.isInteger(input.rank) && input.rank >= 0 ? input.rank : undefined);
      this.log(p.key, card.id, 'card.restored', card.title);
      return card;
    });
  }

  comment(id, input) {
    only(input, ['text', 'author']);
    return this.commit(() => {
      const card = this.rawCard(id);
      card.comments.push({ at: now(), author: text(input.author || '', 'author', 40), text: text(input.text || '', 'text', 4000, true) });
      card.version++;
      card.updated = now();
      this.log(card.project, card.id, 'card.commented', card.comments[card.comments.length - 1].text.slice(0, 120));
      return card;
    });
  }

  activity(query) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 500);
    const key = query.project ? String(query.project).toUpperCase() : '';
    return structuredClone(this.data.activity.filter(a => (!key || a.project === key) && (!query.card || a.card === String(query.card).toUpperCase())).slice(-limit).reverse());
  }

  export() { return structuredClone(this.data); }
}

module.exports = { Store, ApiError, CARD_FIELDS, PROJECT_FIELDS };
