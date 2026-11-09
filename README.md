# MTG RePrint

A small web app that turns a Magic: The Gathering decklist into a print-ready PDF of proxies. It runs **on your own computer**: you start a local server, your browser opens, you paste a list.

- **Data** (which prints exist, in which language, from which set) comes from [Scryfall](https://scryfall.com).
- **Images** always come from [Gatherer](https://gatherer.wizards.com), never from Scryfall. If Gatherer has no image for a print, the next print is tried.
- **Language first**: your preferred language (default Italian) is tried before anything else, with your preferred set first and the most recent print after that. English is used only when there is no image in your language, and the card tells you why.
- **Output**: PDF in A4 or US Letter, 3×3 cards per page at the real size of 63 × 88 mm, with optional cut marks. Print it at 100% ("actual size").
- Double-faced cards use two slots (front and back). Quantities can be changed in the preview.
- In the preview each card name links to its Gatherer page, and a dropdown under the card lists its other versions, in your language and in English (loaded only when you point at it). Pick one to use it instead: the app checks Gatherer at that moment, and marks versions it has already checked (✓, "front only", "no image").

> This is an unofficial fan tool. Please read the [legal notice](#legal-notice) before using it.

> **Built with AI assistance**: most of the code was written with an AI assistant. See [below](#built-with-ai-assistance) for what that means.

## Run it

### Option A: the executable

Download the file for your system from the [Releases](../../releases) page and run it. Your browser opens at `http://localhost:3210`. Nothing else to install.

> The executables are not code-signed. Windows SmartScreen and macOS Gatekeeper may warn you the first time: that is expected for unsigned apps. If you prefer, build it yourself (below) or run it from the sources.

### Option B: from the sources

You need [Node.js](https://nodejs.org) 22.22.3 or newer (24 LTS is fine).

```
git clone <url of this repository> mtg-reprint
cd mtg-reprint
npm run install:all
npm run build        # builds the web app
npm start            # starts the server and opens the browser
```

Options of the server (`npm start -- --help` lists them all):

| Option | Meaning |
| --- | --- |
| `--port <n>` | Port to listen on (default 3210; if taken, the next free one is used) |
| `--no-open` | Do not open the browser |
| `--data-dir <dir>` | Where the app keeps its files (default: a `data` folder next to the program) |
| `--cache-dir <dir>` | Where searches and images are stored (default: `data/cache`) |
| `--lists-dir <dir>` | Where saved lists are stored (default: `data/lists`) |
| `--cache-days <n>` | Days before a cached Scryfall search is refreshed, `0` = never (default 30) |
| `--refresh` | Ignore cached searches for this run |
| `--clear-cache` | Delete cached searches and images, then exit |

Environment variables: `MTG_REPRINT_PORT`, `MTG_REPRINT_DATA_DIR`, `MTG_REPRINT_CACHE_DIR`, `MTG_REPRINT_LISTS_DIR`, `MTG_REPRINT_USER_AGENT`.

## Decklist format

One card per line. Exports from Moxfield and Archidekt work as they are.

```
4 Lightning Bolt
2x Counterspell
1 Fable of the Mirror-Breaker (NEO) 141    # preferred set and collector number
1 Counterspell (MH2)                       # preferred set only
1 Eluge, the Shoreless Sea #49             # collector number only
// comments, and section names like Sideboard or Commander, are handled
```

Card names are English (the Scryfall name), whatever language you want the printed card to be in.

Each card has a versions panel (**Other versions**) to pick another print. Gatherer often has translations that Scryfall does not list: **Search Gatherer**, under **Other versions** on each card, looks for them three prints at a time and adds what it finds to the panel.

## Saved lists

Below the cards, give the list a name and press **Save as list**. A saved list remembers the cards, their quantities and the versions you picked by hand in the versions panel (marked "Version chosen by hand"); the other cards are looked up again when you open it, with the language and sets of the moment, so they pick up new prints.

- **Open** a list from "Saved lists" above the decklist. You can edit its text, for example to add cards: the versions you picked are kept for the cards that are still there. **Save** updates the list, **Save as new** makes a copy.
- Some translations exist on Gatherer but not on Scryfall (often Commander products): the app finds them anyway, marks the card "Not on Scryfall", and lists them in the versions panel as "only on Gatherer", so a list can keep them too.
- If Gatherer no longer has the image of a version you picked, another print is used and the card says so.
- **Where**: one JSON file per list in `data/lists`, next to the program (see [Where files are kept](#where-files-are-kept)). This is not the cache folder: "Clear cache" never deletes your lists.

## Cache

Everything downloaded is kept on disk, so a second run on the same or a similar deck sends almost no requests.

- **Where**: `data/cache`, next to the program (see below).
- **Images** never expire. **Scryfall searches** are refreshed after 30 days, so new prints show up.
- **Offline**: if the network fails, an expired cached search is used instead of giving up.
- "Clear cache" in the app (or `--clear-cache`) removes only the files this app creates.

## Where files are kept

The app writes only inside one `data` folder next to the executable (next to the repository's root when run from the sources): `data/cache` and `data/lists`. Nothing goes to AppData, `~/.cache` or similar, so deleting the program's folder removes everything. Keep the program in a folder you can write to; to use another place, pass `--data-dir` (or `MTG_REPRINT_DATA_DIR`).

## Build the executable

```
npm run install:all
npm run exe          # creates dist/mtg-reprint (or dist/mtg-reprint.exe)
```

This uses Node's [single executable applications](https://nodejs.org/api/single-executable-applications.html): the server is bundled with esbuild, the web app is embedded as assets, and both are injected into a copy of the `node` binary you run the command with. The result works on the OS and CPU you build on. On Windows the build prints `warning: The signature seems corrupted!`: that is expected, because the copied `node.exe` is signed and the injection invalidates its signature (the executable works, but it is unsigned). Use an official Node.js build (from nodejs.org); some Linux distribution packages do not support this. The GitHub workflow `release.yml` builds Linux, macOS and Windows executables when you push a tag such as `v0.1.0`.

## Development

```
npm run dev:server   # terminal 1: API on http://localhost:3210
npm run dev:web      # terminal 2: Angular dev server on http://localhost:4200 (proxies /api)
npm test             # server tests (mocked network) and PDF tests
npm run typecheck
```

- `server/`: Node (no build step: Node runs the TypeScript files directly). Resolves cards, caches, serves images and the web app.
- `web/`: Angular app. The PDF is generated in the browser with [pdf-lib](https://pdf-lib.js.org).
- `web/src/app/api-types.ts` is a copy of `server/src/types.ts`: keep them in sync (a test checks it).

### Security notes

The server listens on `127.0.0.1` only, accepts only requests addressed to `localhost`, `127.0.0.1` or `[::1]` (protection against DNS rebinding) and requires `Content-Type: application/json` on every POST (so other websites cannot call it from your browser).

## Troubleshooting

- **A card is not found**: check the English spelling. For very recent sets Gatherer may not have the image yet.
- **A card is printed in English** although you asked for another language: the card shows the reason (for example, no image in that language on Gatherer).
- **Requests are slow**: that is on purpose. The app keeps a pause between requests to Scryfall and Gatherer. If Scryfall answers HTTP 429 the app waits and retries by itself.
- **Gatherer refuses requests** (HTTP 401 or 403): the app falls back to the older image system. If that also fails, try again later.

## Contributing

Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md) for how to set up the project and what a pull request needs. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md), and report security problems privately as described in [SECURITY.md](SECURITY.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## Built with AI assistance

This project was written with substantial help from an AI assistant: [Claude](https://www.anthropic.com/claude), by Anthropic, used through [Claude Code](https://www.anthropic.com/claude-code). The maintainer decided what to build, directed the work and tried the results; the assistant wrote most of the code, the tests and the documentation, reviewed the project and fixed the bugs it found.

What this means for you:

- The code is covered by the same MIT license and the same automated tests as any other code, but like any code it may contain mistakes. Read it before relying on it, and report what you find.
- Commits made with the assistant say so with a `Co-Authored-By` line.
- AI-assisted contributions are welcome too, under the conditions in [CONTRIBUTING.md](CONTRIBUTING.md#ai-assisted-contributions).

## Legal notice

This is an unofficial fan tool. It is not affiliated with, endorsed by, or sponsored by Wizards of the Coast or Scryfall.

*Magic: The Gathering* and the card names, images and artwork are trademarks and copyrighted material of Wizards of the Coast LLC. This repository contains no card images or card data. The app downloads them from Gatherer and Scryfall on your computer, for your own use.

- Proxies are meant for personal, casual use such as playtesting. Do not sell them, and do not use them in sanctioned tournaments.
- You are responsible for following the terms of use of [Gatherer](https://gatherer.wizards.com), the [Wizards of the Coast Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy) and the [Scryfall API guidelines](https://scryfall.com/docs/api). The app identifies itself, caches what it downloads and keeps a pause between requests, but this does not replace reading those terms.
- This is not legal advice.

## License

[MIT](LICENSE)
