# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0]

### Added

- Saved lists (wishlists): below the cards, name the list and save it; open it again from "Saved lists" above the decklist. A list remembers the cards, their quantities and the versions picked by hand (marked "Version chosen by hand"); the other cards are looked up again when it is opened, so they pick up new prints. Editing the text of an open list keeps the versions picked for the cards still in it. **Save** updates the list, **Save as new** makes a copy.
- Translations that Gatherer has but Scryfall does not list (common for Commander products, e.g. *Cayth, Famed Mechanist* in Italian) are now found: when Scryfall has no print in the preferred language, the Gatherer pages of the English prints are tried in that language (the main version of each set before its variants) before falling back to English. These cards are marked "Not on Scryfall", are listed in the versions panel as "only on Gatherer", and can be kept by saved lists.
- `--data-dir` and `MTG_REPRINT_DATA_DIR` (where the app keeps its files), `--lists-dir` and `MTG_REPRINT_LISTS_DIR`.

### Changed

- Everything the app writes now lives in a `data` folder next to the program (`data/cache` and `data/lists`) instead of the system folders (AppData, `~/.cache`, `~/Library/Caches`): deleting the program's folder removes everything. Keep the program in a folder you can write to. The cache of version 0.1.0 is no longer used and can be deleted (`%LOCALAPPDATA%\mtg-reprint` on Windows, `~/Library/Caches/mtg-reprint` on macOS, `~/.cache/mtg-reprint` on Linux).

## [0.1.0]

First public version.

### Added

- Decklist to PDF: A4 or US Letter, 3×3 cards of 63 × 88 mm per page, optional cut marks.
- Card data from Scryfall, images from Gatherer; the preferred language is tried first, then English.
- Double-faced cards print both faces; a print whose back is missing on Gatherer is used only when no complete one exists, and the card says so.
- Preview with quantities, a link to each card's Gatherer page, an enlarged view on click, and a panel to pick another version of a card.
- Disk cache for Scryfall answers and images, with offline fallback.
- Requests made by the user (versions panel) go before the ones of a decklist being resolved.
- Standalone executables for Windows, macOS and Linux.
