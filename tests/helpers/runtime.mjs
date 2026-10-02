import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

export function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key), key: (index) => [...data.keys()][index] ?? null,
    get length() { return data.size; },
  };
}

// Execute actual migrations and SQL, including uniqueness, WHERE guards and
// atomic batches. Only Google identity and email/network delivery are mocked.
export function runtime() {
  const sql = new DatabaseSync(':memory:');
  for (const file of readdirSync(path.join(root, 'drizzle')).filter((file) => file.endsWith('.sql')).sort()) {
    sql.exec(readFileSync(path.join(root, 'drizzle', file), 'utf8'));
  }
  const state = { dbCalls: 0, googleCalls: 0, cookie: '', requests: [], emailCalls: [], failEmail: false };
  const db = {
    prepare(query) {
      state.dbCalls++;
      return {
        bind(...args) {
          if (args.length > 100) throw new Error('D1 bound parameter limit exceeded');
          const execute = () => {
            const result = sql.prepare(query).run(...args);
            return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
          };
          return {
            first: async () => sql.prepare(query).get(...args) ?? null,
            all: async () => ({ success: true, results: sql.prepare(query).all(...args) }),
            run: async () => execute(),
            execute,
          };
        },
      };
    },
    batch(statements) {
      if (statements.length > 50) throw new Error('D1 Free per-invocation query limit exceeded');
      sql.exec('BEGIN');
      try {
        const results = statements.map((statement) => statement.execute());
        sql.exec('COMMIT');
        return Promise.resolve(results);
      } catch (error) {
        sql.exec('ROLLBACK');
        return Promise.reject(error);
      }
    },
  };
  const rows = {
    set(id, data) { sql.prepare('INSERT OR REPLACE INTO user_itineraries (user_id, data_json, updated_at) VALUES (?, ?, ?)').run(id, data, 1); },
    get(id) { return sql.prepare('SELECT data_json FROM user_itineraries WHERE user_id = ?').get(id)?.data_json; },
    has(id) { return !!sql.prepare('SELECT 1 FROM user_itineraries WHERE user_id = ?').get(id); },
    delete(id) { sql.prepare('DELETE FROM user_itineraries WHERE user_id = ?').run(id); },
  };
  const accounts = {
    set(id, generation) { sql.prepare('INSERT OR REPLACE INTO user_accounts (user_id, generation) VALUES (?, ?)').run(id, generation); },
    get(id) { return sql.prepare('SELECT generation FROM user_accounts WHERE user_id = ?').get(id)?.generation; },
    has(id) { return !!sql.prepare('SELECT 1 FROM user_accounts WHERE user_id = ?').get(id); },
    delete(id) { sql.prepare('DELETE FROM user_accounts WHERE user_id = ?').run(id); },
  };
  const shares = {
    get size() { return Number(sql.prepare('SELECT COUNT(*) AS total FROM map_shares').get().total); },
    get(id) { return sql.prepare('SELECT * FROM map_shares WHERE share_id = ?').get(id); },
  };
  const context = vm.createContext({
    crypto: webcrypto, Request, Response, Headers, URL, URLSearchParams, structuredClone, TextEncoder, btoa, atob,
    encodeURIComponent, decodeURIComponent, escape, unescape, exports: {},
    process: { env: { GOOGLE_OAUTH_CLIENT_ID: 'test-client', GOOGLE_AUTH_SESSION_SECRET: 'synthetic-test-secret-only' } },
    localStorage: memoryStorage(),
  });
  const cache = new Map();
  function load(relative) {
    const absolute = path.resolve(root, relative);
    if (cache.has(absolute)) return cache.get(absolute);
    const exports = {};
    cache.set(absolute, exports);
    const require = (name) => {
      const target = path.resolve(path.dirname(absolute), name);
      if (target === path.join(root, 'app/api/_lib/db')) return { database: () => db };
      const file = [target + '.ts', target + '.tsx'].find((file) => existsSync(file));
      if (!file) throw new Error('Unexpected module: ' + name);
      return load(file);
    };
    const wrapper = vm.runInContext(`(function(exports, require) { ${compile(readFileSync(absolute, 'utf8'))}\n})`, context);
    wrapper(exports, require);
    return exports;
  }
  context.fetch = async (url, init) => {
    if (String(url).startsWith('https://oauth2.googleapis.com/tokeninfo?')) {
      state.googleCalls++;
      return Response.json({ aud: 'test-client', sub: 'B', email: 'b@example.invalid', email_verified: 'true', exp: String(Math.floor(Date.now() / 1000) + 3600) });
    }
    if (url === 'https://api.resend.com/emails') {
      state.emailCalls.push({ headers: new Headers(init?.headers), body: JSON.parse(String(init?.body ?? '{}')) });
      return Response.json({ id: 'resend-test-id' }, { status: state.failEmail ? 503 : 200 });
    }
    const request = new Request(`https://app.example.invalid${url}`, {
      ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), Cookie: state.cookie, Origin: 'https://app.example.invalid' },
    });
    state.requests.push(request.clone());
    if (new URL(request.url).pathname === '/api/sync') return load('app/api/sync/route.ts')[request.method](request);
    if (url === '/api/shares/import') return load('app/api/shares/import/route.ts').POST(request);
    throw new Error('Unexpected network call: ' + url);
  };
  const auth = load('app/api/_lib/auth.ts');
  const security = load('app/account-storage.ts');
  Object.assign(context, security);
  return { context, state, rows, accounts, shares, db, sql, auth, security, load };
}
