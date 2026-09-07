// Walk one settlement week end to end against the REAL database, as the three
// people who touch the money: ops cuts and releases, an agent collects and
// drops, an owner proves the handover with his code.
//
// This is not a test. It writes: it cuts a run, plans visits, moves cash and
// releases lines. Point it at a staging project, or run it on a Friday you
// were going to cut anyway. It refuses to start without --confirm.
//
//   node scripts/dryrun-settlement.mjs --confirm
//
// Needs, in .env or the environment:
//   EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY
//   DRY_ADMIN_EMAIL / DRY_ADMIN_PASSWORD   (profiles.role = 'admin')
//   DRY_AGENT_EMAIL / DRY_AGENT_PASSWORD   (profiles.role = 'agent')
//   DRY_OWNER_EMAIL / DRY_OWNER_PASSWORD   (owns a salon with money owed)
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

// ponytail: five lines instead of dotenv — it is one file, one shape
let envLines = [];
try { envLines = readFileSync('.env', 'utf8').split(/\r?\n/); } catch { /* no .env, use the environment */ }
for (const line of envLines) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}

const confirmed = process.argv.includes('--confirm') || process.env.DRY_CONFIRM === '1';
if (!confirmed) {
  console.error('This WRITES to the database it points at:\n'
    + `  ${process.env.EXPO_PUBLIC_SUPABASE_URL ?? '(no url)'}\n\n`
    + 'It cuts a settlement run, plans visits, moves cash and releases lines.\n'
    + 'Re-run with --confirm (or DRY_CONFIRM=1) if that is what you want.');
  process.exit(2);
}

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!URL || !KEY) { console.error('Missing EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY'); process.exit(2); }

const dh = (c) => `${(Math.abs(c ?? 0) / 100).toFixed(0)} DH`;
const cut = (v, n) => JSON.stringify(v ?? null).slice(0, n);
let step = 0;
const say = (msg) => console.log(`\n${String(++step).padStart(2, '0')}  ${msg}`);
const note = (msg) => console.log(`      ${msg}`);

