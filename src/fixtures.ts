import { readFile } from 'node:fs/promises';
import { join, normalize, sep } from 'node:path';
import type { FetchLike } from './validate.js';

/** A fetch that answers from files: the URL path under dir; a missing file is a 404. Never uses the network. */
export function fixtureFetch(dir: string): FetchLike {
  const root = normalize(dir);
  return async (url: string) => {
    const p = decodeURIComponent(new URL(url).pathname);
    const file = normalize(join(root, p));
    if (!(file === root || file.startsWith(root.endsWith(sep) ? root : root + sep))) return new Response('forbidden', { status: 403 });
    try {
      const body = await readFile(file, 'utf8');
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  };
}
