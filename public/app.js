// The board's page. Everything it does goes through /api/v1. Text from the data is only ever set as text, never as HTML.
const API = '/api/v1';
const $ = (s, root = document) => root.querySelector(s);
const state = {
  meta: null, projects: [], cards: [], revision: 0, loaded: false,
  filters: { q: '', type: '', priority: '', area: '' },
  view: localStorage.getItem('view') || 'board',
  theme: localStorage.getItem('theme') || '',
  open: null, drag: null, focus: null
};
let token = sessionStorage.getItem('token') || '';

/* ------------------------------------------------------------------ small helpers */

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) { continue; }
    if (key.startsWith('on')) { el.addEventListener(key.slice(2), value); }
    else if (key === 'class') { el.className = value; }
    else if (key === 'value') { el.dataset.value = value; }
    else { el.setAttribute(key, value === true ? '' : value); }
  }
  el.append(...children.flat().filter(c => c !== null && c !== undefined && c !== false && c !== ''));
  // a select can take its value only once it has its options
  if (props && props.value !== undefined) { el.value = props.value; }
  return el;
}
const ICONS = {
  bug: 'M8 6V5a4 4 0 0 1 8 0v1M7 9h10v5a5 5 0 0 1-10 0zM12 9v10M3 13h4M17 13h4M4 7l3 3M20 7l-3 3M4 20l4-3M20 20l-4-3',
  security: 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.500-7-4.500-7-9V6zM9 12l2 2 4-4',
  feature: 'M12 3l2.600 5.600 6.100.700-4.500 4.200 1.200 6L12 16.500 6.600 19.500l1.200-6L3.300 9.300l6.100-.700z',
  improvement: 'M4 17l6-6 4 4 6-8M14 7h6v6',
  task: 'M5 4h14v16H5zM8 12l3 3 5-6',
  test: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M8 15h8',
  chore: 'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13',
  plus: 'M12 5v14M5 12h14', search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4', close: 'M6 6l12 12M18 6L6 18',
  menu: 'M4 7h16M4 12h16M4 17h16', board: 'M4 4h4v16H4zM10 4h4v11h-4zM16 4h4v7h-4z', list: 'M8 6h12M8 12h12M8 18h12M4 6h.010M4 12h.010M4 18h.010',
  moon: 'M20 14.500A8 8 0 0 1 9.500 4 8 8 0 1 0 20 14.500z', sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.500 1.500M17.500 17.500L19 19M5 19l1.500-1.500M17.500 6.500L19 5',
  more: 'M4.5 12h1.5M11.25 12h1.5M18 12h1.5', link: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6', comment: 'M4 5h16v11H9l-5 4z', clock: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4l3 2',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', trash: 'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 11v6M14 11v6', commit: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM3 12h6M15 12h6'
};
function icon(name, cls) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon ' + (cls || ''));
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', ICONS[name] || ICONS.task);
  svg.append(p);
  return svg;
}
const name = (list, id) => (state.meta[list].find(x => x.id === id) || { name: id }).name;
const date = iso => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
function ago(iso) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) { return 'just now'; }
  if (s < 3600) { return Math.floor(s / 60) + 'm ago'; }
  if (s < 86400) { return Math.floor(s / 3600) + 'h ago'; }
  return s < 30 * 86400 ? Math.floor(s / 86400) + 'd ago' : date(iso);
}
const overdue = c => c.due && !['deployed', 'wontfix'].includes(c.status) && c.due < new Date().toISOString().slice(0, 10);
const options = (list, all) => (all ? [h('option', { value: '' }, all)] : []).concat(list.map(x => h('option', { value: x.id }, x.label || x.name)));
const priorities = () => state.meta.PRIORITIES.map(p => ({ id: p.id, name: p.id + ' ' + p.name }));

/* ------------------------------------------------------------------ the API */

async function api(method, path, body) {
  const headers = {};
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; }
  if (token) { headers.Authorization = 'Bearer ' + token; }
  let res;
  try { res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch (e) { throw Object.assign(new Error('The board server is not answering.'), { offline: true }); }
  const out = await res.json();
  if (res.status === 401) {
    token = await askToken();
    sessionStorage.setItem('token', token);
    return api(method, path, body);
  }
  if (!res.ok) { throw Object.assign(new Error(out.error.message), { status: res.status }); }
  return out;
}
let asking = null;
function askToken() {
  if (!asking) {
    asking = new Promise(resolve => {
      const input = h('input', { type: 'password', required: true, autocomplete: 'off', 'aria-label': 'Token' });
      modal('This board needs a token', [h('label', { class: 'field' }, 'KANBAN_TOKEN', input)], 'Continue', () => { asking = null; resolve(input.value.trim()); });
    });
  }
  return asking;
}

/** Runs a change, shows what went wrong, and reloads either way so the page matches the data. */
async function act(work, done) {
  try {
    const result = await work();
    await load(true);
    if (done) { done(result); }
    return result;
  } catch (e) {
    toast(e.message, { error: true });
    await load(true).catch(() => { });
    return null;
  }
}

async function load(force) {
  const { revision } = await api('GET', '/revision');
  $('#offline').hidden = true;
  if (!force && state.loaded && revision === state.revision) { return; }
  const [projects, cards] = await Promise.all([api('GET', '/projects'), api('GET', '/cards')]);
  Object.assign(state, { projects, cards, revision, loaded: true });
  render();
}

/* ------------------------------------------------------------------ where we are (kept in the address) */