const fails = [];
function check(ok, what) {
  console.log(`      ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!ok) fails.push(what);
}

async function signIn(who) {
  const email = process.env[`DRY_${who}_EMAIL`];
  const password = process.env[`DRY_${who}_PASSWORD`];
  if (!email || !password) throw new Error(`Missing DRY_${who}_EMAIL / DRY_${who}_PASSWORD`);
  const db = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`${who.toLowerCase()} sign-in: ${error.message}`);
  return db;
}

// Every RPC here is a transaction boundary, and a refusal is often the point
// of the run rather than a crash — so print it, record it, and keep walking.
async function rpc(db, fn, args, { fatal = true, quiet = false } = {}) {
  const { data, error } = await db.rpc(fn, args ?? {});
  if (error) {
    if (!quiet) {
      console.log(`      FAIL  ${fn}: ${error.message}`);
      fails.push(`${fn}: ${error.message}`);
    }
    if (fatal) throw new Error(`stopped at ${fn}`);
    return null;
  }
  return data;
}

// a refusal we WANT: run it quietly, and assert it did refuse
async function refuses(db, fn, args, what) {
  const out = await rpc(db, fn, args, { fatal: false, quiet: true });
  check(out === null, what);
}

const bagOf = (b) => (typeof b === 'number' ? b : b?.cents ?? b?.bag_cents ?? 0);

async function main() {
  say('signing the three of them in');
  const [admin, agent, owner] = await Promise.all([signIn('ADMIN'), signIn('AGENT'), signIn('OWNER')]);
  note('admin · agent · owner');

  say('admin_cut_run — close the week at the Friday 21:00 cut');
  const run0 = await rpc(admin, 'admin_cut_run');
  const runId = run0?.run ?? run0?.id ?? run0;
  note(cut(run0, 300));
  check(!!runId, 'the cut produced a run id');

  say('admin_run — what the week owes');
  const run = await rpc(admin, 'admin_run', { p_run: runId });
  const lines = run?.lines ?? [];
  note(`${lines.length} line(s)`);
  for (const l of lines.slice(0, 8)) {
    note(`  ${l.salon ?? l.salon_id} ${dh(l.amount_cents)}`
      + ` ${l.amount_cents < 0 ? '(we owe him)' : '(he owes us)'}`);
  }
  check(lines.length > 0, 'the run has at least one line to work');

  say('admin_agents — who can be given a round');
  const agents = await rpc(admin, 'admin_agents');
  note(cut(agents, 300));
  const { data: me } = await agent.auth.getUser();
  const agentId = me?.user?.id;
  check(!!agentId && JSON.stringify(agents ?? []).includes(agentId),
    'the DRY_AGENT account shows up as an agent (is profiles.role = agent?)');

  say('admin_plan_visits — turn the lines into a round');
  note(cut(await rpc(admin, 'admin_plan_visits', { p_run: runId, p_agent: agentId }), 300));

  say('agent_visits — what the agent sees');
  const round = await rpc(agent, 'agent_visits');
  const visits = round?.visits ?? [];
  note(`bag ${dh(bagOf(round?.bag))} · ${visits.length} visit(s)`);
  for (const v of visits.slice(0, 8)) {
    note(`  ${v.direction} ${v.salon ?? v.salon_id} ${dh(v.amount_cents)}`);
  }
  check(visits.length > 0, 'the agent was actually given visits');

  const collect = visits.find((v) => v.direction === 'collect');
  const payOut = visits.find((v) => v.direction === 'pay_out');

  if (collect) {
    say(`my_visit_code — the owner reads his 4 digits (${collect.salon ?? collect.salon_id})`);
    const code = await rpc(owner, 'my_visit_code', {}, { fatal: false });
    note(cut(code, 300));
    check(!!code?.code, 'the owner has a live code to read out');
    check(code?.visit === collect.id,
      'the code belongs to the visit on this round (same shop as DRY_OWNER?)');

    if (code?.code) {
      say('agent_collect — the money moves, and only the code moves it');
      await refuses(agent, 'agent_collect',
        { p_visit: collect.id, p_cents: Math.abs(collect.amount_cents), p_code: '0000' },
        'a wrong code is refused');

      const got = await rpc(agent, 'agent_collect',
        { p_visit: collect.id, p_cents: Math.abs(collect.amount_cents), p_code: code.code,
          p_device: 'dryrun' }, { fatal: false });
      note(cut(got, 300));
      check(!!got, 'the right code collects');

      const bag = await rpc(agent, 'agent_bag', {}, { fatal: false });
      note(`bag now ${dh(bagOf(bag))}`);
      check(bagOf(bag) > 0, 'the cash is on the agent, not in mid-air');

      const status = await rpc(owner, 'my_visit_status', {}, { fatal: false });
      note(cut(status, 300));
      check(!!status, 'the owner can see his own proof of what was taken');
    }
  } else {
    note('no collection on this round — skipping the code / collect / proof leg');
  }

  if (payOut) {
    say(`agent_hand_over — paying a shop we owe (${payOut.salon ?? payOut.salon_id})`);
    await refuses(agent, 'agent_hand_over', { p_visit: payOut.id, p_signature: '  ' },
      'no signature, no hand-over');
    const handed = await rpc(agent, 'agent_hand_over',
      { p_visit: payOut.id, p_signature: 'dryrun', p_device: 'dryrun' }, { fatal: false });
    note(cut(handed, 300));
    check(!!handed, 'a signed hand-over goes through');
  } else {
    note('nothing to pay out this week — skipping the hand-over leg');
  }

  const carrying = bagOf(await rpc(agent, 'agent_bag', {}, { fatal: false }));
  if (carrying > 0) {
    say(`agent_drop — ${dh(carrying)} back to the office`);
    note(cut(await rpc(agent, 'agent_drop', { p_cents: carrying, p_note: 'dry run' },
      { fatal: false }), 300));
    const after = bagOf(await rpc(agent, 'agent_bag', {}, { fatal: false }));
    check(after === 0, 'the bag is empty after the drop');
  }

  say('admin_run_progress / admin_run_proof — what ops can see');
  note(cut(await rpc(admin, 'admin_run_progress', { p_run: runId }, { fatal: false }), 400));
  const proof = await rpc(admin, 'admin_run_proof', { p_run: runId }, { fatal: false });
  note(cut(proof, 400));
  check(!!proof, 'ops sees the receipts behind the round');

  say('admin_release_run — refuses while anything is out of balance');
  const released = await rpc(admin, 'admin_release_run', { p_run: runId }, { fatal: false });
  note(cut(released, 300));
  if (!released) note('^ if it named a shop, that is the balance check working, not a bug');

  say('my_statement — the owner reads his own week');
  const stmt = await rpc(owner, 'my_statement', {}, { fatal: false });
  note(cut(stmt, 500));
  check(!!stmt, 'the owner gets a statement');

  console.log(`\n${'-'.repeat(62)}`);
  if (fails.length) {
    console.log(`${fails.length} problem(s):`);
    for (const f of fails) console.log(`  · ${f}`);
    process.exit(1);
  }
  console.log('the whole week walked, end to end, with no complaints.');
}

main().catch((e) => {
  console.error(`\nstopped: ${e.message}`);
  if (fails.length) { console.error('after:'); for (const f of fails) console.error(`  · ${f}`); }
  process.exit(1);
});
