import { spawn, spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

// Start only a loopback test server; never point the default run at production.
const externalUrl = process.env.ROAMLY_TEST_BASE_URL;
const port = process.env.ROAMLY_TEST_PORT || '4173';
const production = process.argv.includes('--production');
const baseUrl = externalUrl || `http://127.0.0.1:${port}`;
let server;
let logs = '';
let code = 1;
try {
  if (!externalUrl) {
    try { await fetch(baseUrl, { signal: AbortSignal.timeout(1000) }); throw new Error(`Port ${port} is already occupied. Choose ROAMLY_TEST_PORT or supply ROAMLY_TEST_BASE_URL.`); }
    catch (error) { if (error.message.includes('already occupied')) throw error; }
    server = spawn(process.execPath, ['node_modules/vinext/dist/cli.js', production ? 'start' : 'dev', '--hostname', '127.0.0.1', '--port', port], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
      env: { ...process.env, NO_COLOR: '1' },
    });
    server.on('error', (error) => { logs += error.message; });
    for (const stream of [server.stdout, server.stderr]) stream.on('data', (chunk) => { logs = (logs + chunk).slice(-24_000); });
    const deadline = Date.now() + 180_000;
    let ready = false;
    while (Date.now() < deadline && server.exitCode === null) {
      try { ready = (await fetch(baseUrl, { signal: AbortSignal.timeout(5000) })).ok; } catch { /* Server is compiling. */ }
      if (ready) break;
      await delay(500);
    }
    if (!ready) throw new Error('Test server did not become ready.\n' + logs);
  }
  const files = (await readdir('tests/browser')).filter((name) => name.endsWith('.test.mjs') && (production ? name === 'offline-shell.test.mjs' : name !== 'offline-shell.test.mjs')).map((name) => `tests/browser/${name}`);
  const tests = spawn(process.execPath, ['--test', '--test-concurrency=1', ...files], {
    windowsHide: true, stdio: 'inherit', env: { ...process.env, ROAMLY_TEST_BASE_URL: baseUrl, ...(production ? { ROAMLY_TEST_OFFLINE_REQUIRED: '1' } : {}) },
  });
  code = await new Promise((resolve, reject) => { tests.once('error', reject); tests.once('exit', (value) => resolve(value ?? 1)); });
  if (code) process.stderr.write(logs);
} catch (error) { process.stderr.write(String(error) + '\n'); }
finally {
  if (server?.pid) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* Already exited. */ } }
  }
}
process.exitCode = code;
