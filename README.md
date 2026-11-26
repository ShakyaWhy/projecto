# Kanban

A local board for several projects. Everything goes through its API: the web page, the command line and any script
use the same routes. Node 18 or newer; no packages to install.

    node server.js            # or double-click start.bat
    http://127.0.0.1:4600     # the board
    http://127.0.0.1:4600/docs                    # API reference
    http://127.0.0.1:4600/api/v1/openapi.json     # OpenAPI 3

## API in short

    # register a project
    curl -X POST http://127.0.0.1:4600/api/v1/projects -H "Content-Type: application/json" \
         -d '{"key":"MAND","name":"Melosono Android","areas":["App","Backend","Release"]}'

    # add a bug
    curl -X POST http://127.0.0.1:4600/api/v1/projects/MAND/cards -H "Content-Type: application/json" \
         -d '{"title":"Player stops on rotate","type":"bug","priority":"P2","area":"App"}'

    # mark it fixed, with a note and the commit
    curl -X PATCH http://127.0.0.1:4600/api/v1/cards/MAND-1 -H "Content-Type: application/json" \
         -d '{"status":"fixed","note":"keeps the player alive","commit":"abc1234"}'

    # after a release: everything pushed is now deployed
    curl -X POST http://127.0.0.1:4600/api/v1/cards/move -H "Content-Type: application/json" \
         -d '{"project":"MAND","from":"pushed","to":"deployed"}'

On PowerShell use `Invoke-RestMethod`, or the command line client: `node cli.js` lists its commands.

| Field | Values |
|---|---|
| status | todo, doing, blocked, fixed (local), pushed, deployed (live), wontfix |
| type | bug, security, feature, improvement, task, test (to verify), chore (cleanup) |
| priority | P1 critical, P2 high, P3 medium, P4 low |
| area | per project; set with the project's `areas` |

Errors are `{"error": {"code": "...", "message": "..."}}`. Send `version` with a change to be refused (409) if the card
changed since you read it. Deleting returns the card; post it to `/cards/restore` to undo.

## Board shortcuts

`Ctrl+K` find or run anything, `N` new card, `/` filter. On a focused card: arrows to walk, `Enter` to open,
`[` and `]` to move it back or forward. `Esc` closes the card. Drag cards to move them; inside one project's board
(without filters) the place you drop them is kept.

## Data, backup, safety

- `data/board.json` holds everything; the previous version is kept as `board.json.bak`. `data/` is git-ignored, so
  back it up yourself (or save `GET /api/v1/export`).
- Run one server per data file.
- The server listens on this computer only and refuses requests from other websites. Any program on this computer can
  use the API. To require a token, set `KANBAN_TOKEN` before starting; the page and `cli.js` then ask for it or read it
  from the same variable.
- Settings: `KANBAN_PORT` (4600), `KANBAN_DATA` (path of the data file), `KANBAN_URL` (for cli.js).
- It is not built to be put on the internet.

## Tests

    node --test