function where() {
  const [pathPart, query] = location.hash.replace(/^#\/?/, '').split('?');
  const [kind, key] = pathPart.split('/');
  return { project: kind === 'p' ? (key || '').toUpperCase() : '', activity: kind === 'activity', card: new URLSearchParams(query).get('card') };
}
function go(project, card) {
  const base = project === 'activity' ? '#/activity' : project ? '#/p/' + project : '#/';
  location.hash = base + (card ? '?card=' + card : '');
}
const current = () => state.projects.find(p => p.key === where().project) || null;
function openCard(id) { go(where().activity ? 'activity' : where().project, id); }
function closeCard() { go(where().activity ? 'activity' : where().project); }

function visible() {
  const f = state.filters, p = current(), q = f.q.toLowerCase();
  const live = new Set(state.projects.filter(x => !x.archived).map(x => x.key));
  return state.cards.filter(c => (p ? c.project === p.key : live.has(c.project)) &&
    ['type', 'priority', 'area'].every(k => !f[k] || c[k] === f[k]) &&
    (!q || [c.id, c.title, c.description, c.commit, c.ref, c.area, c.labels.join(' ')].join('\n').toLowerCase().includes(q)));
}

/* ------------------------------------------------------------------ drawing */

function render() {
  const at = where();
  const keep = document.activeElement && document.activeElement.id;
  const caret = keep === 'search' ? document.activeElement.selectionStart : null;
  renderSidebar(at);
  renderTop(at);
  renderMain(at);
  renderDrawer(at);
  if (keep && !$('#drawer').contains(document.activeElement)) {
    const el = document.getElementById(keep);
    if (el) { el.focus({ preventScroll: true }); if (caret !== null) { el.setSelectionRange(caret, caret); } }
  }
  const p = current();
  document.title = (at.activity ? 'Activity' : p ? p.name : 'All projects') + ' · Kanban';
}

function navLink(label, active, count, color, onclick) {
  return h('button', { type: 'button', class: 'nav' + (active ? ' active' : ''), 'aria-current': active ? 'page' : false, onclick: () => { document.body.classList.remove('menu'); $('#scrim').hidden = true; onclick(); } },
    color ? h('span', { class: 'dot c-' + color }) : icon(label === 'Activity' ? 'clock' : 'grid'),
    h('span', { class: 'label' }, label), count !== null && h('span', { class: 'count' }, String(count)));
}

function renderSidebar(at) {
  const live = state.projects.filter(p => !p.archived), old = state.projects.filter(p => p.archived);
  const open = live.reduce((n, p) => n + p.stats.open, 0);
  $('#sidebar').replaceChildren(
    h('div', { class: 'logo' }, h('img', { src: 'favicon.svg', alt: '' }), 'Kanban'),
    h('nav', {},
      navLink('All projects', !at.project && !at.activity, open, null, () => go('')),
      navLink('Activity', at.activity, null, null, () => go('activity')),
      h('div', { class: 'nav-title' }, 'Projects',
        h('button', { type: 'button', class: 'icon-button', title: 'New project', 'aria-label': 'New project', onclick: () => projectDialog() }, icon('plus'))),
      live.map(p => navLink(p.name, at.project === p.key, p.stats.open, p.color, () => go(p.key))),
      old.length ? h('div', { class: 'nav-title' }, 'Archived') : null,
      old.map(p => navLink(p.name, at.project === p.key, null, p.color, () => go(p.key)))),
    h('div', { class: 'side-foot' },
      h('a', { href: 'docs', target: '_blank', rel: 'noopener' }, icon('link'), 'API reference'),
      h('button', { type: 'button', onclick: toggleTheme }, icon(isDark() ? 'sun' : 'moon'), isDark() ? 'Light theme' : 'Dark theme')));
}

function renderTop(at) {
  const p = current(), cards = state.cards.filter(c => p ? c.project === p.key : state.projects.some(x => x.key === c.project && !x.archived));
  const open = cards.filter(c => !['deployed', 'wontfix'].includes(c.status));
  const counted = cards.filter(c => c.status !== 'wontfix');
  const done = counted.filter(c => c.status === 'deployed').length;
  const title = at.activity ? 'Activity' : p ? p.name : 'All projects';
  const menu = h('button', { type: 'button', class: 'icon-button menu-button', 'aria-label': 'Projects', onclick: () => { document.body.classList.add('menu'); $('#scrim').hidden = false; } }, icon('menu'));
  const head = h('div', { class: 'title-row' }, menu,
    p && h('span', { class: 'dot large c-' + p.color }),
    h('div', { class: 'title' }, h('h1', {}, title), p && p.description && h('p', {}, p.description)),
    p && p.repository && h('a', { class: 'icon-button repo', href: p.repository, target: '_blank', rel: 'noopener noreferrer', title: 'Repository', 'aria-label': 'Repository' }, icon('link')),
    p && h('button', { type: 'button', class: 'icon-button', title: 'Project settings', 'aria-label': 'Project settings', onclick: () => projectDialog(p) }, icon('more')),
    h('span', { class: 'grow' }),
    h('button', { type: 'button', class: 'search-button', onclick: palette, title: 'Search everything (Ctrl+K)' }, icon('search'), h('span', {}, 'Jump to…'), h('kbd', {}, 'Ctrl K')),
    state.projects.some(x => !x.archived) && !(p && p.archived) && h('button', { type: 'button', class: 'primary', id: 'new-card', onclick: () => cardDialog(), title: 'New card (N)' }, icon('plus'), h('span', {}, 'New card')));
  const parts = [head];
  if (!at.activity && state.projects.length) {
    const stat = (value, label, cls, onclick) => h(onclick ? 'button' : 'div', { type: onclick ? 'button' : false, class: 'stat ' + cls, onclick }, h('strong', {}, String(value)), h('span', {}, label));
    parts.push(h('div', { class: 'stats' },
      stat(open.length, 'open', ''),
      stat(open.filter(c => c.priority === 'P1').length, 'critical', open.some(c => c.priority === 'P1') ? 'bad' : '', () => setFilter('priority', state.filters.priority === 'P1' ? '' : 'P1')),
      stat(open.filter(c => c.type === 'bug').length, 'bugs', '', () => setFilter('type', state.filters.type === 'bug' ? '' : 'bug')),
      stat(open.filter(c => c.type === 'security').length, 'security', '', () => setFilter('type', state.filters.type === 'security' ? '' : 'security')),
      h('div', { class: 'progress', title: done + ' of ' + counted.length + ' deployed' },
        h('span', {}, (counted.length ? Math.round(done / counted.length * 100) : 0) + '% deployed'),
        h('progress', { max: String(counted.length || 1), value: String(done) }))));
    const areas = [...new Set(p ? p.areas : state.projects.flatMap(x => x.areas))].map(a => ({ id: a, name: a }));
    const select = (key, label, list) => h('select', { id: 'filter-' + key, 'aria-label': label, class: state.filters[key] ? 'set' : '', value: state.filters[key], onchange: e => setFilter(key, e.target.value) }, options(list, label));
    parts.push(h('div', { class: 'filters' },
      h('label', { class: 'search' }, icon('search'),
        h('input', { id: 'search', type: 'search', placeholder: 'Filter cards  ( / )', 'aria-label': 'Filter cards', value: state.filters.q, oninput: e => { state.filters.q = e.target.value; render(); } })),
      select('type', 'All types', state.meta.TYPES),
      select('priority', 'All priorities', priorities()),
      select('area', 'All areas', areas),
      Object.values(state.filters).some(Boolean) && h('button', { type: 'button', class: 'link', onclick: () => { state.filters = { q: '', type: '', priority: '', area: '' }; render(); } }, 'Clear filters'),
      h('span', { class: 'grow' }),
      h('div', { class: 'segmented', role: 'group', 'aria-label': 'View' }, ['board', 'list'].map(v =>
        h('button', { type: 'button', id: 'view-' + v, 'aria-pressed': String(state.view === v), onclick: () => { state.view = v; localStorage.setItem('view', v); render(); } }, icon(v), v === 'board' ? 'Board' : 'List')))));
  }
  $('#top').replaceChildren(...parts);
}
function setFilter(key, value) { state.filters[key] = value; render(); }

function renderMain(at) {
  const main = $('#main');
  if (at.activity) { renderActivity(main); return; }
  if (!state.projects.length) {
    main.replaceChildren(empty('Register your first project', 'A project holds its own cards, areas and counts.', 'New project', () => projectDialog()));
    return;
  }
  if (at.project && !current()) { main.replaceChildren(empty('Project not found', 'It may have been deleted.', 'Show all projects', () => go(''))); return; }
  if (state.view === 'list') { main.replaceChildren(listView(visible())); return; }
  renderBoard(main, visible());
}
function empty(title, text, action, onclick) {
  return h('div', { class: 'empty' }, icon('board', 'big'), h('h2', {}, title), h('p', {}, text), action && h('button', { type: 'button', class: 'primary', onclick }, action));
}

function renderBoard(main, cards) {
  const old = $('.board', main);
  const scroll = { x: old ? old.scrollLeft : 0 };
  if (old) { old.querySelectorAll('.column').forEach(c => { scroll[c.dataset.status] = $('.cards', c).scrollTop; }); }
  const p = current();
  const filtered = Object.values(state.filters).some(Boolean);
  // redrawing must not drop the keyboard's place
  const focused = state.focus || (main.contains(document.activeElement) && document.activeElement.dataset.id);
  const board = h('div', { class: 'board' });
  for (const status of state.meta.STATUSES) {
    // all projects together: most urgent first; one project: the order the user gave the column
    const mine = cards.filter(c => c.status === status.id).sort((a, b) => p ? a.rank - b.rank : a.priority.localeCompare(b.priority) || b.updated.localeCompare(a.updated));
    const collapsed = !mine.length && ['blocked', 'wontfix'].includes(status.id) && localStorage.getItem('open-' + status.id) !== '1';
    const list = h('div', { class: 'cards' }, mine.map(c => cardTile(c, !p)));
    if (!mine.length) { list.append(h('div', { class: 'hint' }, filtered ? 'Nothing matches' : 'Drop a card here')); }
    const column = h('section', { class: 'column s-' + status.id + (collapsed ? ' collapsed' : ''), 'data-status': status.id, 'aria-label': status.name },
      h('h2', { title: status.hint, onclick: collapsed ? () => { localStorage.setItem('open-' + status.id, '1'); renderMain(where()); } : undefined },
        h('span', { class: 'status-dot' }), h('span', { class: 'name' }, status.name), h('span', { class: 'count' }, String(mine.length)),
        p && !p.archived && h('button', { type: 'button', class: 'icon-button', title: 'Add to ' + status.name, 'aria-label': 'Add to ' + status.name, onclick: () => quickAdd(column, status.id) }, icon('plus'))),
      list);
    dropZone(column, list, status.id);
    board.append(column);
  }
  main.replaceChildren(board);
  board.scrollLeft = scroll.x;
  board.querySelectorAll('.column').forEach(c => { $('.cards', c).scrollTop = scroll[c.dataset.status] || 0; });
  state.focus = null;
  const tile = focused && board.querySelector('[data-id="' + focused + '"]');
  if (tile) { tile.focus(); }
}

function cardTile(c, showProject) {
  const project = state.projects.find(p => p.key === c.project);
  return h('article', {
    class: 'card ' + c.priority + (where().card === c.id ? ' selected' : ''), tabindex: '0', draggable: 'true', 'data-id': c.id,
    'aria-label': c.id + ', ' + name('PRIORITIES', c.priority) + ' priority ' + name('TYPES', c.type) + ': ' + c.title,
    onclick: () => openCard(c.id),
    onkeydown: e => cardKeys(e, c),
    ondragstart: e => { state.drag = c.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.id); requestAnimationFrame(() => e.target.classList.add('dragging')); },
    ondragend: e => { state.drag = null; e.target.classList.remove('dragging'); document.querySelectorAll('.marker').forEach(m => m.remove()); document.querySelectorAll('.column.over').forEach(x => x.classList.remove('over')); load(false).catch(() => { }); }
  },
  h('div', { class: 'card-top' },
    h('span', { class: 'kind t-' + c.type, title: name('TYPES', c.type) }, icon(c.type)),
    h('span', { class: 'id' }, c.id),
    h('span', { class: 'grow' }),
    h('span', { class: 'priority ' + c.priority, title: name('PRIORITIES', c.priority) + ' priority' }, c.priority)),
  h('h3', {}, c.title),
  h('div', { class: 'chips' },
    showProject && h('span', { class: 'chip project' }, h('span', { class: 'dot c-' + project.color }), project.name),
    c.area && h('span', { class: 'chip' }, c.area),
    c.labels.map(l => h('span', { class: 'chip label' }, l)),
    c.due && h('span', { class: 'chip' + (overdue(c) ? ' late' : '') }, icon('clock'), date(c.due)),
    c.commit && h('span', { class: 'chip mono' }, icon('commit'), c.commit),
    c.comments.length > 0 && h('span', { class: 'chip' }, icon('comment'), String(c.comments.length))));
}

