# JSON Schemas

Every dataset in `/data` must validate against a schema here before it is committed.

Sessions 2+ add one schema per dataset (law sections, pay matrix, allowances, holidays, glossary…), wired
into `pnpm check` via a `data:validate` script and enforced in CI with `jsonschema` (Python 3.12).

Required of every data record, per CLAUDE.md:

- `source: { name, url }` and `fetchedAt` on every fact
- bilingual values as `{ en, hi }` objects, never flat strings
- `verify: true` where a figure could not be confirmed against an official order
