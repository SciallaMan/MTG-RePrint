# Cleanup plan

Code cleanup and small optimisations with **no change in behaviour**: same features, same output, same UI. One
intervention at a time; after each one `npm run typecheck && npm test && npm run build` must stay green. Tick an
item when it is done.

## Starting point (2026-11-11, commit `ae18b82`)

| Check | Result |
| --- | --- |
| `npm run typecheck` (server) | clean |
| `npm test` | server 68/68, web 10/10 |
| `npm run build` (Angular) | OK, 600 kB initial. One pre-existing warning: `pako` (used by pdf-lib) is CommonJS. It comes from the dependency, not from this code. |
| Lint / formatter | none in the project (only `.editorconfig`). Nothing to run. |
| Warnings | web tests print `MODULE_TYPELESS_PACKAGE_JSON` three times (`web/package.json` has no `"type"`). |

Test coverage, which decides how risky a change is: every server module has tests; in the web app only
`wishlist.ts` and `pdf/pdf.ts` are tested (under Node). **The Angular component (`app.ts` + `app.html`) has no
tests at all**: changes there are checked by the strict template build and by hand in the browser.

Dependencies: all used (`esbuild`/`postject` by `scripts/build-exe.mjs`; `rxjs`/`tslib` are required by Angular
even though the app does not import them; `@types/node` in `web/` is for the Node tests). No deprecated package in
the three lockfiles. `npm outdated` was not run (it needs the network): say so if you want it.

## Interventions, safest first

### A. Trivial (dead code, comments, style)

- [x] **A1. Remove `APP_NAME`** — `server/src/config.ts`. Exported constant, used nowhere (not even by the scripts).
  Risk: low. Benefit: dead code gone.