/** Keyboard: Enter opens; [ and ] move to the previous or next column; arrows walk between cards. */
function cardKeys(e, c) {
  const order = state.meta.STATUSES.map(s => s.id);
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCard(c.id); return; }
  if (e.key === '[' || e.key === ']') {
    const next = order[order.indexOf(c.status) + (e.key === ']' ? 1 : -1)];
    if (next) { e.preventDefault(); state.focus = c.id; move(c, next); }
    return;
  }
  const tile = e.currentTarget;
  let to = null;
  if (e.key === 'ArrowDown') { to = tile.nextElementSibling; }
  if (e.key === 'ArrowUp') { to = tile.previousElementSibling; }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    let column = tile.closest('.column');
    do { column = e.key === 'ArrowLeft' ? column.previousElementSibling : column.nextElementSibling; } while (column && !$('.card', column));
    if (column) { const list = [...column.querySelectorAll('.card')]; to = list[Math.min([...tile.parentElement.children].indexOf(tile), list.length - 1)]; }
  }
  if (to && to.classList.contains('card')) { e.preventDefault(); to.focus(); }
}

function dropZone(column, list, status) {
  const marker = () => $('.marker', list) || h('div', { class: 'marker' });
  column.addEventListener('dragover', e => {
    if (!state.drag) { return; }
    e.preventDefault();
    column.classList.add('over');
    // a precise place only counts when every card of one project's column is on screen
    if (!current() || Object.values(state.filters).some(Boolean)) { return; }
    const after = [...list.querySelectorAll('.card:not(.dragging)')].find(t => { const r = t.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    const m = marker();
    if (after) { list.insertBefore(m, after); } else { list.append(m); }
  });
  column.addEventListener('dragleave', e => {
    if (column.contains(e.relatedTarget)) { return; }
    column.classList.remove('over');
    const m = $('.marker', list);
    if (m) { m.remove(); }
  });
  column.addEventListener('drop', e => {
    e.preventDefault();
    const card = state.cards.find(c => c.id === (state.drag || e.dataTransfer.getData('text/plain')));
    const m = $('.marker', list);
    let position;
    if (m) {
      position = 0;
      for (let el = m.previousElementSibling; el; el = el.previousElementSibling) { if (el.classList.contains('card') && el.dataset.id !== (card && card.id)) { position++; } }
    }
    state.drag = null;
    column.classList.remove('over');
    if (card && (card.status !== status || position !== undefined)) { move(card, status, position); }
  });
}

function move(card, status, position) {
  const from = card.status, rank = card.rank;
  // show it in its new place at once; the reload that follows confirms it
  const local = state.cards.find(c => c.id === card.id);
  local.status = status;
  local.rank = position === undefined ? 1e9 : position - 0.5;
  renderMain(where());
  const body = { status };
  if (position !== undefined) { body.position = position; }
  return act(() => api('PATCH', '/cards/' + card.id, body), () => {
    if (from !== status) {
      toast(card.id + ' moved to ' + name('STATUSES', status), { action: 'Undo', run: () => act(() => api('PATCH', '/cards/' + card.id, { status: from, position: rank })) });
    }
  });
}

function quickAdd(column, status) {
  const p = current();
  if (column.classList.contains('collapsed')) { localStorage.setItem('open-' + status, '1'); column.classList.remove('collapsed'); }
  const list = $('.cards', column);
  const old = $('.quick', list);
  if (old) { $('textarea', old).focus(); return; }
  const input = h('textarea', { rows: '2', placeholder: 'Title, then Enter', 'aria-label': 'New card title', maxlength: '200' });
  const type = h('select', { 'aria-label': 'Type', value: localStorage.getItem('quick-type') || 'bug' }, options(state.meta.TYPES));
  const priority = h('select', { 'aria-label': 'Priority', value: 'P3' }, options(priorities()));
  const form = h('form', { class: 'quick' }, input, h('div', {}, type, priority, h('button', { class: 'primary' }, 'Add')));
  const submit = async () => {
    const title = input.value.replace(/\s+/g, ' ').trim();
    if (!title) { return; }
    localStorage.setItem('quick-type', type.value);
    form.remove();
    const made = await act(() => api('POST', '/projects/' + p.key + '/cards', { title, status, type: type.value, priority: priority.value }));
    if (made) {
      const again = $('.column[data-status="' + status + '"]');
      if (again) { quickAdd(again, status); }
    }
  };
  form.addEventListener('submit', e => { e.preventDefault(); submit(); });
  form.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.stopPropagation(); form.remove(); }
    if (e.key === 'Enter' && e.target === input && !e.shiftKey) { e.preventDefault(); submit(); }
  });
  list.prepend(form);
  input.focus();
}

