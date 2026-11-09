# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
