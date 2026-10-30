# History rewrite — 2026-10-30

**Reason:** removed an internal working-notes file (`HANDOFF.md`) from all
history, reworded one sentence in an earlier revision of ADR 0014, and
normalized the author name on every commit to
`Min Htet Myet (Mattral) <mattralminn@gmail.com>`.

Every commit SHA in this repository changed as a result. The final tree is
identical to the pre-rewrite one apart from `HANDOFF.md` being absent, plus
this file and the SHA remap below.

## npm releases

Published npm packages are unaffected — their contents never included git
history and were not republished. Each published version's registry
metadata still records the pre-rewrite `gitHead`; use the tables below to
translate:

- `1.0.0` → `gitHead` `e1044b8` (now `ddd208b`)
- `1.1.0` → `gitHead` `bd86917` (now `2464707`, the `v1.1.0` tag)

## Commit SHAs cited in the docs

| Old | New | Commit |
| --- | --- | --- |
| `bc0fb7dc88f532ace10e5bfd942ffc01edbad3be` | `9285d7b930bd6fe86629bb887236f0b3ed555330` | docs: add PUBLISHING.md and v1.0.0 release notes, update CHANGELOG and README |
| `e1044b88c148983b4d173948ba1962a896520810` | `ddd208b24e8037d9b971df313b09351eb00e9709` | docs: note the npm scope rename in the 1.0.0 changelog entry |

Citations in tracked files were updated to the new SHAs (ADR 0014).

## Tags

| Tag | Old commit | New commit |
| --- | --- | --- |
| `v1.0.0` | `bc0fb7dc88f532ace10e5bfd942ffc01edbad3be` | `9285d7b930bd6fe86629bb887236f0b3ed555330` |
| `v1.1.0` | `bd869178b6e7ada4a89a357c8aba773047632cd3` | `246470702ada4308d96123aab84135eab32b81e7` |

## If you have an old clone

Old clones cannot be pulled or merged into the rewritten history. Delete
them and clone again.
