# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.5.0]

### Added

- **Add a card**, above the cards found: type one card (same format as a decklist line, e.g. `2 Counterspell (MH2) 267`) and only that card is looked up and added at the top, without searching the whole list again. It also goes at the top of the decklist text, so an open saved list can be grown one card at a time and saved. A card already in the list (same name, set and number) gets the quantity added instead.
- A card can be given by the link of its Gatherer page (`2 https://gatherer.wizards.com/M3C/it-it/6/cayth-famed-mechanist`), in **Add a card** or in the decklist, for the cards that the app does not find although Gatherer has them. The image is read from that page; the card counts as a version chosen by hand and saved lists keep the link.

## [0.4.2]

### Changed

- The language is named in English inside the English sentences of the app ("Find more Italian versions on Gatherer" instead of "Find more Italiano versions on Gatherer"), also in the tooltip. The language menu and the versions panel keep the names as each language writes them.

## [0.4.1]

### Added

- A notice when a new version is out, with a link to download it and a reminder to put it in the same folder as the old one, so the saved lists and the cache (the `data` folder) are kept. The app asks GitHub once each time it starts; `--no-update-check` (or `MTG_REPRINT_NO_UPDATE_CHECK=1`) turns this off. **Dismiss** hides the notice until the next version.

## [0.4.0]

### Added

- Set codes can also be written as Gatherer has them for the old sets (up to Odyssey): `(IN)` works like `(INV)` for Invasion, `(1E)` like `(LEA)` for Alpha, and so on.
- The PDF is named after the list: the name of the open list (or the one typed to save it) is the file name and the document title. Without a name it is still `proxies.pdf`.

### Fixed

- A card written by its name in the preferred language (e.g. *Morte o Gloria* in Italian) is now found in English when Gatherer has no image in that language, and its English prints are listed in the versions panel. Before, the English search used the translated name, found nothing and the row stayed "not found".

### Changed

- For the old sets the Gatherer pages are now looked up with Gatherer's set codes (`IN/en-us/13` instead of `INV/en-us/13`, which does not exist), and the card names link there.
- Clearer explanation when Gatherer has no image in the preferred language, e.g. "in IT: Gatherer has no image of the 1 print Scryfall lists (IN/it-it/13: no page on Gatherer; ...)".
- **Search Gatherer** is now a small link under **Other versions**, named after the language ("Find more Italian versions on Gatherer"); how many prints are left to try is in its tooltip.

## [0.3.0]

### Added

- The versions panel opens upwards when the card is near the bottom of the window.
- **Search Gatherer** on each card (under "Other versions"): looks up, three prints per click, the translations in the preferred language that Gatherer has and Scryfall does not list (the English prints whose set and number Scryfall has no translation of). What it finds is added to the versions panel, which opens. Useful when the only print Scryfall lists in the language is not the one you want, or shows an English image on Gatherer (e.g. *Savage Beating* in Italian).

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