let sort = { key: 'priority', down: false };
function listView(cards) {
  if (!cards.length) { return empty('No cards here', Object.values(state.filters).some(Boolean) ? 'Nothing matches the filters.' : 'Add the first card.', null); }
  const order = state.meta.STATUSES.map(s => s.id);
  const value = (c, k) => k === 'status' ? order.indexOf(c.status) : k === 'id' ? c.project + String(c.id.split('-')[1]).padStart(6, '0') : c[k];
  cards.sort((a, b) => (String(value(a, sort.key)).localeCompare(String(value(b, sort.key)), undefined, { numeric: true }) || a.priority.localeCompare(b.priority)) * (sort.down ? -1 : 1));
  const columns = [['id', 'Key'], ['title', 'Title'], ['type', 'Type'], ['priority', 'Priority'], ['status', 'Status'], ['area', 'Area'], ['updated', 'Updated']];
  return h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, columns.map(([key, label]) => h('th', { 'aria-sort': sort.key === key ? (sort.down ? 'descending' : 'ascending') : false },
      h('button', { type: 'button', onclick: () => { sort = { key, down: sort.key === key ? !sort.down : key === 'updated' }; renderMain(where()); } }, label + (sort.key === key ? (sort.down ? ' ↓' : ' ↑') : '')))))),
    h('tbody', {}, cards.map(c => h('tr', { onclick: e => { if (!e.target.closest('select')) { openCard(c.id); } } },
      h('td', { class: 'mono' }, c.id),
      h('td', { class: 'wide' }, h('button', { type: 'button', class: 'link' }, c.title)),
      h('td', {}, h('span', { class: 'kind t-' + c.type }, icon(c.type)), ' ' + name('TYPES', c.type)),
      h('td', {}, h('span', { class: 'priority ' + c.priority }, c.priority)),
      h('td', {}, h('select', { class: 's-' + c.status, 'aria-label': 'Status of ' + c.id, value: c.status, onchange: e => move(c, e.target.value) }, options(state.meta.STATUSES))),
      h('td', {}, c.area),
      h('td', { class: 'quiet' }, ago(c.updated)))))));
}

async function renderActivity(main) {
  const revision = state.revision;
  if (main.dataset.activity === String(revision) && $('.activity', main)) { return; }
  main.dataset.activity = String(revision);
  const list = await api('GET', '/activity?limit=150');
  if (!where().activity) { return; }
  const verbs = { 'card.created': 'added', 'card.moved': 'moved', 'card.changed': 'changed', 'card.deleted': 'deleted', 'card.restored': 'restored', 'card.commented': 'commented on', 'project.created': 'registered', 'project.changed': 'changed', 'project.deleted': 'deleted' };
  const detail = a => a.action === 'card.moved' ? a.detail.split(' > ').map(s => name('STATUSES', s)).join(' → ') : a.detail;
  main.replaceChildren(list.length ? h('ol', { class: 'activity' }, list.map(a => h('li', {},
    h('time', { datetime: a.at, title: new Date(a.at).toLocaleString() }, ago(a.at)),
    h('span', {}, verbs[a.action] || a.action, ' ',
      a.card && state.cards.some(c => c.id === a.card) ? h('button', { type: 'button', class: 'link mono', onclick: () => openCard(a.card) }, a.card) : h('strong', {}, a.card || 'project ' + a.project),
      h('em', {}, detail(a)))))) : empty('Nothing has happened yet', 'Changes appear here.', null));
}

/* ------------------------------------------------------------------ card drawer */

