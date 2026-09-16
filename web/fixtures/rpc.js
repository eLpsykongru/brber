// A stand-in for the database, for the local preview and the checks: the drawn
// Le Fade day from queue.json, and 0111/0115's guest calls kept in memory,
// answering in the same shapes. Texts print instead of sending. Design data,
// never shown to a customer — and not a second copy of the rules to trust: the
// migrations' functions are the rules.
import { readFileSync } from 'node:fs';

const HOLD_MS = 5 * 60_000;
const BLOCK_MS = 15 * 60_000;
const CALL_MS = 8 * 60_000;    // 0116: the chair hold QL-13 counts down
const MORE_MS = 5 * 60_000;    // …and the five minutes he may ask for, once
const IN_CHAIR = { Y4SF: { label: 'Mehdi K.', no: 4 } };

export function fixtureRpc({ print = (line) => console.log(line) } = {}) {
  const shops = JSON.parse(readFileSync(new URL('./queue.json', import.meta.url), 'utf8'));
  const sessions = new Map();
  const tickets = new Map();
  const outbox = [];
  const misses = new Map();   // phone → times of wrong codes
  const locks = new Map();    // phone → when three wrong codes locked it

  const token = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const iso = (ms) => new Date(ms).toISOString();
  const phoneOf = (raw) => {
    const m = String(raw ?? '').replace(/\D/g, '').match(/^(?:00212|212|0)?([67]\d{8})$/);
    return m ? `+212${m[1]}` : null;
  };
  const shopOf = (code) => shops[String(code ?? '').toUpperCase()] ?? null;
  const chairOf = (shop, code) => shop?.chairs.find((c) => c.code === String(code ?? '').toUpperCase()) ?? null;
  const missesNow = (phone) => (misses.get(phone) ?? []).filter((at) => at > Date.now() - BLOCK_MS).length;
  const holding = (t) => t.verified && (t.stage === 'waiting' || t.stage === 'in_chair');
  const limited = (phone) => {
    const lockedAt = locks.get(phone);
    if (lockedAt && lockedAt > Date.now() - BLOCK_MS) return { state: 'limited', retry_at: iso(lockedAt + BLOCK_MS) };
    const recent = outbox.filter((o) => o.to === phone && o.at > Date.now() - BLOCK_MS);
    return recent.length >= 3 ? { state: 'limited', retry_at: iso(recent[recent.length - 3].at + BLOCK_MS) } : null;
  };

  function send(session) {
    const code = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    Object.assign(session, { code, sent_at: Date.now() });
    const body = `Sterncut : votre code est ${code}. Valable 5 min. Si vous n'avez rien demandé, ignorez ce message.`;
    outbox.push({ to: session.phone, body, code, at: Date.now() });
    print(`[fixture sms] ${session.phone}: ${body}`);
  }

  function session(purpose, phone, want, ticket, expiresAt = Date.now() + HOLD_MS) {
    const s = { token: token(), purpose, phone, want, ticket, expires_at: expiresAt, used_at: null, locked_at: null };
    sessions.set(s.token, s);
    send(s);
    return s;
  }

  function hold(want, phone, verified) {
    const shop = shopOf(want.shop);
    const chair = chairOf(shop, want.barber);
    const service = shop?.open && !shop.shut && chair?.state === 'taking'
      ? chair.services.find((s) => s.id === want.service && s.wait_min != null)
      : null;
    if (!service) return null;
    const t = {
      token: token(), shop: shop.code, barber: chair.code, service, name: want.first_name, phone,
      source: want.source === 'code' ? 'code' : 'link',
      joined_at: iso(Date.now()), hold_until: Date.now() + HOLD_MS, verified,
      stage: verified ? 'waiting' : 'held', no: chair.next_no, ahead: chair.waiting, wait_min: service.wait_min,
    };
    chair.next_no += 1;
    chair.waiting += 1;
    tickets.set(t.token, t);
    return t;
  }

  // a deleted hold, a cancelled ticket and a no-show all leave the count 0110 numbers by
  function release(t, stage) {
    const chair = chairOf(shopOf(t.shop), t.barber);
    if (chair) {
      chair.waiting -= 1;
      chair.next_no -= 1;
    }
    if (stage) t.stage = stage;
    else tickets.delete(t.token);
  }

  const calledUntil = (t) =>
    (t.called_at == null ? null : Date.parse(t.called_at) + CALL_MS + (t.extended_at ? MORE_MS : 0));

  const sweep = () => {
    for (const t of [...tickets.values()]) {
      if (!t.verified && t.hold_until < Date.now()) release(t);
      // QL-13's hold running out is QL-14, with nothing tapped anywhere
      const until = calledUntil(t);
      if (t.stage === 'waiting' && until != null && until < Date.now()) {
        release(t, 'missed');
        t.missed_at = iso(until);
      }
    }
  };

  function ticketJson(t) {
    const shop = shopOf(t.shop);
    const chair = chairOf(shop, t.barber);
    const until = calledUntil(t);
    const called = t.stage === 'waiting' && until != null && until > Date.now();
    return {
      token: t.token, shop_code: shop.code, shop: shop.name, address: shop.address,
      barber_code: chair.code, barber: chair.name.split(' ')[0],
      service_id: t.service.id, service: t.service.name, price_cents: t.service.price_cents,
      first_name: t.name, phone: t.phone, joined_at: t.joined_at,
      hold_until: t.verified ? null : iso(t.hold_until),
      no: t.no, ahead: t.ahead, wait_min: t.wait_min,
      behind: Math.max(0, chair.next_no - 1 - t.no),
      in_chair: t.stage === 'left' ? null : IN_CHAIR[chair.code] ?? null,
      paused: chair.state === 'paused' || !shop.open,
      paused_at: chair.paused_at ?? null,
      called_at: t.called_at ?? null,
      called_until: until == null ? null : iso(until),
      coming: t.coming_at != null,
      extended: t.extended_at != null,
      texted: !!t.texted,
      missed_at: t.missed_at ?? null,
      since_call: t.since_call ?? 0,
      rejoined: t.rejoined ?? null,
      stage: called ? 'called' : t.stage,
    };
  }

  const calls = {
    public_queue({ p_shop, p_barber }) {
      const shop = shopOf(p_shop);
      if (!shop) return { found: false };
      return { ...structuredClone(shop), chosen: chairOf(shop, p_barber)?.code ?? null, now: iso(Date.now()) };
    },

    nearby_open_shop({ p_shop }) {
      const near = shopOf(p_shop)?.nearby;
      const other = near ? shopOf(near.code) : null;
      if (!other?.open || other.shut) return null;
      const wait = (c) => Math.min(...c.services.map((s) => s.wait_min ?? Infinity));
      const soonest = other.chairs.filter((c) => c.state === 'taking' && wait(c) < Infinity)
        .sort((a, b) => wait(a) - wait(b))[0];
      return soonest
        ? { code: other.code, name: other.name, meters: near.meters, waiting: soonest.waiting, wait_min: wait(soonest), until_min: other.close_min }
        : null;
    },

    guest_request(a) {
      sweep();
      const name = String(a.p_first_name ?? '').trim().replace(/\s+/g, ' ').slice(0, 30);
      if (!name) return { state: 'invalid', field: 'name' };
      const phone = phoneOf(a.p_phone);
      if (!phone) return { state: 'invalid', field: 'phone' };
      const want = {
        shop: String(a.p_shop ?? '').toUpperCase(), barber: String(a.p_barber ?? '').toUpperCase(),
        service: a.p_service, first_name: name, source: a.p_source,
      };
      if (!chairOf(shopOf(want.shop), want.barber) || !a.p_service) return { state: 'gone', want };
      const stop = limited(phone);
      if (stop) return stop;
      const held = [...tickets.values()].find((t) => t.phone === phone && holding(t));
      if (held) return { state: 'code', token: session('lookup', phone, want, held.token).token };
      for (const t of [...tickets.values()]) if (t.phone === phone && !t.verified) release(t);
      const t = hold(want, phone, false);
      if (!t) return { state: 'gone', want };
      return { state: 'code', token: session('join', phone, want, t.token, t.hold_until).token };
    },

    guest_code_view({ p_token }) {
      const s = sessions.get(p_token);
      if (!s) return { found: false };
      const t = s.ticket ? tickets.get(s.ticket) : null;
      let heldPlace = null;
      if (s.purpose === 'join' && t) {
        heldPlace = ticketJson(t);
        delete heldPlace.token;
      }
      return {
        found: true, purpose: s.purpose, phone: s.phone,
        resend_at: iso(s.sent_at + 30_000), expires_at: iso(s.expires_at),
        expired: s.expires_at < Date.now() || (s.purpose === 'join' && !t),
        used: s.used_at != null,
        locked: s.locked_at != null || missesNow(s.phone) >= 3,
        attempts_left: Math.max(0, 3 - missesNow(s.phone)),
        hold: heldPlace, want: s.want, now: iso(Date.now()),
      };
    },

    guest_resend({ p_token }) {
      const s = sessions.get(p_token);
      if (!s) return { state: 'gone' };
      if (s.used_at || s.expires_at < Date.now()) return { state: 'expired', want: s.want };
      if (s.sent_at > Date.now() - 30_000) return { state: 'wait', resend_at: iso(s.sent_at + 30_000) };
      const stop = limited(s.phone);
      if (stop) return stop;
      send(s);
      return { state: 'sent' };
    },

    guest_verify({ p_token, p_code }) {
      sweep();
      const s = sessions.get(p_token);
      if (!s) return { state: 'gone' };
      const t = s.ticket ? tickets.get(s.ticket) : null;
      if (s.used_at) {
        return s.purpose === 'join' && t
          ? { state: 'joined', ticket: t.token, shop: s.want.shop }
          : { state: 'expired', want: s.want };
      }
      if (s.locked_at) return { state: 'locked', released_no: s.released_no, retry_at: iso(s.locked_at + BLOCK_MS), want: s.want };
      if (s.expires_at < Date.now() || (s.purpose === 'join' && !t)) return { state: 'expired', want: s.want };
      if (missesNow(s.phone) >= 3) {
        return { state: 'locked', released_no: null, retry_at: iso((locks.get(s.phone) ?? Date.now()) + BLOCK_MS), want: s.want };
      }
      if (String(p_code ?? '').replace(/\D/g, '') !== s.code) {
        misses.set(s.phone, [...(misses.get(s.phone) ?? []), Date.now()]);
        const n = missesNow(s.phone);
        if (n < 3) return { state: 'wrong', attempts_left: 3 - n, want: s.want };
        let no = null;
        if (s.purpose === 'join' && t && !t.verified) {
          no = t.no;
          release(t);
        }
        Object.assign(s, { locked_at: Date.now(), released_no: no });
        locks.set(s.phone, s.locked_at);
        return { state: 'locked', released_no: no, retry_at: iso(s.locked_at + BLOCK_MS), want: s.want };
      }
      s.used_at = Date.now();
      if (s.purpose === 'join') {
        Object.assign(t, { verified: true, stage: 'waiting' });
        return { state: 'joined', ticket: t.token, shop: s.want.shop };
      }
      if (s.purpose === 'leave') {
        if (t.stage === 'in_chair') return { state: 'started', want: s.want };
        release(t, 'left');
        return { state: 'left', want: s.want };
      }
      return { state: 'already', ticket: ticketJson(t), guest: true, want: s.want };
    },

    guest_drop({ p_token }) {
      const s = sessions.get(p_token);
      if (!s) return { state: 'gone' };
      const t = s.ticket ? tickets.get(s.ticket) : null;
      if (s.purpose === 'join' && !s.used_at && t && !t.verified) release(t);
      sessions.delete(s.token);
      return { state: 'dropped', want: s.want };
    },

    guest_leave({ p_ticket }) {
      const t = tickets.get(p_ticket);
      if (!t || !holding(t)) return { state: 'gone' };
      if (t.stage === 'in_chair') return { state: 'started' };
      const stop = limited(t.phone);
      if (stop) return stop;
      const want = { shop: t.shop, barber: t.barber, service: t.service.id, first_name: t.name, ticket: t.token };
      return { state: 'code', token: session('leave', t.phone, want, t.token).token };
    },

    guest_switch({ p_token }) {
      sweep();
      const s = sessions.get(p_token);
      if (!s || s.purpose !== 'lookup' || !s.used_at || s.used_at < Date.now() - 10 * 60_000) {
        return { state: 'gone', want: s?.want ?? {} };
      }
      const old = tickets.get(s.ticket);
      if (!old || !holding(old)) return { state: 'gone', want: s.want };
      if (old.stage === 'in_chair') return { state: 'started', want: s.want };
      release(old, 'left');
      const t = hold(s.want, s.phone, true);
      sessions.delete(s.token);
      return t ? { state: 'joined', ticket: t.token, shop: s.want.shop } : { state: 'gone', want: s.want };
    },

    guest_rejoin({ p_ticket }) {
      const t = tickets.get(p_ticket);
      if (!t || !t.verified) return { state: 'gone' };
      if (t.rejoined) return { state: 'joined', ticket: t.rejoined, shop: t.shop };
      if (t.stage !== 'missed') return { state: 'gone', want: { shop: t.shop, barber: t.barber } };
      const other = [...tickets.values()].find((x) => x.phone === t.phone && holding(x));
      if (other) return { state: 'joined', ticket: other.token, shop: t.shop };
      const n = hold({ shop: t.shop, barber: t.barber, service: t.service.id, first_name: t.name, source: t.source }, t.phone, true);
      if (!n) return { state: 'gone', want: { shop: t.shop, barber: t.barber } };
      t.rejoined = n.token;
      return { state: 'joined', ticket: n.token, shop: t.shop };
    },

    // QL-13's "I'M WALKING IN": the barber is told, the clock keeps running
    guest_coming({ p_ticket }) {
      sweep();
      const t = tickets.get(p_ticket);
      if (!t || !t.verified || t.stage !== 'waiting' || t.called_at == null) return { state: 'gone' };
      t.coming_at = t.coming_at ?? iso(Date.now());
      return { state: 'coming' };
    },

    // QL-13's "GIVE ME 5 MINUTES": five more on the hold, once
    guest_wait({ p_ticket }) {
      sweep();
      const t = tickets.get(p_ticket);
      if (!t || !t.verified || t.stage !== 'waiting' || t.called_at == null) return { state: 'gone' };
      if (t.extended_at) return { state: 'used', until: iso(calledUntil(t)) };
      t.extended_at = iso(Date.now());
      return { state: 'added', until: iso(calledUntil(t)) };
    },

    guest_ticket({ p_token }) {
      sweep();
      const t = tickets.get(p_token);
      return t && t.verified ? { ...ticketJson(t), found: true } : { found: false };
    },
  };

  const rpc = async (name, args) => {
    if (!calls[name]) throw new Error(`the fixture has no ${name}`);
    return structuredClone(calls[name](args ?? {}));
  };
  /** Every text "sent", newest last — the checks read codes from here. */
  rpc.outbox = outbox;
  /** What the barber's switch does: the chair stops taking anyone, stamped (0115). */
  rpc.pause = (shopCode, chairCode, on) => {
    const chair = chairOf(shopOf(shopCode), chairCode);
    chair.state = on ? 'paused' : 'taking';
    chair.paused_at = on ? iso(Date.now()) : null;
  };
  /**
   * What CALL NEXT does to a guest's ticket (QL-13): 0018's check-in stamp, which
   * 0116 turns into an eight-minute chair hold. `minAgo` calls him in the past,
   * which is how a lapsed hold is tested without waiting eight minutes.
   */
  rpc.call = (ticketToken, { minAgo = 0, texted = false } = {}) => {
    const t = tickets.get(ticketToken);
    t.called_at = iso(Date.now() - minAgo * 60_000);
    t.texted = texted;
  };
  /** What the barber's no-show does to a guest's ticket (QL-14). */
  rpc.miss = (ticketToken, { calledMinAgo = null, sinceCall = 0 } = {}) => {
    const t = tickets.get(ticketToken);
    release(t, 'missed');
    Object.assign(t, {
      missed_at: iso(Date.now()),
      called_at: calledMinAgo == null ? null : iso(Date.now() - calledMinAgo * 60_000),
      since_call: sinceCall,
    });
  };
  return rpc;
}
