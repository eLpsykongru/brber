// A stand-in for the database, for the local preview and the checks: the drawn
// Le Fade day from queue.json, and 0118's calls for the one web write kept in
// memory, answering in the same shapes. Texts print instead of sending — with the
// confirm link, so the preview can be tapped through. Design data, never shown to
// a customer — and not a second copy of the rules to trust: the migrations are.
import { readFileSync } from 'node:fs';

export function fixtureRpc({ print = (line) => console.log(line) } = {}) {
  const shops = JSON.parse(readFileSync(new URL('./queue.json', import.meta.url), 'utf8'));
  const tickets = new Map();   // ticket token → ticket
  const offers = new Map();    // BTD-16: confirm token → offer
  const outbox = [];

  const token = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const phoneOf = (raw) => {
    const m = String(raw ?? '').replace(/\D/g, '').match(/^(?:00212|212|0)?([67]\d{8})$/);
    return m ? `+212${m[1]}` : null;
  };
  const shopOf = (code) => shops[String(code ?? '').toUpperCase()] ?? null;
  const chairOf = (shop, code) => shop?.chairs.find((c) => c.code === String(code ?? '').toUpperCase()) ?? null;
  const today = () => new Date().toDateString();

  function ticketJson(tk) {
    const shop = shopOf(tk.shop);
    const chair = chairOf(shop, tk.barber);
    const ahead = chair.line.filter((l) => l.no < tk.no).length;
    return {
      found: true,
      token: tk.token,
      shop_code: shop.code, shop: shop.name, address: shop.address,
      barber_code: chair.code, barber: chair.name.split(' ')[0],
      service_id: tk.service.id, service: tk.service.name, price_cents: tk.service.price_cents,
      first_name: tk.first_name, phone: tk.phone,
      no: tk.no, ahead, wait_min: tk.wait_min,
      texted: outbox.some((o) => o.ticket === tk.token && o.kind === 'next'),
      stage: tk.stage === 'waiting' && !tk.confirmed ? 'held' : tk.stage,
      hold_text: tk.confirmed ? null
        : outbox.filter((o) => o.ticket === tk.token && o.kind === 'hold').pop()?.body.replace(/\/c\/[0-9a-f]+/, '/c/…') ?? null,
    };
  }

  // 0119's offer_confirm: the tap writes the booking, unless the time went first
  function offerConfirm(tokenValue) {
    const o = offers.get(tokenValue);
    if (!o) return { state: 'unknown' };
    const said = { kind: 'offer', shop: o.shop, barber: o.barber, starts_at: o.starts_at };
    if (!o.booked) {
      if (new Date(o.starts_at) < new Date()) return { state: 'expired', ...said };
      if (o.taken) return { state: 'taken', ...said };
      o.booked = true;
    }
    const again = o.tapped === true;
    o.tapped = true;
    const shop = shopOf(o.shop);
    return {
      state: 'booked', again, ...said, shop_name: shop.name, address: shop.address,
      service: o.service, price_cents: 9000, first_name: o.first_name,
    };
  }

  return async function rpc(name, args) {
    const calls = {
      public_queue({ p_shop, p_barber }) {
        const shop = shopOf(p_shop);
        if (!shop) return { found: false };
        const chosen = chairOf(shop, p_barber)?.code ?? null;
        return { ...structuredClone(shop), chosen, now: new Date().toISOString() };
      },

      guest_join({ p_shop, p_barber, p_service, p_first_name, p_phone, p_source, p_base }) {
        const name = String(p_first_name ?? '').replace(/\s+/g, ' ').trim().slice(0, 30);
        const phone = phoneOf(p_phone);
        if (!name) return { state: 'invalid', field: 'name' };
        if (!phone) return { state: 'invalid', field: 'phone' };
        const shop = shopOf(p_shop);
        const chair = chairOf(shop, p_barber);
        if (!shop || !chair) return { state: 'gone', shop: String(p_shop ?? '').toUpperCase() };
        const service = shop.open && !shop.shut && chair.state === 'taking'
          ? chair.services.find((s) => (!p_service || s.id === p_service) && s.wait_min != null)
          : null;
        if (!service) return { state: 'gone', shop: shop.code };

        const recent = outbox.filter((o) => o.kind === 'hold' && o.to === phone && o.at > Date.now() - 15 * 60_000);
        if (recent.length >= 3) {
          return { state: 'limited', retry_at: new Date(recent[recent.length - 3].at + 15 * 60_000).toISOString() };
        }
        const mine = [...tickets.values()].filter((t) => t.phone === phone && t.day === today());
        if (mine.some((t) => t.confirmed && (t.stage === 'waiting' || t.stage === 'in_chair'))) return { state: 'already' };
        // the same number starting again replaces its own unconfirmed name
        for (const t of mine.filter((x) => !x.confirmed && x.stage === 'waiting')) {
          tickets.delete(t.token);
          const at = chairOf(shopOf(t.shop), t.barber);
          at.line = at.line.filter((l) => l.no !== t.no);
          at.waiting -= 1;
          // the day renumbers behind a deleted row, as 0029 counts it
          if (t.no === at.next_no - 1) at.next_no -= 1;
          for (const s of at.services) if (s.wait_min != null) s.wait_min -= t.service.duration_min;
        }

        const no = chair.next_no;
        const wait = service.wait_min;
        const tk = {
          token: token(), confirm: token(), shop: shop.code, barber: chair.code, service,
          first_name: name, phone, no, wait_min: wait, stage: 'waiting', confirmed: false,
          source: p_source, day: today(),
        };
        tickets.set(tk.token, tk);
        chair.line.push({ no, in_chair: false, wait_min: wait });
        chair.waiting += 1;
        chair.next_no += 1;
        for (const s of chair.services) if (s.wait_min != null) s.wait_min += service.duration_min;

        const body = `Sterncut: Ticket ${String(no).padStart(2, '0')} at ${shop.name} with ${chair.name.split(' ')[0]}, `
          + `about ${wait} min. Confirm with one tap: ${p_base || 'https://sterncut.ma'}/c/${tk.confirm}`;
        outbox.push({ kind: 'hold', to: phone, body, ticket: tk.token, at: Date.now() });
        print(`[fixture sms] ${phone}: ${body}`);
        return { state: 'joined', ticket: tk.token, shop: shop.code };
      },

      guest_confirm({ p_token }) {
        const tk = [...tickets.values()].find((t) => t.confirm === p_token);
        if (!tk) return offerConfirm(p_token);
        if (tk.confirmed) return { state: 'confirmed', ticket: tk.token, shop: tk.shop, again: true };
        if (tk.day !== today()) return { state: 'expired', ticket: tk.token, shop: tk.shop };
        if (tk.stage !== 'waiting') return { state: 'gone', ticket: tk.token, shop: tk.shop };
        tk.confirmed = true;
        return { state: 'confirmed', ticket: tk.token, shop: tk.shop, again: false };
      },

      guest_ticket({ p_token }) {
        const tk = tickets.get(p_token);
        return tk ? ticketJson(tk) : { found: false };
      },

      guest_give_up({ p_ticket }) {
        const tk = tickets.get(p_ticket);
        if (!tk) return { state: 'gone' };
        if (tk.stage === 'left') return { state: 'left', shop: tk.shop };
        if (tk.stage !== 'waiting') return { state: 'started', shop: tk.shop };
        tk.stage = 'left';
        return { state: 'left', shop: tk.shop };
      },
    };

    // 0126: what the website prints — counted from the drawn shops, 0123's list price
    calls.site_numbers = () => ({
      salons: Object.keys(shops).length,
      barbers: Object.values(shops).reduce((n, s) => n + s.chairs.length, 0),
      reply_days: 1.4,
      monthly_cents: 5500, yearly_cents: 4000, cap: 4, sms_included: 200, sms_unit_cents: null,
    });

    // for the checks: move a ticket along as the barber would, or age its link
    calls.fixture_set = ({ ticket, ...change }) => Object.assign(tickets.get(ticket), change);
    calls.fixture_confirm_token = ({ ticket }) => tickets.get(ticket)?.confirm ?? null;
    calls.fixture_outbox = () => outbox;
    calls.fixture_offer = (o) => {
      const t = token();
      offers.set(t, { barber: 'Youssef', service: 'Haircut + Beard', first_name: 'Anas', ...o });
      return t;
    };

    const fn = calls[name];
    if (!fn) throw new Error(`fixture has no ${name}`);
    return fn(args ?? {});
  };
}
