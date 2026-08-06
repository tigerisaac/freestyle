# @freestyle-voice/writing-skills

Vendored third-party writing expertise for Remix, as **pure data**. Consumed
identically by the desktop's local/BYOK server and by Freestyle Cloud, which is
the point: both must assemble the same prompt from the same bytes.

## What is here

| Path | What it is |
| --- | --- |
| `manifest.ts` | The reviewed allowlist. Nothing is vendored that is not named here. |
| `scripts/import-skills.ts` | The importer. Run by hand, never at build time. |
| `vendor/` | Verbatim upstream copies plus licences. Generated. |
| `upstream-lock.json` | Per-file hashes and the bundle hash. Generated. |
| `src/generated/bundle.ts` | The skill text, embedded. Generated. |
| `src/router.ts` | The deterministic scorer — no extra model round trip. |
| `src/loader.ts` | Progressive disclosure and the per-request word budget. |

Generated files are committed so a checkout builds without network access, and
so upgrades show up as reviewable diffs.

## Updating a skill

Upgrades are manual, and deliberately so — a dependency that updates itself is
a dependency nobody reviewed.

1. Bump the `commit` for that source in `manifest.ts`.
2. `pnpm --filter @freestyle-voice/writing-skills import`
3. Read the diff in `vendor/`. That is the review.
4. Run the tests. `BUNDLE_HASH` will change; that is expected and is what CI
   compares across the two repos.

## The trust boundary

Reputable upstreams are still untrusted dependencies. The importer refuses
remote links, `file://` and absolute references, paths escaping the skill
directory, and executable shell blocks; it ignores upstream `allowed-tools`
and similar agent-runtime frontmatter; and it verifies each repository's
licence against what the manifest claims. Nothing in `vendor/` is ever
executed, imported, or resolved as a path.

At runtime, skill text is wrapped before it reaches the model and declared
subordinate to the user's instruction, the target rules, and tool permissions.
A skill advises on how to write. It cannot authorise an action, widen scope,
add a step, or change where output goes.

See `specs/remix-writing-skills.md` §5.3 and §6.7.
