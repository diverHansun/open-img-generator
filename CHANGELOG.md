# Changelog

All notable user-facing changes are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-10-20

### Added

- Favoriting a remote result first saves the original image into local managed storage; when the server cannot download it, the browser relays the bytes instead.
- Sessions can be deleted, and creating a new session no longer piles up unnamed empty sessions.
- App logo, macOS app icon, provider logos, and bilingual (English/Chinese) READMEs.

### Changed

- Redesigned light workspace: unified editor and live canvas in the generation workbench, simpler layout, refined theme and motion.
- Favorite feedback is unified across gallery, generation, and detail views, with clearer guidance on where web downloads are saved.
- Desktop data now lives in `~/Library/Application Support/open-img-generator/data/` (development builds use `open-img-generator-dev`), with Chromium files kept in a separate `browser/` folder. Data from the earlier `open image generator` folder is not migrated.
- The desktop development shell builds into `.next-desktop/`, so it can run alongside the web `npm run dev`.
- The project now uses npm only; the stale pnpm lockfile is removed and the install-script allowlist moved to `allowScripts` in `package.json`.

### Fixed

- The desktop log (`desktop.log`) is now size-bounded and rotated like `app.jsonl`.
- Database migration and local development now reject unsupported Node.js runtimes with a clear message.
- Closed review gaps in favorite persistence.

## [0.1.0] - 2026-07-22

### Added

- Local-first multi-provider image generation, project/session history, favorites, and browser downloads.
- Settings for image retention, local generated-image usage, completed-project export, and application information.
- Apache-2.0 licensing.

### Fixed

- Settings storage sizes now use the correct byte units.
