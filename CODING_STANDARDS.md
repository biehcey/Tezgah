# Coding standards

Read during review. Mechanical rules (core's import ban, unused vars) live in `eslint.config.js` and the pre-commit hook; this file holds only the judgement calls a linter can't make. `CLAUDE.md`'s "Değişmez kurallar" apply on top and outrank everything here.

## Pure logic lives in `src/core`

Any rule that decides *what* happens (merging pages, a row limit, building SQL, choosing keyset vs OFFSET, parsing a request body) belongs in a `src/core` module with a table-style unit test, even when only one component or endpoint calls it. Components and endpoints wire state and I/O around it. Flag logic written inline in a `.tsx` component or a `src/server` handler, and core parsers with no direct unit test.

## Reuse server helpers before writing a new one

Shared endpoint pieces live in `src/server/havuzlar.ts`: `RAW_TYPES`, `catalogQuery`, `TargetError`, and the 502 body for target errors. A new endpoint that redefines one of these, or copies a block from a sibling endpoint, is a finding: point at the helper, or ask for the copy to be moved there.

## SQL that the fake Postgres cannot judge

`src/server/test/sahte-postgres.ts` answers by matching query text; it never parses SQL. Any new or changed SQL string sent to Postgres needs a `describePg` test that runs it against a real server (`npm run test:pg`). Flag SQL changes covered only by fake-server tests.

## A spec deviation is closed in the spec

When the diff departs from `.scratch/<feature>/spec.md` (an API field, a contract, a behaviour), the same change rewrites the spec line. A deviation that is only described in the PR or hand-back is a finding.
