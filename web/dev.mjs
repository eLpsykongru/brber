// Local preview of the queue page — no framework, nothing to install:
//
//   npm run queue-web                → the real database, from .env (0110 and 0111 applied)
//   npm run queue-web -- --fixture   → the drawn Le Fade day and a make-believe
//                                      database: codes print here instead of texting
//
// Past QL-03 the real database needs SUPABASE_SERVICE_ROLE_KEY in .env. Never
// give it an EXPO_PUBLIC_ name — that would build it into the app.
// Open the printed address on a phone on the same Wi-Fi to see it at real size.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fixtureRpc } from './fixtures/rpc.js';
import { handle } from './src/handler.js';

const useFixture = process.argv.includes('--fixture');
const port = Number(process.env.PORT) || 8788;
const env = useFixture ? {} : fromDotEnv();
const deps = {
  ...(useFixture ? { rpc: fixtureRpc() } : {}),
  // the limits count per address, so the preview passes the real one along
  clientIp: (request) => request.headers.get('x-dev-ip'),
};

function fromDotEnv() {
  const vars = {};
  try {
    for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) vars[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    // no .env — said below
  }
  if (!vars.EXPO_PUBLIC_SUPABASE_URL || !vars.EXPO_PUBLIC_SUPABASE_ANON_KEY) {
    console.error('No EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY in .env.'
      + ' Run with --fixture to preview without a database.');
    process.exit(1);
  }
  if (!vars.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('No SUPABASE_SERVICE_ROLE_KEY in .env: the pages will show, but taking a ticket will not work.');
  }
  return {
    SUPABASE_URL: vars.EXPO_PUBLIC_SUPABASE_URL,
    SUPABASE_ANON_KEY: vars.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: vars.SUPABASE_SERVICE_ROLE_KEY,
  };
}

createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const headers = { accept: req.headers.accept || '*/*', 'x-dev-ip': req.socket.remoteAddress || '' };
    if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const request = new Request(new URL(req.url, `http://${req.headers.host || `localhost:${port}`}`), {
      method: req.method,
      headers,
      body: hasBody ? Buffer.concat(chunks) : undefined,
    });
    const response = await handle(request, env, deps);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('The preview server failed — see the terminal.');
  }
}).listen(port, () => {
  console.log(`Queue page on http://localhost:${port}/q/${useFixture ? 'LF7K2M' : '<shop code>'}`);
  if (useFixture) console.log('  one chair: /q/LF7K2M?b=Y4SF    line closed: /q/LF9P3C');
});
