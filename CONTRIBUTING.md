# Contributing to MTG RePrint

Thanks for your interest! Bug reports, ideas and pull requests are all welcome.

## Before you start

- **Bugs**: open an issue with the bug report form. Include the decklist line that fails, the language you chose and what the card shows (the message under it is usually the most useful part).
- **New features**: open an issue first and describe what you would like to do, so we can agree on the approach before you spend time on it.
- **Security problems**: please do not open a public issue. See [SECURITY.md](SECURITY.md).

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Set up

You need [Node.js](https://nodejs.org) 22.22.3 or newer (24 LTS recommended).

```
npm run install:all
npm run dev:server   # terminal 1: API on http://localhost:3210 (restarts on changes)
npm run dev:web      # terminal 2: Angular dev server on http://localhost:4200
```

## Before opening a pull request

```
npm run typecheck
npm test             # server and web tests; the network is mocked, nothing is downloaded
npm run build
```

All three must pass: CI runs the same commands.

Some guidelines:

- **Keep pull requests small and focused**: one change per pull request is easier to review.
- **Add or update tests** for what you change. Server tests are in `server/test`, PDF and web tests in `web/test`.
- **API types**: `web/src/app/api-types.ts` is a copy of `server/src/types.ts`. If you change one, copy it to the other (a test checks that they match).
- **Be polite to Scryfall and Gatherer**: every request goes through the `Http` class in `server/src/http.ts`, which sends one request at a time per host with a pause between them. Do not bypass it, do not lower the pauses, and keep caching what is downloaded. See the [Scryfall API guidelines](https://scryfall.com/docs/api).
- **No card images or card data in the repository**: tests use tiny made-up images and data.
- **Style**: follow the code around you. TypeScript is strict; prefer small functions with a short comment explaining *why* rather than *what*. An [`.editorconfig`](.editorconfig) sets indentation and line endings.
- Update [CHANGELOG.md](CHANGELOG.md) (section "Unreleased") when the change is visible to users.

## AI-assisted contributions

This project was itself written with the help of an AI assistant (see the [README](README.md#built-with-ai-assistance)), so contributions made with AI tools are welcome. We ask the same of them as of any other contribution:

- **You are the author**: you have read, understood and tested every line you submit, and you can explain it in the review.
- **Say so** in the pull request description, briefly (for example "written with the help of an AI assistant, reviewed and tested by me").
- **Licensing is your responsibility**: do not submit code you are not allowed to license under MIT.

## Releases

To release a new version, a maintainer:

1. updates the version in the root, `server` and `web` `package.json` files and `VERSION` in `server/src/config.ts`;
2. moves the "Unreleased" changelog entries under a new `## [x.y.z]` heading;
3. checks with `node scripts/release-notes.mjs vX.Y.Z --check`, commits, and pushes the tag (`git tag vX.Y.Z && git push origin vX.Y.Z`).

The `release.yml` workflow checks the tag again, builds the executables for Linux, macOS and Windows, and creates one GitHub release with all of them and the changelog section as release notes.
