# Self-hosted webfonts

These files are loaded with `next/font/local` from `src/app/layout.tsx` (staff app) and
`src/lib/fonts/guest.ts` (guest pages). They are committed so that `next build` has no
network dependency: `next/font/google` fetched its CSS from Google Fonts on every cold
build, and that fetch failing was failing builds. `tests/guards/font-self-hosting.test.ts`
stops the Google loader coming back.

Emails and PDFs do not use these files; they load their own fonts.

## Files

Each file is the unmodified `latin` subset served by Google Fonts on 2 October 2026, byte
for byte the file the previous Google loader build shipped (checked against the files the
live site was serving that day).

| File | Family | Weights | Google Fonts version | SHA-256 |
|---|---|---|---|---|
| `inter-latin.woff2` | Inter (variable) | 400 to 800 | v20 | `c940764593d0fe5d596be327ca7558855e018039fb78509aa21921fd3644c3e4` |
| `jetbrains-mono-latin.woff2` | JetBrains Mono (variable) | 400 to 600 | v24 | `2c32b9b3ee358c119e210f6f5195f9bd34894d78a785ff2e95d60e718e400af4` |
| `dm-serif-display-latin.woff2` | DM Serif Display | 400 | v17 | `f273cf2c9ce9bc7d6b0f4fcb8aee72f8cf5a249991308b6a144217e0760c5d3f` |
| `outfit-latin.woff2` | Outfit (variable) | 400 to 700 | v15 | `92684e4acde79ef07758cd09380b7e01e9824d8b061eddeda046f78c166d7b12` |
| `clicker-script-latin.woff2` | Clicker Script | 400 | v14 | `a4ad9ff4d187006b631c221fc165334394305d45cc964e8080a4743e69e98c82` |

## Latin only

The `latin` subset covers English, Western European accents (é, ñ, ü and so on), the
pound and euro signs and general punctuation. A character outside it (for example Polish
ł, or Greek or Cyrillic letters) is drawn in the system fallback font. The Google loader
also shipped the other subsets and browsers fetched them on demand; to restore one, add
its file here and load it as a second font with a `unicode-range` declaration.

## Licences

All five families are under the SIL Open Font License 1.1, which allows the fonts to be
bundled and redistributed with software as long as the copyright notice and licence
travel with them. The `OFL-*.txt` files are those notices, copied unchanged from
`github.com/google/fonts` (`ofl/<family>/OFL.txt`). Keep each one beside its font.

## Updating a font

Request the family from `https://fonts.googleapis.com/css2` with a desktop Chrome user
agent, download the `woff2` under the `/* latin */` comment, replace the file here and
update the table. Then compare a page before and after: a new upstream version can change
glyph shapes and metrics.