- [x] **A2. Fix comments that are out of date** — `server/src/app.ts` (`PRINT_ID` says "a Scryfall id, or
  `<id>:<lang>`": it also accepts `gatherer:…` ids now), `server/src/static.ts` (`StaticSource`: "the standalone
  executable will add another source" — `AssetSource` exists), `server/src/types.ts` **and**
  `web/src/app/api-types.ts` together (`scryfallId` / `DeckEntry.printId` do not mention the `gatherer:…` id;
  `web/test/api-types.test.ts` requires the two files to stay identical). Risk: low. Benefit: readability.
- [x] **A3. `index.ts` style** — `server/src/index.ts`: a double blank line (l. 90–91) and `import { isSea } from
  'node:sea'` sitting among the local imports instead of with the `node:` ones. Risk: low.
- [x] **A4. Re-indent `app.html`** — `web/src/app/app.html`. The last commit went through an editor formatter that
  does not know Angular control flow: the children of every `@if` / `@for` lost their indentation and a few long
  lines were wrapped (`Find\n        cards` inside a button). Markup is unchanged, only whitespace, which HTML
  collapses. Put the previous indentation back (as in `git show 471a6a1:web/src/app/app.html`, plus the lines added
  since). Risk: low (build checks the template; a visual check that nothing moved). Benefit: the template is readable
  again, and consistent with the Angular style used before. Note: to avoid it happening again, the VS Code HTML
  formatter should be off for this file or replaced by the Angular one — that is an editor setting, not a repo change,
  so it is just a suggestion.
- [x] **A5. Drop `class="secondary"`** — `web/src/app/app.html` (Cancel button). No CSS rule defines `.secondary`
  anywhere, so the class does nothing. Removing it changes nothing on screen. Risk: low. (The alternative — giving
  it a style — would change the UI, so it is not proposed.)

### B. Small helpers for repeated code (web)

- [x] **B1. `errorMessage(error)` helper** — `web/src/app/app.ts`. `error instanceof Error ? error.message :
  String(error)` appears 7 times, and the "Cannot reach the MTG RePrint server" variant (`TypeError` check) twice
  (`resolve` and `addCard`). One function each. Risk: low (pure functions; no component tests, so verified by the
  build and a quick run). Benefit: shorter, one place to change the wording.
- [x] **B2. `languageOf(code)` helper** — `web/src/app/app.ts`: `LANGUAGES.find((l) => l.code === …)` is written
  twice (`resolvedLangName`, `versionGroups`). Risk: low.
- [x] **B3. One place for the image URL** — `web/src/app/api.ts` (`imageBytes`) and `app.ts` (`imageUrl`) both
  build `/api/images/${encodeURIComponent(file)}`. Move the URL into `Api.imageUrl(file)` and use it from both.
  Risk: low. Benefit: the route is written once.

### C. Small helpers for repeated code (server, all covered by tests)

- [x] **C1. `isCardName(value)`** — `server/src/app.ts`: the check `typeof name !== 'string' || name.trim() === '' ||
  name.length > 200` is written 3 times (`parseEntries`, `parsePins`, `parsePrintsRequest`). Tests:
  `lists.test.ts`, `versions.test.ts`. Risk: low.
- [ ] **C2. One UUID pattern** — `server/src/lists.ts` (`LIST_ID`) and `server/src/app.ts` (`PRINT_ID`) both spell
  out the UUID regex. Keep one `UUID` source string (e.g. in `lists.ts`, already exported) and build `PRINT_ID` from
  it. Tests: `lists.test.ts`, `versions.test.ts`, `links.test.ts`. Risk: low.
- [ ] **C3. `deck.ts` / `app.ts` duplicates** — the `toResolvedCard(card, images, { requestedLang, requested: null,
  requestedSetFound: true, langNote: null })` call for a print chosen by hand appears in `deck.ts` (pinned entry)
  and `app.ts` (`print` endpoint); `[...new Set(reasons)].join('; ')` appears in both too. One small helper for each
  in `deck.ts`. Tests: `lists.test.ts`, `versions.test.ts`, `links.test.ts`. Risk: low.
- [ ] **C4. `pageLabel()` in `gatherer.ts`** — `${setCode}/${lang}/${num}` is built in `imageFromPage`,
  `readPage` and `imageFromLink` (and a variant in `findImages`). One function. Tests: `resolver.test.ts`,
  `fixes.test.ts`, `links.test.ts` match on these labels. Risk: low.
- [ ] **C5. `MAX_QTY` constant** — the quantity limit 99 is a literal in `server/src/app.ts` (validation and its
  message), `web/src/app/app.ts` (`changeQty`) and `web/src/app/wishlist.ts` (`addEntries`). One constant per side
  (server: `app.ts`; web: `wishlist.ts`, imported by `app.ts`). Putting it in the shared `types.ts`/`api-types.ts`
  would be cleaner but that file is "API types only" — say if you prefer that. Risk: low.

### D. Duplicated logic (server, covered by tests)

- [ ] **D1. `static.ts`: one `requestedFile(urlPath)`** — `FolderSource.get` and `AssetSource.get` repeat the same
  lines: `decodeURIComponent` in a try/catch, `'/'` → `index.html`, strip leading slashes, single-page fallback when
  there is no extension. Extract a shared function; each class keeps only its own lookup. Tests: `static.test.ts`,
  `app.test.ts` (path traversal). Risk: low–medium (security-relevant code, but the traversal tests exist and the
  logic does not change). Benefit: one place for the SPA rule.
- [ ] **D2. One atomic write** — `server/src/cache.ts` (`writeAtomic`) and `server/src/lists.ts` (`save`) both do
  "write `<file>.<pid>.<time>.tmp`, then `rename`". Export the function from `cache.ts` (or a tiny `fs.ts`) and use it
  in `lists.ts`. Tests: `cache.test.ts`, `lists.test.ts`. Risk: low–medium (file writing; same calls, just moved).
- [ ] **D3. Move the Gatherer-link functions to their own module** — `parseGathererLink`, `gathererLinkId`,
  `parseGathererLinkId`, `gathererLinkUrl` and the `GathererLink` type live in `server/src/gatherer.ts`, so
  `decklist.ts` (a pure parser) now imports the whole Gatherer client module. A pure move to `server/src/links.ts`;
  `gatherer.ts`, `decklist.ts`, `deck.ts`, `resolver.ts` and `links.test.ts` import from there; `CLAUDE.md` updated
  (it names `gatherer.ts` for these). Behaviour identical. Tests: `links.test.ts`, `decklist.test.ts`. Risk: medium
  only because it touches 5 files; the change is mechanical.

### E. Complexity (needs care: little or no test coverage)

- [ ] **E1. Split `addCard()` in the web component** — `web/src/app/app.ts`. ~70 lines, with a nested event
  callback that writes to `gen` and `target` from the outer scope. Extract the `start`-event part into
  `insertAddedEntries(entries): number[]` (returns the target rows) so `addCard` reads top to bottom. **No tests
  cover the component**: after the change, a manual check in the browser (add a new card, add a card already in the
  list, add while a versions panel is open, add a line with no card). Risk: medium. Benefit: the trickiest method of
  the component becomes readable.
- [ ] **E2. Split `Resolver.fromLink()`** — `server/src/resolver.ts`. Dense: Scryfall data, double-faced handling,
  page image and the "card from the page alone" fallback in one method. Split into "data for the link" and "images
  for the link". Tests: `links.test.ts` (5 cases). Risk: medium. Benefit: readability; optional.

### F. Needs your OK (configuration, or a behaviour change on bad data)

- [ ] **F1. `"type": "module"` in `web/package.json`** — removes the three `MODULE_TYPELESS_PACKAGE_JSON` warnings
  printed by every `npm test`. The Angular CLI does not read this field (it uses `angular.json`/`tsconfig`), but it
  is a configuration change, so: **only with your OK**; the build is re-run to confirm. Risk: low–medium.
- [ ] **F2. Validate saved lists when reading them** — `server/src/lists.ts` `get()` returns `raw.entries as
  DeckEntry[]` without checking the entries (the `parseEntries` validator exists in `app.ts`). Today a hand-edited or
  corrupt list file is accepted as it is; with validation it would be reported as unreadable (skipped in the list,
  404 when opened). That is a **behaviour change on bad data**, so it is listed, not planned. Say if you want it.
- [ ] **F3. Type-check the web tests** — `web/test/*.ts` (and `wishlist.ts`/`pdf.ts` as the tests use them) are
  never type-checked: `tsconfig.app.json` includes only `src/`, and the tests run with type stripping. A
  `tsconfig.test.json` + a `typecheck` script in `web/package.json` (and in CI) would close the gap. Tooling change:
  only with your OK.

## Discarded (looked at, not worth it or not safe)

- **Double `IMAGE_FILE` check** on `GET /api/images` (`app.ts` tests the name, `Cache.readImage` tests it again).
  Defence in depth on the only route that reads a file by name from the request: kept on purpose.
- **Rewriting `createHandler`'s routing** (`server/src/app.ts`, ~100 lines of `if` chains, `request as X` casts after
  the parser map). A typed route table would remove the casts, but it is a rewrite of the most security-sensitive
  file for a readability gain only. Not in this pass.
