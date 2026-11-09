# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Saved lists (wishlists): save the cards shown, with their quantities and the versions picked by hand, and open them again later. Stored as files in `data/lists` (`--lists-dir`, `MTG_REPRINT_LISTS_DIR`), so clearing the cache does not delete them.
- `--data-dir` and `MTG_REPRINT_DATA_DIR`.

### Fixed

- Cards that Gatherer has in the preferred language but Scryfall does not (common for Commander products, e.g. *Cayth, Famed Mechanist* in Italian) were printed in English: their Gatherer page in that language is now tried first, with the main version of the set before its variants. Missing pages are remembered for a week. These translations are listed in the versions panel ("✓ only on Gatherer"), can be picked again after switching to English, are kept by saved lists, and the card is marked "Not on Scryfall".

### Changed

- Everything the app writes now lives in a `data` folder next to the program (`data/cache`, `data/lists`) instead of the system cache folder (AppData, `~/.cache`, `~/Library/Caches`). The old cache folder is no longer used and can be deleted.

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
