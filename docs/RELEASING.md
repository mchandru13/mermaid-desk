# Releasing MermaidDesk

This is the complete release procedure. It exists so a release is a checklist, not
a memory test: the version, the changelog and the published notes cannot drift
apart, and the workflow refuses to publish quietly incomplete history.

## How a release is assembled

```
tag vX.Y.Z  ->  build.yml
                  |- windows-latest  -> nsis + msi
                  |- macos-latest    -> dmg + .app.tar.gz
                  |- ubuntu-22.04    -> deb + AppImage
                  `- first job creates a DRAFT release whose body is the
                     CHANGELOG.md section for X.Y.Z; all jobs attach assets
                -> final job hashes the assets, uploads SHA256SUMS.txt and
                   appends a checksums block to the body
                -> you inspect the draft and publish it
```

The release stays a **draft** on purpose: a human checks the notes and asset list
before anyone can download a build. Flip `releaseDraft: false` in
`.github/workflows/build.yml` if you ever want it to publish itself.

## Version files

The same version lives in four places. `scripts/set-version.mjs` edits all of them
without reformatting the files:

| File | Field |
| --- | --- |
| `package.json` | top-level `version` |
| `src-tauri/tauri.conf.json` | `version` (the bundle version) |
| `src-tauri/Cargo.toml` | `[package] version` |
| `src-tauri/Cargo.lock` | the `mermaid-desk` package entry |

Cargo would rewrite `Cargo.lock` on the next build anyway; the script keeps the
commit correct so `--check` stays meaningful.

## Steps

### 0. Start from a green `main`

```bash
git switch main
git pull
gh run list --workflow ci.yml --limit 1      # must be completed / success
git status --short                           # must be empty
```

### 1. Bump the version

```bash
node scripts/set-version.mjs 1.0.1
```

Use semantic versioning: **patch** for fixes, **minor** for backwards-compatible
features, **major** for anything that breaks existing files or settings.

### 2. Write the changelog entry

Edit `CHANGELOG.md`:

- Move the useful items out of `## [Unreleased]` (leave it saying "Nothing yet.").
- Add a heading with the exact format the extractor expects:

  ```markdown
  ## [1.0.1] - 2026-11-21
  ```

- Keep the `### Added` / `### Changed` / `### Fixed` / `### Security` categories.
- Write for users, not for `git log`: no commit hashes, no "refactor X".

The extractor stops at the next `## ` heading, so anything below the section is not
part of the release body.

### 3. Preview the release notes

```bash
node scripts/release-notes.mjs v1.0.1
```

This is the exact text GitHub will publish. If it prints an error, the changelog
heading is missing or misspelled — fix that before tagging.

### 4. Commit, tag, push

```bash
git add CHANGELOG.md package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "Release 1.0.1"
git tag -a v1.0.1 -m "MermaidDesk 1.0.1"
git push origin main
git push origin v1.0.1
```

Push `main` first: the tag then points at a commit that is already on the branch.

### 5. Watch the build

```bash
gh run watch "$(gh run list --workflow build.yml --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
```

Each OS job runs two guards before it spends time building:

- `node scripts/set-version.mjs --check --tag v1.0.1` — the tag must equal the
  version in all four files. A failure reads like
  `package.json is 1.0.0, but the tag is v1.0.1`.
- `node scripts/release-notes.mjs v1.0.1` — the changelog must contain that section.
  A failure reads like `CHANGELOG.md has no "## [1.0.1]" section`.

Both fail in seconds, before any asset exists.

### 6. Inspect the draft

```bash
gh release view v1.0.1
```

Check four things:

1. The body starts with the changelog section for this version.
2. **The body ends with a `### Checksums` block** and `SHA256SUMS.txt` is an asset.
   The block is generated from the attached files, so it can be verified directly.
3. Seven assets are present: `.exe`, `.msi`, `.dmg`, `.app.tar.gz`, `.deb`,
   `.AppImage`, `SHA256SUMS.txt`.
4. `draft` is `true` and the tag matches the version.

To verify a download against the published list:

```bash
gh release download v1.1.0 --dir assets
cd assets && sha256sum -c SHA256SUMS.txt
```

### 7. Publish

```bash
gh release edit v1.0.1 --draft=false
```

### 8. Optionally prove the artifact

The honest check is to install what users will download, not what you built
locally:

```powershell
gh release download v1.0.1 -p "*x64-setup.exe" -D $env:TEMP\release-check
```

Then install it and open a diagram. Record the run in `docs/VERIFICATION.md`.

## Changelog format

```markdown
## [Unreleased]

Nothing yet.

## [1.0.1] - 2026-11-21

### Fixed

- ...
```

Rules the tooling relies on:

- Version headings are `## [x.y.z]`, one per version, newest first.
- `Unreleased` is always present, even when empty, so the next change has a home.
- No duplicate version headings (a test enforces this).
- The current `package.json` version must have a section (a test enforces this).

## If something goes wrong

**Wrong notes, draft not published.** Edit the changelog, commit, then replace the
body:

```bash
node scripts/release-notes.mjs v1.0.1 --out release-notes.md
gh release edit v1.0.1 --notes-file release-notes.md
```

**Build failed, draft not published.** Delete it and its tag, fix, then start again
from step 1 with the same version:

```bash
gh release delete v1.0.1 --yes --cleanup-tag
git tag -d v1.0.1 2>/dev/null || true
```

**Tag pushed with the wrong version or notes, nothing published yet.** Move the tag
only while no release is public:

```bash
git push origin :refs/tags/v1.0.1
git tag -d v1.0.1
# fix, commit, then retag
```

**Already published.** Never move a published tag — users and caches may already
have it. Ship a patch release instead.

**Manual build without a release.** `gh workflow run build.yml --ref main` builds the
three platforms and uploads workflow artifacts; it creates no release and needs no
version guard.

## Do not

- Tag from a dirty tree or a commit that is not on `main`.
- Bump the version without adding the changelog section — the workflow will stop.
- Reuse a published version number.
- Edit a release body on GitHub without changing `CHANGELOG.md`; the next reader
  will believe the repository, and it will be wrong.
