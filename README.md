# aiax-validate

Validate and score any site's AIAX manifest and its sections against the AIAX 0.1 schemas (github.com/Godman-s/aiax, `schemas/manifest.schema.json` and `schemas/section.schema.json`, copied unchanged into `schemas/`). Every failure is explained in plain words that name the field.

Built by an AI agent (Astra Trading Co, LAX offer `lax-ext-87b6301d83cf`) for the LAX bundle "AIAX validator CLI" (814c4f35). MIT licensed, no runtime dependency.

## CLI

```sh
npx aiax-validate https://lax.kognai.ai
npx aiax-validate https://www.kognai.ai --json
npx aiax-validate https://example.com --fixtures fixtures/broken-sections   # offline
```

Exit code 0 when the site is valid, 1 when it is not, 2 on a usage error. Without `--json` it prints one plain line per error (then warnings and a summary line). `--fixtures <dir>` answers every fetch from a file: the URL path under dir (for example `dir/.well-known/aiax.json`); a missing file is a 404, so the tool runs offline.

Example output on a broken site:

```
error https://example.com/aiax/sections/lax_search.json /purpose: purpose is missing (required)
error https://example.com/aiax/sections/lax_job_submit.json /section_id: section_id "lax_submit" differs from its entry point id "lax_job_submit"
error https://example.com/aiax/sections/trust.json: section "trust" is not valid JSON
invalid: https://example.com score 25 (5 errors, 0 warnings, 5 sections)
```

## Library

```ts
import { validateSite } from 'aiax-validate';
const report = await validateSite('https://lax.kognai.ai', { fetch }); // fetch is optional
// { url, manifest_url, ok, score, errors: [{url, path, message}], warnings: [...], sections: [{id, url, ok, errors}] }
```

- The manifest is looked for at `/.well-known/aiax.json`, then `/aiax/manifest.json`.
- Every entry point url is resolved against the manifest URL and fetched.
- Errors: schema failures (missing required field, wrong type, extra field, enum, pattern, length, range, item counts, uri and date-time formats, oneOf), a missing manifest, a section that cannot be fetched or is not JSON, a section whose `section_id` differs from its entry point id, an entry point id used twice.
- Warnings: an `est_tokens` more than 3 times off the measured size, an entry point on another site, a manifest far above the 100 to 300 token target.
- `path` is a JSON pointer into the document.
- `score`: 100 with no error and no warning; each error costs 15 and each warning 2; any error keeps it at 89 or below; no manifest at all is 0.

## Results on the live sites (28 Oct 2026)

| Site | ok | score | sections |
|---|---|---|---|
| lax.kognai.ai | true | 100 | 5 |
| www.kognai.ai | true | 100 | 6 |

The recordings are in `fixtures/lax.kognai.ai` and `fixtures/www.kognai.ai`.

## Fixtures of the broken cases

| Dir | What is broken |
|---|---|
| `fixtures/broken-manifest` | missing `updated_at`, `pricing_summary` of the wrong type, extra field `colour`, entry point id `Trust Score` |
| `fixtures/broken-sections` | missing section, section without `purpose`, bad pricing amount `0,01`, `section_id` different from its entry point, a section that is HTML not JSON |
| `fixtures/missing-manifest` | no manifest at either path |
| `fixtures/alt-manifest-path` | valid, manifest at `/aiax/manifest.json` only |

## Tests

```sh
npm test          # node:test via tsx, no network
npm run mutation  # plants 9 bugs, all caught
```

Tests are named A1 to A5 after the acceptance items: A1 both live recordings valid at 100 plus the fallback path; A2 one message per manifest problem and 8 more manifest shapes; A3 every broken section case, network failures and warnings; A4 `--json`, one line per error and exit codes 0, 1, 2 through the real bin; A5 fixtures and bin present, no runtime dependency.

## Status

M1 and M2 code are complete here. Publishing to npm as `aiax-validate` happens at delivery.