- **Generic `Job<T>` in `http.ts`** to drop the `resolve as (value: unknown) => void` cast: the cast is contained
  and documented by its shape; a generic queue adds more type noise than it removes.
- **`as number` casts in `pdf.ts` `cutMarks`**: harmless, and they keep the file correct if the web tsconfig ever
  gets `noUncheckedIndexedAccess` like the server's.
- **Adding ESLint / Prettier**: would catch the formatter accident of A4 and enforce the rest, but it means new
  dependencies, so it is a separate decision (see "Future").
- **Performance**: nothing worth changing. The only repeated work is `versionGroups(row)` recomputed on each change
  detection while a panel is open (a few dozen items) and `Lists.all()` reading files one by one (tens of files).
  `rows.update(map)` per card event is O(n) per event; a 1000-card list is still instant.
- **Errors**: no unhandled promise or swallowed exception found. `console.*` appears only in the CLI (`index.ts`),
  the top-level handler (`app.ts`) and the Angular bootstrap — all intentional. The `catch { return entry; }` in
  `deck.ts` `nameLinkEntry` is intentional: the same lookup is reused and its error reported on the card.

## Future (not part of this cleanup)

- A linter and formatter (ESLint with the Angular plugin, Prettier with the Angular HTML parser) so that templates
  and code keep one style without relying on each editor's defaults.
- Tests for the Angular component, or at least for the pure row logic in `app.ts` (`versionGroups`, `addCard`'s
  row insertion) once E1 extracts it into something testable under Node like `wishlist.ts`.
- `web/tsconfig.json` could adopt `noUncheckedIndexedAccess` like the server's (a few `?.` would be needed).

## Phase 2 procedure

One item per step, in the order above: change → `npm run typecheck && npm test && npm run build` → tick here.
Items in F are done only after an explicit OK. Anything that breaks is fixed or reverted before the next item.
