import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { validateSite, fixtureFetch, run, check, scoreOf, MANIFEST_SCHEMA, SECTION_SCHEMA } from '../src/index.js';

const fx = (d: string) => new URL(`../fixtures/${d}`, import.meta.url).pathname;
const bin = new URL('../src/bin.ts', import.meta.url).pathname;
const cli = (args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', bin, ...args], { encoding: 'utf8' });
const msgs = (r: { errors: { message: string }[] }) => r.errors.map((e) => e.message);

test('A1 passes on lax.kognai.ai and www.kognai.ai (recorded 28 Oct 2026) with a score of 90 or more', async () => {
  for (const [site, n] of [['lax.kognai.ai', 5], ['www.kognai.ai', 6]] as const) {
    const r = await validateSite(`https://${site}`, { fetch: fixtureFetch(fx(site)) });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.ok(r.score >= 90);
    assert.equal(r.manifest_url, `https://${site}/.well-known/aiax.json`);
    assert.equal(r.sections.length, n);
    assert.ok(r.sections.every((s) => s.ok && s.url.startsWith(`https://${site}/aiax/sections/`)));
    const c = cli([`https://${site}`, '--fixtures', fx(site)]);
    assert.equal(c.status, 0, c.stdout + c.stderr);
  }
  // falls back to /aiax/manifest.json, bare host accepted
  const alt = await validateSite('example.com', { fetch: fixtureFetch(fx('alt-manifest-path')) });
  assert.equal(alt.ok, true);
  assert.equal(alt.manifest_url, 'https://example.com/aiax/manifest.json');
  // a path relative url is resolved against the manifest URL, not the site root
  const rel = JSON.parse(readFileSync(fx('alt-manifest-path') + '/aiax/manifest.json', 'utf8'));
  rel.entry_points = rel.entry_points.map((e: { url: string }) => ({ ...e, url: e.url.replace('/aiax/', '') }));
  const seen: string[] = [];
  const relR = await validateSite('https://example.com', {
    fetch: async (u) => { seen.push(u); return u.endsWith('/aiax/manifest.json') ? new Response(JSON.stringify(rel)) : u.endsWith('/.well-known/aiax.json') ? new Response('', { status: 404 }) : fixtureFetch(fx('lax.kognai.ai'))(u); },
  });
  assert.equal(relR.ok, true, JSON.stringify(relR.errors));
  assert.ok(seen.includes('https://example.com/aiax/sections/lax_jobs.json'));
  // the schemas are the AIAX 0.1 ones, unchanged
  assert.equal(MANIFEST_SCHEMA.$id, 'https://raw.githubusercontent.com/Godman-s/aiax/main/schemas/manifest.schema.json');
  assert.equal(SECTION_SCHEMA.$id, 'https://raw.githubusercontent.com/Godman-s/aiax/main/schemas/section.schema.json');
});

test('A2 a broken manifest fails with one clear message per problem naming its field', async () => {
  const r = await validateSite('https://example.com', { fetch: fixtureFetch(fx('broken-manifest')) });
  assert.equal(r.ok, false);
  assert.ok(r.score < 90);
  const m = msgs(r);
  const one = (re: RegExp) => assert.equal(m.filter((x) => re.test(x)).length, 1, `${re} in ${JSON.stringify(m)}`);
  one(/^updated_at is missing \(required\)$/);
  one(/^pricing_summary must be a string or null, not an integer$/);
  one(/^colour is not an allowed field$/);
  one(/^entry_points\[4\]\.id has the wrong form/);
  const paths = r.errors.map((e) => e.path);
  for (const p of ['/updated_at', '/pricing_summary', '/colour', '/entry_points/4/id']) assert.ok(paths.includes(p), p);

  const missing = await validateSite('https://example.com', { fetch: fixtureFetch(fx('missing-manifest')) });
  assert.equal(missing.ok, false);
  assert.equal(missing.score, 0);
  assert.equal(missing.manifest_url, null);
  assert.match(msgs(missing)[0]!, /no AIAX manifest found.*aiax\.json.*404.*manifest\.json.*404/);

  // more manifest shapes, in memory
  const manifest = JSON.parse(readFileSync(fx('lax.kognai.ai') + '/.well-known/aiax.json', 'utf8'));
  const v = (doc: unknown) => check(doc, MANIFEST_SCHEMA).map((i) => i.message);
  assert.deepEqual(v({ ...manifest, aiax_version: '0.2' }), ['aiax_version must be one of "0.1"']);
  assert.deepEqual(v({ ...manifest, entry_points: [] }), ['entry_points needs at least 1 item']);
  assert.deepEqual(v({ ...manifest, product: { ...manifest.product, slogan: 'x' } }), ['product.slogan is not an allowed field']);
  assert.deepEqual(v({ ...manifest, updated_at: 'yesterday' }), ['updated_at is not a valid date-time']);
  assert.deepEqual(v({ ...manifest, trust_signals: { score: 101 } }), ['trust_signals.score must be at most 100']);
  assert.deepEqual(v({ ...manifest, mcp_endpoint: 'not a url' }), ['mcp_endpoint is not a valid uri']);
  assert.deepEqual(v({ ...manifest, product: { ...manifest.product, name: 'x'.repeat(61) } }), ['product.name is too long: at most 60 characters']);
  assert.deepEqual(v([]), ['the document must be an object, not an array']);
  const dup = { ...manifest, entry_points: [manifest.entry_points[0], manifest.entry_points[0]] };
  const dr = await validateSite('https://lax.kognai.ai', {
    fetch: async (u) => (u.endsWith('/.well-known/aiax.json') ? new Response(JSON.stringify(dup)) : fixtureFetch(fx('lax.kognai.ai'))(u)),
  });
  assert.ok(msgs(dr).some((x) => /used twice/.test(x)));
});

test('A3 a broken section fails with clear messages', async () => {
  const r = await validateSite('https://example.com', { fetch: fixtureFetch(fx('broken-sections')) });
  assert.equal(r.ok, false);
  const by = Object.fromEntries(r.sections.map((s) => [s.id, s.errors.map((e) => e.message)]));
  assert.deepEqual(by.lax_offer, ['section "lax_offer" could not be fetched (HTTP 404)']);
  assert.deepEqual(by.lax_search, ['purpose is missing (required)']);
  assert.equal(by.lax_jobs!.length, 1);
  assert.match(by.lax_jobs![0]!, /^pricing\.amount has the wrong form/);
  assert.deepEqual(by.lax_job_submit, ['section_id "lax_submit" differs from its entry point id "lax_job_submit"']);
  assert.deepEqual(by.trust, ['section "trust" is not valid JSON']);
  assert.ok(r.sections.every((s) => !s.ok));
  assert.equal(r.errors.length, 5);

  const section = JSON.parse(readFileSync(fx('lax.kognai.ai') + '/aiax/sections/lax_jobs.json', 'utf8'));
  const v = (doc: unknown) => check(doc, SECTION_SCHEMA).map((i) => i.message);
  assert.deepEqual(v({ ...section, pricing: { ...section.pricing, model: 'per_hour' } }), [
    'pricing.model must be one of "per_call", "per_minute", "per_token", "flat", "free", "subscription"',
  ]);
  assert.deepEqual(v({ ...section, pricing: { model: 'free', amount: '0', currency: 'USDC' } }), ['pricing.rail is missing (required)']);
  assert.deepEqual(v({ ...section, inputs: 5 }), ['inputs must be a JSON Schema object or a short text']);
  assert.deepEqual(v({ ...section, examples: [] }), ['examples needs at least 1 item']);
  assert.deepEqual(v({ ...section, examples: [{ description: 'x', request: 1 }] }), ['examples[0].response is missing (required)']);
  assert.deepEqual(v({ ...section, latency_p50_ms: -1 }), ['latency_p50_ms must be at least 0']);

  // network failure of a section, and a section on another site is a warning
  const net = await validateSite('https://lax.kognai.ai', {
    fetch: async (u) => { if (u.includes('/sections/trust')) throw new Error('ECONNRESET'); return fixtureFetch(fx('lax.kognai.ai'))(u); },
  });
  assert.ok(msgs(net).includes('section "trust" could not be fetched (ECONNRESET)'));
});

test('A3 warnings lower the score without failing', async () => {
  const manifest = JSON.parse(readFileSync(fx('lax.kognai.ai') + '/.well-known/aiax.json', 'utf8'));
  manifest.entry_points[0].est_tokens = 5000;
  manifest.entry_points[1].url = 'https://cdn.example.org/aiax/sections/lax_search.json';
  const r = await validateSite('https://lax.kognai.ai', {
    fetch: async (u) => {
      if (u.endsWith('/.well-known/aiax.json')) return new Response(JSON.stringify(manifest));
      return fixtureFetch(fx('lax.kognai.ai'))(u.replace('cdn.example.org', 'lax.kognai.ai'));
    },
  });
  assert.equal(r.ok, true);
  assert.equal(r.warnings.length, 2);
  assert.equal(r.score, 96);
  assert.equal(scoreOf(0, 0), 100);
  assert.equal(scoreOf(1, 0), 85);
  assert.equal(scoreOf(0, 3), 94);
  assert.equal(scoreOf(10, 0), 0);
});

test('A4 --json prints the report; exit codes 0, 1 and 2', async () => {
  let c = cli(['https://lax.kognai.ai', '--json', '--fixtures', fx('lax.kognai.ai')]);
  assert.equal(c.status, 0);
  const rep = JSON.parse(c.stdout);
  for (const k of ['url', 'manifest_url', 'ok', 'score', 'errors', 'warnings', 'sections']) assert.ok(k in rep, k);
  c = cli(['https://example.com', '--fixtures', fx('broken-sections')]);
  assert.equal(c.status, 1);
  assert.equal(c.stdout.trim().split('\n').filter((l) => l.startsWith('error ')).length, 5, 'one plain line per error');
  c = cli(['https://example.com', '--json', '--fixtures', fx('broken-manifest')]);
  assert.equal(c.status, 1);
  assert.equal(JSON.parse(c.stdout).ok, false);
  for (const bad of [[], ['--fixtures'], ['a', 'b'], ['--wat', 'x'], ['--help']]) assert.equal(cli(bad).status, 2, bad.join(' '));

  // in process, with a stub fetch
  const out: string[] = [];
  const code = await run({ argv: ['https://lax.kognai.ai'], stdout: (s) => out.push(s), stderr: () => {}, fetch: fixtureFetch(fx('lax.kognai.ai')) });
  assert.equal(code, 0);
  assert.match(out.join(''), /^valid: https:\/\/lax\.kognai\.ai score 100/m);
  const bad = await validateSite('http://[bad', { fetch: fixtureFetch(fx('lax.kognai.ai')) });
  assert.equal(bad.ok, false);
  // fixtures never escape their directory
  const esc = await fixtureFetch(fx('lax.kognai.ai'))('https://x/%2e%2e/%2e%2e/package.json');
  assert.notEqual(esc.status, 200);
});

test('A5 broken case fixtures are in the repository and the package has the bin', () => {
  for (const d of ['broken-manifest', 'broken-sections', 'missing-manifest', 'alt-manifest-path', 'lax.kognai.ai', 'www.kognai.ai']) assert.ok(existsSync(fx(d)), d);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.bin['aiax-validate'], 'dist/bin.js');
  assert.ok(pkg.files.includes('schemas') && pkg.files.includes('dist'));
  assert.deepEqual(pkg.dependencies ?? {}, {});
});