function renderDrawer(at) {
  const drawer = $('#drawer');
  const c = at.card && state.cards.find(x => x.id === at.card.toUpperCase());
  if (!c) {
    if (!drawer.hidden) { drawer.hidden = true; drawer.replaceChildren(); state.open = null; document.body.classList.remove('drawer-open'); }
    if (at.card && state.loaded) { toast(at.card + ' no longer exists.', { error: true }); closeCard(); }
    return;
  }
  const same = state.open && state.open.id === c.id;
  // never rewrite a field someone is typing in
  if (same && (state.open.version === c.version || (drawer.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)))) { return; }
  const draft = same && $('#comment', drawer) ? $('#comment', drawer).value : '';
  const scroll = same ? $('.drawer-body', drawer).scrollTop : 0;
  state.open = { id: c.id, version: c.version };
  const p = state.projects.find(x => x.key === c.project);
  const save = body => act(() => api('PATCH', '/cards/' + c.id, body));
  const text = (field, el) => {
    el.addEventListener('change', () => { if (field === 'title' && !el.value.trim()) { el.value = c.title; return; } save({ [field]: field === 'labels' ? el.value.split(',').map(s => s.trim()).filter(Boolean) : el.value }); });
    return el;
  };
  const prop = (label, control) => h('label', { class: 'prop' }, h('span', {}, label), control);
  const choose = (field, list) => h('select', { value: c[field], onchange: e => save({ [field]: e.target.value }) }, options(list));
  const comment = h('textarea', { id: 'comment', rows: '2', placeholder: 'Add a comment  (Ctrl+Enter to send)', 'aria-label': 'Comment', maxlength: '4000' });
  comment.value = draft;
  const sendComment = () => { const value = comment.value.trim(); if (value) { comment.value = ''; comment.blur(); act(() => api('POST', '/cards/' + c.id + '/comments', { text: value, author: 'me' })); } };
  comment.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendComment(); } });
  const title = text('title', h('textarea', { class: 'drawer-title', rows: '2', 'aria-label': 'Title', maxlength: '200' }));
  title.value = c.title;
  title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
  const description = text('description', h('textarea', { class: 'description', placeholder: 'Describe the problem, how to reproduce it, links…', 'aria-label': 'Description', maxlength: '10000' }));
  description.value = c.description;
  const timeline = c.history.map(x => ({ at: x.at, history: x })).concat(c.comments.map(x => ({ at: x.at, comment: x }))).sort((a, b) => a.at.localeCompare(b.at));
  drawer.replaceChildren(
    h('div', { class: 'drawer-head' },
      h('span', { class: 'dot c-' + p.color }), h('span', { class: 'quiet' }, p.name), h('span', { class: 'mono' }, c.id), h('span', { class: 'grow' }),
      h('button', { type: 'button', class: 'icon-button', title: 'Copy link', 'aria-label': 'Copy link', onclick: () => navigator.clipboard.writeText(location.href).then(() => toast('Link copied'), () => toast('Copy the address from the browser bar.', { error: true })) }, icon('link')),
      h('button', { type: 'button', class: 'icon-button danger', title: 'Delete card', 'aria-label': 'Delete card', onclick: () => removeCard(c) }, icon('trash')),
      h('button', { type: 'button', class: 'icon-button', title: 'Close (Esc)', 'aria-label': 'Close', onclick: closeCard }, icon('close'))),
    h('div', { class: 'drawer-body' },
      title,
      h('div', { class: 'pipeline', role: 'group', 'aria-label': 'Status' }, state.meta.STATUSES.map(s =>
        h('button', { type: 'button', class: 's-' + s.id, title: s.hint, 'aria-pressed': String(c.status === s.id), onclick: () => { if (c.status !== s.id) { move(c, s.id); } } }, s.name))),
      h('div', { class: 'props' },
        prop('Type', choose('type', state.meta.TYPES)),
        prop('Priority', choose('priority', priorities())),
        prop('Area', h('select', { value: c.area, onchange: e => save({ area: e.target.value }) }, options([...new Set(p.areas.concat(c.area ? [c.area] : []))].map(a => ({ id: a, name: a })), 'None'))),
        prop('Due', text('due', h('input', { type: 'date', value: c.due }))),
        prop('Labels', text('labels', h('input', { value: c.labels.join(', '), placeholder: 'comma separated' }))),
        prop('Commit', text('commit', h('input', { value: c.commit, class: 'mono', maxlength: '60' }))),
        prop('Reference', text('ref', h('input', { value: c.ref, maxlength: '100' })))),
      h('h4', {}, 'Description'), description,
      h('h4', {}, 'Activity'),
      h('ol', { class: 'timeline' }, timeline.map(t => t.comment
        ? h('li', { class: 'said' }, h('div', {}, h('strong', {}, t.comment.author || 'Comment'), h('time', { title: new Date(t.at).toLocaleString() }, ago(t.at))), h('p', {}, t.comment.text))
        : h('li', {}, h('span', {}, t.history.from ? name('STATUSES', t.history.from) + ' → ' + name('STATUSES', t.history.to) : (t.history.note ? 'Note' : 'Created in ' + name('STATUSES', t.history.to))), t.history.note && h('em', {}, t.history.note), h('time', { title: new Date(t.at).toLocaleString() }, ago(t.at))))),
      h('div', { class: 'composer' }, comment, h('button', { type: 'button', onclick: sendComment }, 'Comment')),
      h('p', { class: 'quiet small' }, 'Created ' + date(c.created) + ' · updated ' + ago(c.updated))));
  drawer.hidden = false;
  document.body.classList.add('drawer-open');
  $('.drawer-body', drawer).scrollTop = scroll;
  if (!same) { drawer.setAttribute('tabindex', '-1'); drawer.focus(); }
}

function removeCard(c) {
  const origin = c.id;
  closeCard();
  act(() => api('DELETE', '/cards/' + origin), gone => toast(origin + ' deleted', { action: 'Undo', run: () => act(() => api('POST', '/cards/restore', { card: gone }), () => openCard(origin)) }));
}

/* ------------------------------------------------------------------ dialogs, palette, toasts */

function modal(title, fields, submit, onsubmit, extra) {
  const dialog = $('#modal');
  const error = h('p', { class: 'form-error', role: 'alert' });
  const form = h('form', {},
    h('div', { class: 'modal-head' }, h('h2', {}, title), h('button', { type: 'button', class: 'icon-button', 'aria-label': 'Close', onclick: () => dialog.close() }, icon('close'))),
    fields, error,
    h('div', { class: 'modal-foot' }, extra, h('span', { class: 'grow' }), h('button', { type: 'button', onclick: () => dialog.close() }, 'Cancel'), h('button', { class: 'primary' }, submit)));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    try { await onsubmit(); dialog.close(); } catch (err) { error.textContent = err.message; }
  });
  dialog.replaceChildren(form);
  if (!dialog.open) { dialog.showModal(); }
  const first = form.querySelector('input, textarea, select');
  if (first) { first.focus(); }
}
const field = (label, control, hint) => h('label', { class: 'field' }, label, control, hint && h('small', {}, hint));

function cardDialog() {
  const live = state.projects.filter(p => !p.archived);
  const project = h('select', { value: (current() || live[0]).key }, live.map(p => h('option', { value: p.key }, p.name)));
  const area = h('select', {});
  const areas = () => area.replaceChildren(...options(live.find(p => p.key === project.value).areas.map(a => ({ id: a, name: a })), 'None'));
  project.addEventListener('change', areas);
  areas();
  const title = h('input', { required: true, maxlength: '200', placeholder: 'What needs doing, or what is broken?' });
  const description = h('textarea', { rows: '5', maxlength: '10000' });
  const type = h('select', { value: 'bug' }, options(state.meta.TYPES));
  const priority = h('select', { value: 'P3' }, options(priorities()));
  const status = h('select', { value: 'todo' }, options(state.meta.STATUSES));
  modal('New card', [field('Title', title), h('div', { class: 'grid' }, field('Project', project), field('Type', type), field('Priority', priority), field('Area', area), field('Status', status)), field('Description', description)], 'Create card', async () => {
    const made = await api('POST', '/projects/' + project.value + '/cards', { title: title.value, description: description.value, type: type.value, priority: priority.value, status: status.value, area: area.value });
    await load(true);
    toast(made.id + ' created', { action: 'Open', run: () => openCard(made.id) });
  });
  title.focus();
}

