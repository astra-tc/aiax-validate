import { validateSite, type FetchLike, type Report } from './validate.js';
import { fixtureFetch } from './fixtures.js';

export interface CliIo {
  argv: string[];
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  fetch?: FetchLike;
}

export const USAGE = 'usage: aiax-validate <url> [--json] [--fixtures <dir>]';

export function formatText(r: Report): string {
  const lines = r.errors.map((e) => `error ${e.url}${e.path ? ` ${e.path}` : ''}: ${e.message}`);
  lines.push(...r.warnings.map((w) => `warning ${w.url}${w.path ? ` ${w.path}` : ''}: ${w.message}`));
  lines.push(`${r.ok ? 'valid' : 'invalid'}: ${r.url} score ${r.score} (${r.errors.length} errors, ${r.warnings.length} warnings, ${r.sections.length} sections)`);
  return lines.join('\n') + '\n';
}

/** Returns the exit code: 0 valid, 1 invalid, 2 usage error. */
export async function run(io: CliIo): Promise<number> {
  let url: string | undefined;
  let json = false;
  let fixtures: string | undefined;
  for (let i = 0; i < io.argv.length; i++) {
    const a = io.argv[i]!;
    if (a === '--json') json = true;
    else if (a === '--fixtures') {
      fixtures = io.argv[++i];
      if (!fixtures || fixtures.startsWith('--')) {
        io.stderr(`--fixtures needs a directory\n${USAGE}\n`);
        return 2;
      }
    } else if (a === '-h' || a === '--help') {
      io.stdout(`${USAGE}\n`);
      return 2;
    } else if (a.startsWith('--')) {
      io.stderr(`unknown option ${a}\n${USAGE}\n`);
      return 2;
    } else if (url === undefined) url = a;
    else {
      io.stderr(`only one url is allowed\n${USAGE}\n`);
      return 2;
    }
  }
  if (!url) {
    io.stderr(`missing <url>\n${USAGE}\n`);
    return 2;
  }
  const f = fixtures ? fixtureFetch(fixtures) : io.fetch;
  const report = await validateSite(url, { fetch: f });
  io.stdout(json ? JSON.stringify(report, null, 2) + '\n' : formatText(report));
  return report.ok ? 0 : 1;
}
