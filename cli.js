#!/usr/bin/env node
'use strict';
/* A small client of the API (the server must be running).

   node cli.js projects
   node cli.js project-add MAND "Melosono Android" [--areas "UI,API"] [--color teal]
   node cli.js list [MWEB] [--status todo] [--type bug] [--q text]
   node cli.js show MWEB-3
   node cli.js add MWEB "Title" [--type bug] [--priority P2] [--area API] [--status todo] [--description "..."] [--labels a,b]
   node cli.js edit MWEB-3 [--priority P1] [--title "..."] ...
   node cli.js move MWEB-3,MWEB-4 fixed [--note "..."] [--commit abc1234]
   node cli.js release MWEB pushed deployed [--note "..."]     every card of one column to another
   node cli.js comment MWEB-3 "Text"

   KANBAN_URL (default http://127.0.0.1:4600), KANBAN_TOKEN
*/
const fs = require('fs');
const BASE = (process.env.KANBAN_URL || 'http://127.0.0.1:4600').replace(/\/$/, '') + '/api/v1';

async function call(method, path, body) {
  const headers = {};
  if (body) { headers['content-type'] = 'application/json'; }
  if (process.env.KANBAN_TOKEN) { headers.authorization = 'Bearer ' + process.env.KANBAN_TOKEN; }
  let res;
  try { res = await fetch(BASE + path, { method, headers, body: body && JSON.stringify(body) }); } catch (e) { throw new Error('The board is not running. Start it with: node server.js'); }
  const out = await res.json();
  if (!res.ok) { throw new Error(out.error.message); }
  return out;
}

const line = c => c.id.padEnd(9) + c.priority + '  ' + c.status.padEnd(9) + c.type.padEnd(12) + (c.area || '-').padEnd(22) + c.title;

async function main(argv) {
  const words = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { flags[argv[i].slice(2)] = argv[++i] || ''; } else { words.push(argv[i]); }
  }
  for (const key of ['labels', 'areas']) { if (flags[key] !== undefined) { flags[key] = flags[key].split(',').map(s => s.trim()).filter(Boolean); } }
  const [command, a, b, c] = words;
  const enc = encodeURIComponent;
  if (command === 'projects') {
    (await call('GET', '/projects')).forEach(p => console.log(p.key.padEnd(8) + p.name.padEnd(28) + p.stats.open + ' open, ' + p.stats.total + ' total' + (p.archived ? ' (archived)' : '')));
  } else if (command === 'project-add') {
    console.log((await call('POST', '/projects', Object.assign({ key: a, name: b }, flags))).key + ' registered');
  } else if (command === 'list') {
    const query = new URLSearchParams(Object.assign(a ? { project: a } : {}, flags)).toString();
    const cards = await call('GET', '/cards?' + query);
    cards.forEach(x => console.log(line(x)));
    console.log(cards.length + ' card(s)');
  } else if (command === 'show') {
    console.log(JSON.stringify(await call('GET', '/cards/' + enc(a)), null, 2));
  } else if (command === 'add') {
    console.log(line(await call('POST', '/projects/' + enc(a) + '/cards', Object.assign({ title: b }, flags))));
  } else if (command === 'edit') {
    console.log(line(await call('PATCH', '/cards/' + enc(a), flags)));
  } else if (command === 'move') {
    (await call('POST', '/cards/move', Object.assign({ ids: a.split(',').map(s => s.toUpperCase()), to: b }, flags))).forEach(x => console.log(line(x)));
  } else if (command === 'release') {
    console.log((await call('POST', '/cards/move', Object.assign({ project: a, from: b, to: c }, flags))).length + ' card(s) moved');
  } else if (command === 'comment') {
    console.log(line(await call('POST', '/cards/' + enc(a) + '/comments', Object.assign({ text: b }, flags))));
  } else {
    console.log(fs.readFileSync(__filename, 'utf8').split('/*')[1].split('*/')[0].trim());
    process.exitCode = command ? 1 : 0;
  }
}

main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exitCode = 1; });