function projectDialog(p) {
  const named = h('input', { required: true, maxlength: '60', value: p ? p.name : '' });
  const key = h('input', { required: true, maxlength: '6', pattern: '[A-Za-z][A-Za-z0-9]{1,5}', value: p ? p.key : '', disabled: !!p, class: 'mono upper' });
  let touched = !!p;
  key.addEventListener('input', () => { touched = true; });
  named.addEventListener('input', () => {
    if (!touched) { const words = named.value.trim().split(/\s+/); key.value = (words.length > 1 ? words.map(w => w[0]).join('') : words[0]).replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase(); }
  });
  const description = h('input', { maxlength: '500', value: p ? p.description : '' });
  const repository = h('input', { type: 'url', maxlength: '300', value: p ? p.repository : '', placeholder: 'https://…' });
  const areas = h('input', { value: (p ? p.areas : ['UI', 'API', 'Data', 'Operations']).join(', ') });
  let color = p ? p.color : state.meta.COLORS[state.projects.length % state.meta.COLORS.length];
  const colors = h('div', { class: 'colors', role: 'radiogroup', 'aria-label': 'Colour' }, state.meta.COLORS.map(c => h('button', { type: 'button', role: 'radio', class: 'c-' + c, 'aria-label': c, 'aria-checked': String(c === color),
    onclick: e => { color = c; [...e.target.parentElement.children].forEach(b => b.setAttribute('aria-checked', String(b === e.target))); } })));
  const extra = p && [
    h('button', { type: 'button', onclick: () => { $('#modal').close(); act(() => api('PATCH', '/projects/' + p.key, { archived: !p.archived }), () => toast(p.name + (p.archived ? ' restored' : ' archived'))); } }, p.archived ? 'Unarchive' : 'Archive'),
    h('button', { type: 'button', class: 'danger', onclick: () => deleteDialog(p) }, 'Delete…')];
  modal(p ? 'Project settings' : 'New project', [field('Name', named), field('Key', key, p ? 'The key is part of every card id and cannot change.' : 'Starts every card id, for example MWEB-1.'), field('Description', description),
    h('div', { class: 'field' }, 'Colour', colors), field('Areas', areas, 'Comma separated parts of the project, used to classify cards.'), field('Repository', repository)], p ? 'Save' : 'Create project', async () => {
    const body = { name: named.value, description: description.value, repository: repository.value, color, areas: areas.value.split(',').map(s => s.trim()).filter(Boolean) };
    if (p) { await api('PATCH', '/projects/' + p.key, body); await load(true); toast('Project saved'); }
    else { const made = await api('POST', '/projects', Object.assign({ key: key.value }, body)); await load(true); go(made.key); }
  }, extra);
}

function deleteDialog(p) {
  const confirm = h('input', { required: true, class: 'mono upper', autocomplete: 'off' });
  modal('Delete ' + p.name + '?', [h('p', {}, 'This removes the project and its ' + p.stats.total + ' cards for good. Archive it instead to keep them.'), field('Type ' + p.key + ' to confirm', confirm)], 'Delete project', async () => {
    if (confirm.value.trim().toUpperCase() !== p.key) { throw new Error('The key does not match.'); }
    await api('DELETE', '/projects/' + p.key + '?confirm=' + p.key);
    go('');
    await load(true);
    toast(p.name + ' deleted');
  });
}

function palette() {
  const dialog = $('#palette');
  if (dialog.open) { return; }
  const input = h('input', { type: 'search', placeholder: 'Find a card or project, or run a command…', 'aria-label': 'Search', autocomplete: 'off' });
  const list = h('ul', { role: 'listbox' });
  let items = [], chosen = 0;
  const run = i => { dialog.close(); items[i].run(); };
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const commands = [{ icon: 'plus', text: 'New card', run: cardDialog }, { icon: 'plus', text: 'New project', run: () => projectDialog() }, { icon: isDark() ? 'sun' : 'moon', text: 'Switch theme', run: toggleTheme }, { icon: 'grid', text: 'All projects', run: () => go('') }, { icon: 'clock', text: 'Activity', run: () => go('activity') }]
      .filter(c => state.projects.length || c.text !== 'New card');
    const projects = state.projects.map(p => ({ icon: 'board', text: p.name, note: 'Project ' + p.key, run: () => go(p.key) }));
    const cards = q ? state.cards.map(c => ({ icon: c.type, text: c.title, note: c.id + ' · ' + name('STATUSES', c.status), key: (c.id + ' ' + c.title + ' ' + c.commit).toLowerCase(), run: () => { go(c.project, c.id); } })) : [];
    const words = q.split(/\s+/);
    items = commands.concat(projects, cards).filter(i => words.every(w => (i.key || (i.text + ' ' + (i.note || '')).toLowerCase()).includes(w))).slice(0, 30);
    chosen = Math.min(chosen, Math.max(items.length - 1, 0));
    list.replaceChildren(...(items.length ? items.map((item, i) => h('li', { role: 'option', 'aria-selected': String(i === chosen), onclick: () => run(i), onmousemove: () => { if (chosen !== i) { chosen = i; draw(); } } },
      icon(item.icon), h('span', {}, item.text), item.note && h('small', {}, item.note))) : [h('li', { class: 'none' }, 'Nothing found')]));
    const on = list.querySelector('[aria-selected="true"]');
    if (on) { on.scrollIntoView({ block: 'nearest' }); }
  };
  input.addEventListener('input', () => { chosen = 0; draw(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); chosen = (chosen + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % (items.length || 1); draw(); }
    if (e.key === 'Enter' && items.length) { e.preventDefault(); run(chosen); }
    if (e.key === 'Escape') { e.preventDefault(); dialog.close(); }
  });
  dialog.replaceChildren(input, list);
  dialog.showModal();
  draw();
  input.focus();
}

function toast(message, opts = {}) {
  const box = $('#toasts');
  const item = h('div', { class: 'toast' + (opts.error ? ' error' : '') }, h('span', {}, message),
    opts.action && h('button', { type: 'button', onclick: () => { item.remove(); opts.run(); } }, opts.action),
    h('button', { type: 'button', class: 'icon-button', 'aria-label': 'Dismiss', onclick: () => item.remove() }, icon('close')));
  box.append(item);
  while (box.children.length > 4) { box.firstChild.remove(); }
  let timer = setTimeout(() => item.remove(), opts.action || opts.error ? 8000 : 3500);
  item.addEventListener('mouseenter', () => clearTimeout(timer));
  item.addEventListener('mouseleave', () => { timer = setTimeout(() => item.remove(), 3000); });
}

