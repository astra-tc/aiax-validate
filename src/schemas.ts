import { readFileSync } from 'node:fs';
import type { Schema } from './schema.js';

const load = (f: string): Schema => JSON.parse(readFileSync(new URL(`../schemas/${f}`, import.meta.url), 'utf8'));
/** AIAX 0.1 schemas, copied unchanged from github.com/Godman-s/aiax/schemas. */
export const MANIFEST_SCHEMA = load('manifest.schema.json');
export const SECTION_SCHEMA = load('section.schema.json');
