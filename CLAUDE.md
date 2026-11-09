# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

MTG RePrint is a local web app: a Node server on `127.0.0.1` plus an Angular app it serves. The user pastes a Magic: The Gathering decklist and gets a print-ready PDF of proxies. Card **data** comes from Scryfall, card **images** only from Gatherer (never Scryfall images).

## Commands

Run from the repository root unless noted. Node >= 22.22.3 (CI uses 24).

```
npm run install:all      # root + server + web (three separate package-lock.json)
npm run typecheck        # server only (tsc --noEmit over src and test)
npm test                 # server tests, then web tests (node:test, network mocked)
npm run build            # Angular production build -> web/dist/web/browser
npm start                # server, serves the built web app, opens the browser
npm run dev:server       # server with --watch on :3210
npm run dev:web          # ng serve on :4200, proxies /api to :3210
npm run exe              # standalone executable in dist/ (Node SEA), for the current OS/CPU
```

Single test file or single test (server; same pattern in `web/`):

```
cd server
node --disable-warning=ExperimentalWarning --test test/resolver.test.ts
node --disable-warning=ExperimentalWarning --test --test-name-pattern="double-faced" "test/*.test.ts"
```

The web app is type-checked only by `npm run build` (Angular compiler, strict templates). CI runs typecheck, test and build.

## Architecture

**No build step for the server**: Node runs `server/src/*.ts` directly (type stripping), so only erasable TypeScript is allowed (`erasableSyntaxOnly`: no enums, no parameter properties, no namespaces) and local imports use the `.ts` extension. The executable bundles the server with esbuild into CommonJS (`scripts/build-exe.mjs`) and embeds the web files as SEA assets (`server/src/sea.ts` reads them; `static.ts` serves either a folder or the assets).

**Resolving a card** (`server/src/`):
- `decklist.ts` parses lines (qty, name, `(SET) number`, `#number`, section headers).
- `resolver.ts` `findCard` builds an ordered list of attempts, preferred language before set: requested set in the preferred language, most recent print in that language, then the same in English, then Scryfall `named` exact/fuzzy. When Scryfall has no print at all in the preferred language, before English it tries the English prints on Gatherer in that language (`gathererOnly`, main version of each set first, at most `MAX_GATHERER_ONLY_TRIED`; `imageInLanguage` remembers missing pages on disk for `MISSING_PAGE_MAX_AGE_MS`); such a translation gets the id `<English Scryfall id>:<lang>` (`translationId`/`parseTranslationId`; accepted wherever a print id is: `/api/print`, `printId`, `pins`), the printed name read from the page title, and `gathererOnly` in `ResolvedCard`/`PrintOption`. `versions` lists these translations first when Scryfall has none in the language. A print counts only if Gatherer has its image. Double-faced prints with only the front image are kept aside (`incomplete`) and used only if no complete print exists in any language.
- `scryfall.ts` searches prints (`unique=prints`, newest first, promos and special set types last) and filters out cards that only share a face name (`isNamed`). Answers are cached; a cached 404 expires after a day.
- `gatherer.ts` finds images two ways: the new Gatherer page (`/SET/lang/number/slug`, image id read from meta tags) for single-faced cards, or legacy `multiverseid` images (one per face) for double-faced/split cards and as fallback. Failures and page refusals are retried after `RETRY_AFTER_MS`, not remembered forever. It also records per print what was found (`full`/`front`/`none`) for the versions panel.
- `deck.ts` runs the deck sequentially and emits events; `toResolvedCard` builds what the browser receives. An entry with a `printId` (a print chosen by hand) uses that print via `resolver.print`, and falls back to the normal search if Gatherer no longer has it. A request may carry `entries` (a saved list, used instead of parsing `decklist`) and `pins` (lower-case name -> print id, given to lines without set/number).
- `lists.ts` stores saved lists (wishlists), one `<uuid>.json` per list in `data/lists` (`defaultListsDir`, `--lists-dir`, `MTG_REPRINT_LISTS_DIR`), never inside the cache folder.

**HTTP politeness is a hard rule**: every outbound request goes through `Http` (`server/src/http.ts`): one request at a time per host, a pause between them (`DEFAULT_DELAYS` in `config.ts`), 429 + Retry-After handling. Requests started inside `withPriority('high', ...)` (an `AsyncLocalStorage` context, used by the user-triggered endpoints) jump ahead of the deck being resolved. Do not add direct `fetch` calls, lower the delays, or stop caching.

**API** (`server/src/app.ts`, all under `/api`): `POST /resolve` streams NDJSON events (`start`, one `card` per entry, `done`) and aborts when the browser disconnects; `POST /prints` lists a card's versions; `POST /print` switches a row to one print (404 with the reason if Gatherer has no image); `GET /images/<file>` serves cached images; `POST /cache/clear`; `GET /info`; `GET /lists`, `GET /lists/<id>`, `POST /lists/save` (no `id` = new list), `POST /lists/delete`. Security model: only `Host` values `localhost`/`127.0.0.1`/`[::1]` are accepted (DNS rebinding) and every POST must be `Content-Type: application/json` (forces a CORS preflight that is never answered). Keep both when adding endpoints.

**Shared types**: `web/src/app/api-types.ts` must be identical to `server/src/types.ts` except the first comment line; `web/test/api-types.test.ts` fails otherwise. Change both together.

**Data folder**: the app writes only inside `data/` next to the executable (repository root from the sources; `--data-dir`/`MTG_REPRINT_DATA_DIR` override), never in AppData or other OS folders; `index.ts` checks at startup that it is writable. **Cache** (`cache.ts`): `data/cache` (`MTG_REPRINT_CACHE_DIR` overrides). Scryfall answers are `api_<sha1>.json` (refreshed after `--cache-days`, stale copy used offline); images are `gatherer_<id>.(png|jpg|webp)` and never expire. `IMAGE_FILE` is also the whitelist for `/api/images`.

**Web app** (`web/src/app/`): one standalone, OnPush, signal-based component (`app.ts` + `app.html`). Rows are patched by index with a `generation` counter so late answers from a previous search are dropped; inside nested `@for` blocks use the named `rowIndex`, not `$index`. The versions panel loads its list only when opened; picking a version sets `entry.printId`, which is what a saved list remembers. Saved lists: `wishlist.ts` (no app imports, tested under Node) turns entries into decklist text; while the text is still the open list's, "Find cards" sends the exact `entries`, otherwise `pins`. The PDF is built in the browser by `pdf/pdf.ts` (pdf-lib, 3x3 cards of 63x88 mm on A4/Letter, each image embedded once, WebP converted to PNG through a canvas). `pdf.ts` must not import anything from the app, so `web/test/pdf.test.ts` can run it under plain Node.

## Conventions

- Code, comments, UI text and docs are in English.
- After changing server code, a server started with `npm start` must be restarted (only `dev:server` watches).
- Tests never hit the network: use the fakes in `server/test/helpers.ts` (`rig`, `searchRoute`, `pageFor`, `png`).
- Releases: bump the version in the three `package.json` files and `VERSION` in `server/src/config.ts`, add a `## [x.y.z]` section to `CHANGELOG.md`, check with `node scripts/release-notes.mjs vX.Y.Z --check`, then push the tag; `.github/workflows/release.yml` builds and publishes.
- The project discloses AI assistance (README "Built with AI assistance"); commits made with Claude carry a `Co-Authored-By` line.
- Branches and commits are managed by the maintainer: do not create or switch branches, commit, push or open PRs unless explicitly asked. Leave the changes in the working tree and, at the end of a piece of work, suggest a short commit message.
