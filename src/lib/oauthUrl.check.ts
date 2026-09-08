import * as assert from 'assert';
import { parseRedirect } from './oauthUrl';

const ok = parseRedirect('sterncut://auth#access_token=abc&refresh_token=def&expires_in=3600');
assert.deepStrictEqual(ok, { ok: true, access_token: 'abc', refresh_token: 'def' });

// Expo Go's dev URL carries a path and a port, and the tokens still ride the fragment
assert.strictEqual(parseRedirect('exp://192.168.1.5:8081/--/auth#access_token=a&refresh_token=b').ok, true);

// a refusal in the query string must not read as a session
const denied = parseRedirect('sterncut://auth?error=access_denied&error_description=User%20cancelled');
assert.deepStrictEqual(denied, { ok: false, error: 'User cancelled' });

// fragment errors too, and they win over any half-written token pair
assert.strictEqual(parseRedirect('sterncut://auth#error=server_error&access_token=x').ok, false);

// a bare redirect with nothing on it is a failure, never a blank session
assert.strictEqual(parseRedirect('sterncut://auth').ok, false);
assert.strictEqual(parseRedirect('sterncut://auth#access_token=only').ok, false);

console.log('oauthUrl.check: ok');
