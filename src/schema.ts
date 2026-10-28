/** A small JSON Schema (2020-12 subset) checker with plain word messages. Covers every keyword the AIAX 0.1 schemas use. */
export interface Issue {
  path: string; // JSON pointer
  message: string;
}

export interface Schema {
  type?: string | string[];
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean | Schema;
  enum?: unknown[];
  pattern?: string;
  maxLength?: number;
  minLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  items?: Schema;
  oneOf?: Schema[];
  format?: string;
  [k: string]: unknown;
}

const esc = (k: string) => k.replace(/~/g, '~0').replace(/\//g, '~1');
export const pointer = (base: string, key: string | number) => `${base}/${esc(String(key))}`;

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function typeMatches(v: unknown, t: string): boolean {
  const actual = typeOf(v);
  if (t === 'number') return actual === 'number' || actual === 'integer';
  return actual === t;
}

const article = (t: string) => (t === 'null' ? 'null' : /^[aeiou]/.test(t) ? `an ${t}` : `a ${t}`);
const fieldName = (path: string) => {
  if (path === '') return 'the document';
  const parts = path.split('/').slice(1).map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  return parts.map((p) => (/^\d+$/.test(p) ? `[${p}]` : p)).join('.').replace(/\.\[/g, '[');
};

function checkFormat(v: string, format: string): boolean {
  if (format === 'uri') {
    try {
      const u = new URL(v);
      return /^[a-z][a-z0-9+.-]*:$/i.test(u.protocol);
    } catch {
      return false;
    }
  }
  if (format === 'uri-reference') return !/\s/.test(v) && v.length > 0;
  if (format === 'date-time') return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i.test(v) && !Number.isNaN(Date.parse(v));
  return true;
}

export function check(value: unknown, schema: Schema, path = ''): Issue[] {
  const out: Issue[] = [];
  const name = fieldName(path);
  if (schema.oneOf) {
    const passing = schema.oneOf.filter((s) => check(value, s, path).length === 0).length;
    if (passing !== 1) {
      const kinds = schema.oneOf.map((s) => String(s.type)).join(' or ');
      out.push({ path, message: `${name} must be ${kinds === 'object or string' ? 'a JSON Schema object or a short text' : kinds}` });
    }
    return out;
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(value, t))) {
      out.push({ path, message: `${name} must be ${types.map(article).join(' or ')}, not ${article(typeOf(value))}` });
      return out;
    }
  }
  if (schema.enum && !schema.enum.some((e) => e === value)) {
    out.push({ path, message: `${name} must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}` });
  }
  if (typeof value === 'string') {
    if (schema.maxLength !== undefined && [...value].length > schema.maxLength)
      out.push({ path, message: `${name} is too long: at most ${schema.maxLength} characters` });
    if (schema.minLength !== undefined && [...value].length < schema.minLength)
      out.push({ path, message: `${name} is too short: at least ${schema.minLength} characters` });
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value))
      out.push({ path, message: `${name} has the wrong form (it must match ${schema.pattern})` });
    if (schema.format && !checkFormat(value, schema.format))
      out.push({ path, message: `${name} is not a valid ${schema.format}` });
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) out.push({ path, message: `${name} must be at least ${schema.minimum}` });
    if (schema.maximum !== undefined && value > schema.maximum) out.push({ path, message: `${name} must be at most ${schema.maximum}` });
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems)
      out.push({ path, message: `${name} needs at least ${schema.minItems} item${schema.minItems === 1 ? '' : 's'}` });
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      out.push({ path, message: `${name} has more than ${schema.maxItems} items` });
    if (schema.items) value.forEach((v, i) => out.push(...check(v, schema.items!, pointer(path, i))));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const r of schema.required ?? []) {
      if (!(r in obj)) out.push({ path: pointer(path, r), message: `${fieldName(pointer(path, r))} is missing (required)` });
    }
    const props = schema.properties ?? {};
    for (const [k, v] of Object.entries(obj)) {
      if (k in props) out.push(...check(v, props[k]!, pointer(path, k)));
      else if (schema.additionalProperties === false)
        out.push({ path: pointer(path, k), message: `${fieldName(pointer(path, k))} is not an allowed field` });
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object')
        out.push(...check(v, schema.additionalProperties, pointer(path, k)));
    }
  }
  return out;
}