/* ------------------------------------------------------------------ theme, keys, start */

const isDark = () => state.theme ? state.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
function applyTheme() { if (state.theme) { document.documentElement.dataset.theme = state.theme; } }
function toggleTheme() {
  state.theme = isDark() ? 'light' : 'dark';
  localStorage.setItem('theme', state.theme);
  applyTheme();
  render();
}

function keys(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (!$('#modal').open) { palette(); } return; }
  if ($('dialog[open]')) { return; }
  if (e.key === 'Escape') {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) { document.activeElement.blur(); return; }
    if (!$('#drawer').hidden) { const id = state.open && state.open.id; closeCard(); state.focus = id; }
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) { return; }
  if (e.key === '/') { const s = $('#search'); if (s) { e.preventDefault(); s.focus(); } }
  if (e.key.toLowerCase() === 'n' && state.projects.some(p => !p.archived)) { e.preventDefault(); cardDialog(); }
}

async function start() {
  applyTheme();
  document.addEventListener('keydown', keys);
  $('#scrim').addEventListener('click', () => { document.body.classList.remove('menu'); $('#scrim').hidden = true; });
  window.addEventListener('hashchange', () => { if (state.loaded) { delete $('#main').dataset.activity; render(); } });
  $('#palette').addEventListener('click', e => { if (e.target === e.currentTarget) { e.currentTarget.close(); } });
  const lost = e => { const bar = $('#offline'); bar.textContent = e.message + ' Retrying…'; bar.hidden = false; };
  const tick = async () => {
    if (!document.hidden && !state.drag && !$('.quick')) { await load(false).catch(lost); }
    setTimeout(tick, 3000);
  };
  try {
    state.meta = await api('GET', '/meta');
    await load(true);
  } catch (e) {
    lost(e);
    setTimeout(() => location.reload(), 4000);
    return;
  }
  setTimeout(tick, 3000);
}

/* ------------------------------------------------------------------ the API reference page */

// The routes, parameters and bodies come from /openapi.json. What it does not say is written here; keep it in step with src/store.js.
const GROUPS = { meta: 'Vocabulary', revision: 'Sync', projects: 'Projects', cards: 'Cards', activity: 'Activity', export: 'Backup' };
const RETURNS = {
  'GET /meta': 'An object with STATUSES, TYPES, PRIORITIES, COLORS and DEFAULT_AREAS.',
  'GET /revision': '{"revision": number}',
  'GET /projects': 'A list of projects.',
  'POST /projects': 'The new project. 409 if the key is taken.',
  'GET /projects/{key}': 'The project.',
  'PATCH /projects/{key}': 'The changed project.',
  'DELETE /projects/{key}': '{"deleted": key, "cards": number}. 409 if it has cards and confirm does not match.',
  'GET /projects/{key}/cards': 'A list of cards, ordered by status, then by place in the column.',
  'POST /projects/{key}/cards': 'The new card. Defaults: type task, priority P3, status todo. 409 if the project is archived.',
  'POST /projects/{key}/cards/batch': 'A list of the new cards. 409 if the project is archived.',
  'GET /cards': 'A list of cards, ordered by project, status, then place in the column.',
  'POST /cards/move': 'A list of the selected cards. All move, or none do.',
  'POST /cards/restore': 'The restored card. 409 if its id already exists.',
  'GET /cards/{id}': 'The card.',
  'PATCH /cards/{id}': 'The changed card. 409 if version is sent and is out of date.',
  'DELETE /cards/{id}': 'The deleted card.',
  'POST /cards/{id}/comments': 'The card, including the new comment.',
  'GET /activity': 'A list of {at, project, card, action, detail}. 50 entries unless limit says otherwise.',
  'GET /export': '{revision, projects, cards, activity}'
};
const LIMITS = {
  key: '2 to 6 letters or digits, starting with a letter', name: 'Up to 60 characters', areas: 'Up to 20, 40 characters each', repository: 'http or https address, up to 300 characters',
  title: 'Up to 200 characters', labels: 'Up to 12, 30 characters each', commit: 'Up to 60 characters', ref: 'Your own reference, up to 100 characters', note: 'Up to 500 characters; added to the history',
  position: 'Place in the column, 0 is the top', version: 'The version you last read', ids: 'Card ids, up to 500', from: 'With project: move every card that has this status', to: 'The status to move to',
  text: 'Up to 4000 characters', author: 'Up to 40 characters', cards: '1 to 200 cards, each with the fields of a new card', card: 'The card as DELETE returned it'
};
const EXAMPLES = {
  'POST /projects': { key: 'WEB', name: 'Website', areas: ['UI', 'API'] },
  'PATCH /projects/{key}': { archived: true },
  'POST /projects/{key}/cards': { title: 'Login button does nothing', type: 'bug', priority: 'P2', area: 'UI' },
  'POST /projects/{key}/cards/batch': { cards: [{ title: 'Write the tests' }, { title: 'Update the README', type: 'chore' }] },
  'POST /cards/move': { project: 'WEB', from: 'pushed', to: 'deployed' },
  'POST /cards/restore': { card: { id: 'WEB-1', project: 'WEB', title: 'Login button does nothing' } },
  'PATCH /cards/{id}': { status: 'fixed', note: 'Handler was not attached', commit: 'abc1234' },
  'POST /cards/{id}/comments': { text: 'Checked on the live site.', author: 'Sam' }
};
const OBJECTS = {
  Project: [['key', 'Text'], ['name', 'Text'], ['description', 'Text'], ['color', 'One of the project colours'], ['areas', 'List of text'], ['repository', 'Address or empty'], ['archived', 'true or false'], ['created', 'Time (ISO 8601)'],
    ['stats', 'total, open, openBugs (bugs and security), urgent (open P1) and byStatus counts. In /export, projects have nextNumber in place of stats.']],
  Card: [['id', 'Text such as WEB-1; a new card never reuses one'], ['project', 'Project key'], ['title, description', 'Text'], ['type, priority, status', 'See Values'], ['area', 'Text'], ['labels', 'List of text'],
    ['commit, ref', 'Text'], ['due', 'YYYY-MM-DD or empty'], ['rank', 'Place in the column, from 0'], ['version', 'Grows when the card is changed or commented on'], ['created, updated', 'Time (ISO 8601)'],
    ['comments', 'List of {at, author, text}'], ['history', 'List of {at, to, from, note}']]
};
const ERRORS = [
  ['400', 'invalid', 'A field, the JSON or the address is not valid. Unknown fields in projects, cards, moves and comments are refused.'], ['401', 'unauthorized', 'A token is required and was missing or wrong.'],
  ['403', 'forbidden', 'The request did not come from this computer or from the board’s own page.'], ['404', 'not_found', 'No such route, project or card.'],
  ['405', 'method_not_allowed', 'The route exists, but not with this method.'], ['409', 'conflict', 'The change clashes with the current data.'],
  ['413', 'too_large', 'The request is larger than 1 MB.'], ['415', 'unsupported', 'A body was sent without Content-Type: application/json.'], ['500', 'server_error', 'The change could not be made.']
];

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const grid = (heads, rows) => h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, heads.map(x => h('th', {}, x)))),
  h('tbody', {}, rows.map(row => h('tr', {}, row.map((cell, i) => h('td', {}, i ? cell : h('code', {}, cell))))))));
