# Release and versioning

The MVP remains **v0.1.0**. `package.json` is the single source of truth for the application version: the Web About page reads it directly, and the future Electron package must use the same value.

## Version policy

- Use Semantic Versioning.
- While the product is in `0.x`, use `patch` for fixes and `minor` for user-visible feature batches. Keep breaking changes for a planned minor release and document them clearly.
- Record development work under `## [Unreleased]` in `CHANGELOG.md`. A version is changed only when a releasable batch is cut, not for every commit.

## Cutting a release

1. Move the relevant `Unreleased` notes into a dated `## [x.y.z]` section.
2. Run `npm version x.y.z --no-git-tag-version`; this updates `package.json` and `package-lock.json` together.
3. Run `npm run release:check`.
4. Commit the release files and create the matching annotated tag: `git tag -a vx.y.z -m "Release vx.y.z"`.

`npm run version:check` fails when the SemVer value, lockfile root version, or most recent released changelog entry diverge. This prevents the About page and packaged application from silently reporting an old version.
