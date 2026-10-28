import { check, pointer, type Issue } from './schema.js';
import { MANIFEST_SCHEMA, SECTION_SCHEMA } from './schemas.js';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface Finding {
  url: string;
  path: string;
  message: string;
}
export interface SectionReport {
  id: string;
  url: string;
  ok: boolean;
  errors: Finding[];
}
export interface Report {
  url: string;
  manifest_url: string | null;
  ok: boolean;
  score: number;
  errors: Finding[];
  warnings: Finding[];
  sections: SectionReport[];
}

export const MANIFEST_PATHS = ['/.well-known/aiax.json', '/aiax/manifest.json'];
export const ERROR_COST = 15;
export const WARNING_COST = 2;

/** 100 with no error and no warning; each error costs 15 and each warning 2; any error keeps it under 90. */
export function scoreOf(errors: number, warnings: number): number {
  const raw = 100 - ERROR_COST * errors - WARNING_COST * warnings;
  return Math.max(0, errors > 0 ? Math.min(raw, 89) : raw);
}

type Got = { ok: true; json: unknown; bytes: number } | { ok: false; reason: string };

async function getJson(f: FetchLike, url: string): Promise<Got> {
  let res: Response;
  try {
    res = await f(url, { headers: { accept: 'application/json' } });
  } catch (e) {
    return { ok: false, reason: `could not be fetched (${e instanceof Error ? e.message : 'network error'})` };
  }
  if (!res.ok) return { ok: false, reason: `could not be fetched (HTTP ${res.status})` };
  let text: string;
  try {
    text = await res.text();
  } catch {
    return { ok: false, reason: 'could not be read' };
  }
  try {
    return { ok: true, json: JSON.parse(text), bytes: text.length };
  } catch {
    return { ok: false, reason: 'is not valid JSON' };
  }
}

function siteOrigin(input: string): string {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  return new URL(withScheme).origin;
}

export async function validateSite(url: string, opts: { fetch?: FetchLike } = {}): Promise<Report> {
  const f: FetchLike = opts.fetch ?? ((u, i) => globalThis.fetch(u, i));
  const report: Report = { url, manifest_url: null, ok: false, score: 0, errors: [], warnings: [], sections: [] };
  const finish = () => {
    report.ok = report.errors.length === 0;
    report.score = scoreOf(report.errors.length, report.warnings.length);
    return report;
  };
  let origin: string;
  try {
    origin = siteOrigin(url);
  } catch {
    report.errors.push({ url, path: '', message: `${url} is not a valid site URL` });
    return finish();
  }

  let manifest: unknown;
  let tried: string[] = [];
  for (const p of MANIFEST_PATHS) {
    const mu = origin + p;
    const got = await getJson(f, mu);
    if (got.ok) {
      report.manifest_url = mu;
      manifest = got.json;
      if (got.bytes / 4 > 600)
        report.warnings.push({ url: mu, path: '', message: `the manifest is about ${Math.round(got.bytes / 4)} tokens; AIAX targets 100 to 300` });
      break;
    }
    tried.push(`${mu} ${got.reason}`);
  }
  if (report.manifest_url === null) {
    report.errors.push({ url: origin + MANIFEST_PATHS[0], path: '', message: `no AIAX manifest found: ${tried.join('; ')}` });
    finish();
    report.score = 0; // nothing to score without a manifest
    return report;
  }
  const murl = report.manifest_url;
  const mIssues = check(manifest, MANIFEST_SCHEMA);
  report.errors.push(...mIssues.map((i: Issue) => ({ url: murl, ...i })));

  const eps = (manifest as { entry_points?: unknown })?.entry_points;
  if (!Array.isArray(eps)) return finish();
  const seen = new Set<string>();
  for (let i = 0; i < eps.length; i++) {
    const ep = eps[i] as { id?: unknown; url?: unknown; est_tokens?: unknown } | null;
    if (!ep || typeof ep !== 'object' || typeof ep.url !== 'string' || typeof ep.id !== 'string') continue; // already reported by the schema
    const epPath = pointer('/entry_points', i);
    if (seen.has(ep.id)) report.errors.push({ url: murl, path: pointer(epPath, 'id'), message: `entry_points[${i}].id "${ep.id}" is used twice` });
    seen.add(ep.id);
    let surl: string;
    try {
      surl = new URL(ep.url, murl).toString();
    } catch {
      continue;
    }
    if (new URL(surl).origin !== new URL(murl).origin)
      report.warnings.push({ url: murl, path: pointer(epPath, 'url'), message: `entry_points[${i}].url points to another site (${new URL(surl).host})` });
    const sec: SectionReport = { id: ep.id, url: surl, ok: false, errors: [] };
    const got = await getJson(f, surl);
    if (!got.ok) {
      sec.errors.push({ url: surl, path: '', message: `section "${ep.id}" ${got.reason}` });
    } else {
      sec.errors.push(...check(got.json, SECTION_SCHEMA).map((x) => ({ url: surl, ...x })));
      const sid = (got.json as { section_id?: unknown })?.section_id;
      if (typeof sid === 'string' && sid !== ep.id)
        sec.errors.push({ url: surl, path: '/section_id', message: `section_id "${sid}" differs from its entry point id "${ep.id}"` });
      if (typeof ep.est_tokens === 'number') {
        const measured = Math.round(got.bytes / 4);
        if (measured > ep.est_tokens * 3 || measured * 3 < ep.est_tokens)
          report.warnings.push({ url: murl, path: pointer(epPath, 'est_tokens'), message: `entry_points[${i}].est_tokens is ${ep.est_tokens} but the section is about ${measured} tokens` });
      }
    }
    sec.ok = sec.errors.length === 0;
    report.sections.push(sec);
    report.errors.push(...sec.errors);
  }
  return finish();
}