function sample(text) {
  const button = h('button', { type: 'button', class: 'copy', onclick: async () => {
    try { await navigator.clipboard.writeText(text); button.textContent = 'Copied'; } catch (e) { button.textContent = 'Not copied'; }
    setTimeout(() => { button.textContent = 'Copy'; }, 1500);
  } }, 'Copy');
  return h('div', { class: 'sample' }, h('pre', { tabindex: '0' }, h('code', {}, text)), button);
}
function curl(base, method, path, body, secured) {
  const url = base + path.replace('{key}', 'WEB').replace('{id}', 'WEB-1') + (method === 'DELETE' && path === '/projects/{key}' ? '?confirm=WEB' : '');
  const lines = ['curl ' + (method === 'GET' ? '' : '-X ' + method + ' ') + '"' + url + '"'];
  if (secured) { lines.push('-H "Authorization: Bearer $KANBAN_TOKEN"'); }
  if (body) { lines.push('-H "Content-Type: application/json"', "-d '" + JSON.stringify(body) + "'"); }
  return lines.join(' \\\n  ');
}

function operation(base, o, secured) {
  const { path, method, op } = o;
  const id = method + ' ' + path;
  const body = op.requestBody && op.requestBody.content['application/json'].schema;
  // the project in the address replaces a project filter, so that one is not listed
  const params = (op.parameters || []).filter(p => !(p.name === 'project' && path === '/projects/{key}/cards'));
  const kind = v => v.type === 'array' ? 'list of ' + v.items.type : v.type;
  const longest = path.includes('cards') ? '10000' : '500';
  const about = (key, v) => v.enum ? v.enum.join(' | ') : key === 'description' ? 'Up to ' + longest + ' characters' : LIMITS[key] || v.description || '';
  const status = Object.keys(op.responses).find(code => code < 300);
  return h('section', { class: 'operation', id: slug(id) },
    h('h3', {}, h('a', { href: '#' + slug(id) }, h('b', { class: 'method ' + method.toLowerCase() }, method), h('code', {}, path))),
    h('p', {}, op.summary),
    params.length > 0 && [h('h4', {}, 'Parameters'), grid(['Name', 'In', 'Description'], params.map(p => [p.name, p.in + (p.required ? ', required' : ''), p.description || '']))],
    body && [h('h4', {}, 'JSON body'), grid(['Field', 'Type', 'Required', 'Description'], Object.entries(body.properties).map(([key, v]) => [key, kind(v), (body.required || []).includes(key) ? 'yes' : 'no', about(key, v)]))],
    h('h4', {}, 'Example'), sample(curl(base, method, path, EXAMPLES[id], secured)),
    h('h4', {}, 'Response ' + status), h('p', {}, RETURNS[id] || op.responses[status].description));
}

async function docs() {
  applyTheme();
  const root = $('#docs');
  try {
    const spec = await api('GET', '/openapi.json');
    const meta = await api('GET', '/meta');
    const base = location.origin + API, secured = !!spec.security;
    const groups = new Map();
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(item)) {
        const tag = op.tags[0];
        if (!groups.has(tag)) { groups.set(tag, []); }
        groups.get(tag).push({ path, method: method.toUpperCase(), op });
      }
    }
    const part = (title, ...children) => h('section', { id: slug(title) }, h('h2', {}, title), ...children);
    const link = (title, ...label) => h('a', { href: '#' + slug(title) }, label.length ? label : title);
    const values = (title, list) => [h('h3', {}, title), grid(['Value', 'Name', 'Meaning'], list.map(x => [x.id, x.name, x.hint || '']))];

    const nav = h('nav', { 'aria-label': 'Contents' },
      h('a', { href: './' }, '← Back to the board'),
      link('Introduction'), link('Errors'),
      [...groups].flatMap(([tag, list]) => [h('strong', {}, GROUPS[tag] || tag),
        ...list.map(o => link(o.method + ' ' + o.path, h('b', { class: 'method ' + o.method.toLowerCase() }, o.method), h('span', {}, o.path)))]),
      h('strong', {}, 'Reference'), link('Objects'), link('Values'));

    const main = h('main', {},
      h('h1', {}, spec.info.title + ' reference'),
      part('Introduction',
        h('p', {}, 'Projects and their cards. The web page, the command line and scripts all use these routes. Download the ', h('a', { href: 'api/v1/openapi.json' }, 'OpenAPI document'), secured ? ' (it needs the token too).' : '.'),
        h('h4', {}, 'Base address'), sample(base),
        h('h4', {}, 'Requests'), h('p', {}, 'Send bodies as JSON with Content-Type: application/json, at most 1 MB. The server listens on this computer only and refuses requests from other websites.'),
        h('h4', {}, 'Authentication'), h('p', {}, secured ? 'Every API call needs the header Authorization: Bearer <token>, where the token is the server’s KANBAN_TOKEN.' : 'No token is required at present. Set KANBAN_TOKEN before starting the server to require one.'),
        h('h4', {}, 'Staying up to date'), h('p', {}, 'Poll /revision; it grows with every change. To avoid overwriting a newer change to a card, send its version when you change it.'),
        h('p', {}, 'The examples use bash syntax and a project with the key WEB. In PowerShell, use Invoke-RestMethod.')),
      part('Errors', h('p', {}, 'A refused request answers with this shape:'), sample('{"error": {"code": "invalid", "message": "title cannot be empty."}}'),
        grid(['Status', 'Code', 'When'], ERRORS)),
      [...groups].flatMap(([tag, list]) => [h('h2', {}, GROUPS[tag] || tag), ...list.map(o => operation(base, o, secured))]),
      part('Objects', ...Object.entries(OBJECTS).flatMap(([title, rows]) => [h('h3', {}, title), grid(['Field', 'Content'], rows)])),
      part('Values', ...values('Status', meta.STATUSES), ...values('Type', meta.TYPES), ...values('Priority', meta.PRIORITIES),
        h('h3', {}, 'Project colour'), h('p', {}, meta.COLORS.join(', ')),
        h('h3', {}, 'Area'), h('p', {}, 'Each project has its own areas. A new project starts with: ' + meta.DEFAULT_AREAS.join(', ') + '.')));

    root.replaceChildren(nav, main);
    // the sections did not exist when the browser first looked for the one in the address
    const target = document.getElementById(location.hash.slice(1));
    if (target) { target.scrollIntoView(); }
  } catch (e) { root.textContent = e.message; }
}

state.meta = null;
if ($('#docs')) { docs(); } else { start(); }
