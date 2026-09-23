-- 0129_writeoff_alert_words: what 0128 left open. `design_handoff_billing_rail/`
-- README §8 q1 and ADDENDUM §10; the owner said to build all three (2026-09-23).
--
--   1 · FIN-19's alert. The handoff asks "whether FIN-19 alerts above a
--       threshold" and leaves the figure to finance, who have not named one. So it
--       is a setting, not a constant: platform_settings.writeoff_alert_cents,
--       1 000 DH a month to start, null for off. Only a full-access admin moves
--       it — a signer never sets the limit on their own signature — and each move
--       is logged in settings_changes with a reason. It alerts and never blocks:
--       FIN-18b warns before a write-off that crosses it, FIN-19 turns red, and
--       the overview lists it under "needs a human".
--   2 · Reversing a write-off from the console. admin_reverse_writeoff (0128)
--       already did the work; admin_writeoff now says whether the reader may sign
--       one. The owner is told as well when the write-off was the shop's to bear —
--       it moves his next Friday.
--   3 · Every cash-drawer message in the reader's own language (profiles.language,
--       as the write-off texts already were). One catalogue of sentences
--       (cash_words) and one sender (tell_in_lang), so a new message is a row and
--       not a fourth copy of a CASE. Amounts go through dh_text, whose no-break
--       spaces keep "3 240" whole in an Arabic line.

-- ---- 1 · the alert, as a setting ---------------------------------------------------
alter table public.platform_settings add column if not exists writeoff_alert_cents int default 100000;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'writeoff_alert_range') then
    alter table public.platform_settings add constraint writeoff_alert_range
      check (writeoff_alert_cents is null or writeoff_alert_cents between 100 and 100000000);
  end if;
end $$;

create or replace function public.admin_set_writeoff_alert(p_cents int, p_reason text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare v_before int;
begin
  if not public.admin_can('*') then
    raise exception 'Only a full-access admin sets the write-off alert — a signer never sets the limit on their own signature';
  end if;
  if p_cents is not null and (p_cents < 100 or p_cents > 100000000) then
    raise exception 'The alert is between 1 DH and 1 000 000 DH a month, or off';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Say why, in a sentence — it is logged against your name';
  end if;
  select writeoff_alert_cents into v_before from public.platform_settings where id;
  if v_before is not distinct from p_cents then raise exception 'That is already the alert'; end if;

  update public.platform_settings
     set writeoff_alert_cents = p_cents, updated_at = now(), updated_by = auth.uid()
   where id;
  insert into public.settings_changes (changed_by, before, after, note)
  values (auth.uid(), json_build_object('writeoff_alert_cents', v_before),
          json_build_object('writeoff_alert_cents', p_cents), btrim(p_reason));
  return json_build_object('alert_cents', p_cents);
end $$;

-- written off so far this month (Casablanca), reversals netted
create or replace function public.writeoffs_this_month()
returns int
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(w.amount_cents), 0)::int from public.cash_writeoffs w
   where w.signed_at >= date_trunc('month', now() at time zone 'Africa/Casablanca') at time zone 'Africa/Casablanca';
$$;

-- ---- 2 · the words ----------------------------------------------------------------------
-- {name} placeholders are filled by tell_in_lang; {date} is the one filled per
-- language (day_month). Keys end in .title / .body.
create or replace function public.cash_words(p_key text, p_lang text)
returns text
language sql immutable set search_path = ''
as $$
  select case p_lang when 'fr' then w.fr when 'ar' then w.ar else w.en end
    from (values
      ('till_given.title',
       'You hold the shop''s cash',
       'Vous tenez la caisse du salon',
       'أنت من يحمل صندوق الصالون'),
      ('till_given.body',
       'From now on you take the cash top-ups and pay the chairs what the shop owes them.',
       'Désormais, c''est vous qui prenez les recharges en espèces et qui payez aux fauteuils ce que le salon leur doit.',
       'من الآن أنت من يستلم الشحن نقدًا ويدفع للكراسي ما يدين به الصالون لهم.'),
      ('till_taken.title',
       'You no longer hold the shop''s cash',
       'Vous ne tenez plus la caisse du salon',
       'لم تعد تحمل صندوق الصالون'),
      ('till_taken.body',
       'The drawer was empty and nobody was owed, so the role moved with nothing to hand over.',
       'La caisse était vide et personne n''attendait d''argent : le rôle est passé sans rien à remettre.',
       'كان الصندوق فارغًا ولم يكن لأحد مستحقات، فانتقل الدور دون أي شيء يُسلَّم.'),

      ('handover_incoming.title',
       'You are taking the shop''s cash',
       'Vous prenez la caisse du salon',
       'أنت تستلم صندوق الصالون'),
      ('handover_incoming.body',
       '{from} is counting {amount} into your hands. Count it yourself, then confirm it on your phone.',
       '{from} vous compte {amount} en main. Recomptez vous-même, puis confirmez sur votre téléphone.',
       '{from} يعدّ لك {amount} في يدك. عُدّه بنفسك، ثم أكّد على هاتفك.'),
      ('handover_outgoing.title',
       'Hand the drawer to {to}',
       'Remettez la caisse à {to}',
       'سلّم الصندوق إلى {to}'),
      ('handover_outgoing.body',
       'Count {amount} into his hands. Until he confirms, you still pay the chairs.',
       'Comptez-lui {amount} en main. Tant qu''il n''a pas confirmé, c''est encore vous qui payez les fauteuils.',
       'عُدّ {amount} في يده. إلى أن يؤكد، تبقى أنت من يدفع للكراسي.'),
      ('handover_done.title',
       'The drawer changed hands',
       'La caisse a changé de mains',
       'انتقل الصندوق إلى يد أخرى'),
      ('handover_done.body',
       '{to} counted {amount} and now holds the shop''s cash.',
       '{to} a compté {amount} et tient désormais la caisse du salon.',
       'عدّ {to} مبلغ {amount} وأصبح يحمل صندوق الصالون.'),
      ('handover_mismatch.title',
       'The drawer count did not match',
       'Le comptage de la caisse ne correspond pas',
       'العدّ لم يطابق الصندوق'),
      ('handover_mismatch.body',
       '{from} handed over {declared} by our books; {to} counted {counted}. Sterncut will call to settle it. Until then {from} still pays the chairs, and nothing else about the shop changes.',
       '{from} a remis {declared} d''après nos comptes ; {to} en a compté {counted}. Sterncut va appeler pour régler ça. En attendant, {from} continue de payer les fauteuils, et rien d''autre ne change pour le salon.',
       'سلّم {from} مبلغ {declared} حسب دفاترنا؛ وعدّ {to} مبلغ {counted}. سيتصل Sterncut لتسوية الأمر. وحتى ذلك الحين يبقى {from} من يدفع للكراسي، ولا يتغير شيء آخر في الصالون.'),

      ('settled_short.title',
       'The drawer handover is settled',
       'La remise de caisse est réglée',
       'تمت تسوية تسليم الصندوق'),
      ('settled_short.body',
       '{to} now holds the shop''s cash, from {agreed}. {from} owes Sterncut the other {gap} ({ref}) - his to settle, not the shop''s.',
       '{to} tient désormais la caisse du salon, à partir de {agreed}. {from} doit à Sterncut les {gap} restants ({ref}) — c''est à lui de les régler, pas au salon.',
       'أصبح {to} يحمل صندوق الصالون، ابتداءً من {agreed}. {from} مدين لـSterncut بالباقي {gap} ({ref}) — تسويته عليه، لا على الصالون.'),
      ('settled_over.title',
       'The drawer handover is settled',
       'La remise de caisse est réglée',
       'تمت تسوية تسليم الصندوق'),
      ('settled_over.body',
       '{to} now holds the shop''s cash, from {agreed}. The drawer owes {from} {gap}.',
       '{to} tient désormais la caisse du salon, à partir de {agreed}. La caisse doit {gap} à {from}.',
       'أصبح {to} يحمل صندوق الصالون، ابتداءً من {agreed}. الصندوق مدين لـ{from} بـ{gap}.'),
      ('settled_even.title',
       'The drawer handover is settled',
       'La remise de caisse est réglée',
       'تمت تسوية تسليم الصندوق'),
      ('settled_even.body',
       '{to} now holds the shop''s cash, from {agreed}. Nothing was missing.',
       '{to} tient désormais la caisse du salon, à partir de {agreed}. Il ne manquait rien.',
       'أصبح {to} يحمل صندوق الصالون، ابتداءً من {agreed}. لم ينقص شيء.'),

      ('code_spent.title',
       'Your payout code was typed wrong five times',
       'Votre code de paiement a été mal saisi cinq fois',
       'أُدخل رمز الدفع خطأً خمس مرات'),
      ('code_spent.body',
       'It no longer works. Open "You & Sterncut" for a new one, and only read it out once the cash is in your hand.',
       'Il ne fonctionne plus. Ouvrez « Vous & Sterncut » pour en avoir un nouveau, et ne le dites qu''une fois l''argent en main.',
       'لم يعد يعمل. افتح «أنت وSterncut» لتحصل على رمز جديد، ولا تقله إلا حين يصبح المال في يدك.'),
      ('paid.title',
       'Paid in the shop',
       'Payé au salon',
       'دُفع لك في الصالون'),
      ('paid.body',
       '{agent} paid you {amount} from the drawer.',
       '{agent} vous a payé {amount} depuis la caisse.',
       'دفع لك {agent} مبلغ {amount} من الصندوق.'),
      ('paid_part.title',
       'Paid in the shop',
       'Payé au salon',
       'دُفع لك في الصالون'),
      ('paid_part.body',
       '{agent} paid you {amount} from the drawer. The shop still owes you {left}.',
       '{agent} vous a payé {amount} depuis la caisse. Le salon vous doit encore {left}.',
       'دفع لك {agent} مبلغ {amount} من الصندوق. وما زال الصالون مدينًا لك بـ{left}.'),
      ('received.title',
       'Put in the drawer',
       'Versé dans la caisse',
       'وُضع في الصندوق'),
      ('received.body',
       '{agent} took {amount} from you into the shop''s drawer.',
       '{agent} a pris {amount} de votre part pour la caisse du salon.',
       'أخذ {agent} منك {amount} إلى صندوق الصالون.'),

      ('shortfall_paid.title',
       'Shortfall paid back',
       'Manque remboursé',
       'تم سداد النقص'),
      ('shortfall_paid.body',
       '{agent} took {amount} from you into the drawer for the {ref} shortfall. You owe nothing on it now.',
       '{agent} a pris {amount} de votre part dans la caisse pour le manque {ref}. Vous ne devez plus rien là-dessus.',
       'أخذ {agent} منك {amount} إلى الصندوق عن نقص {ref}. لم تعد مدينًا بشيء عنه.'),
      ('writeoff_reversed.title',
       'Write-off reversed',
       'Annulation reprise',
       'تم التراجع عن الإلغاء'),
      ('writeoff_reversed.body',
       'The write-off {ref} was reversed. The {amount} from your drawer handover on {date} is on your account again.',
       'L''annulation {ref} a été reprise. Les {amount} de votre remise de caisse du {date} sont de nouveau à votre compte.',
       'تم التراجع عن الإلغاء {ref}. فارق {amount} من تسليم الصندوق يوم {date} عاد إلى حسابك.'),
      ('writeoff_reversed_owner.title',
       'Write-off reversed',
       'Annulation reprise',
       'تم التراجع عن الإلغاء'),
      ('writeoff_reversed_owner.body',
       'The write-off {ref} was reversed: {salon} no longer bears the {amount} gap from the drawer handover on {date}. It comes off your next Friday settlement.',
       'L''annulation {ref} a été reprise : {salon} ne prend plus en charge l''écart de {amount} de la remise de caisse du {date}. Il est retiré de votre prochain règlement du vendredi.',
       'تم التراجع عن الإلغاء {ref}: لم يعد {salon} يتحمل فارق {amount} من تسليم الصندوق يوم {date}. سيُخصم من تسويتك القادمة يوم الجمعة.')
    ) w(k, en, fr, ar)
   where w.k = p_key;
$$;

create or replace function public.tell_in_lang(
  p_user uuid, p_key text, p_vars jsonb, p_cents int default null, p_at timestamptz default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare l text; v_title text; v_body text; k text; v text;
begin
  if p_user is null then return; end if;
  l := public.lang_of(p_user);
  v_title := public.cash_words(p_key || '.title', l);
  v_body := public.cash_words(p_key || '.body', l);
  if v_title is null or v_body is null then raise exception 'No words for %', p_key; end if;
  for k, v in select e.key, e.value from jsonb_each_text(coalesce(p_vars, '{}'::jsonb)) e loop
    v_title := replace(v_title, '{' || k || '}', coalesce(v, ''));
    v_body := replace(v_body, '{' || k || '}', coalesce(v, ''));
  end loop;
  if p_at is not null then
    v_body := replace(v_body, '{date}', public.day_month(p_at, l));
  end if;
  insert into public.notifications (user_id, kind, title, body, amount_cents)
  values (p_user, 'shop_status', v_title, v_body, p_cents);
end $$;

-- ---- 3 · the senders, re-emitted with their words moved out -----------------------------
-- 0127's appoint_till
create or replace function public.appoint_till(p_salon uuid, p_barber uuid)
returns json
language plpgsql security definer set search_path = ''
as $$
declare v_old uuid; v_owner uuid; v_drawer int;
begin
  select coalesce(s.cash_agent_id, s.owner_id), s.owner_id into v_old, v_owner
    from public.salons s where s.id = p_salon for update;
  if p_barber is distinct from v_owner and not exists (
       select 1 from public.barbers b
        where b.id = p_barber and b.salon_id = p_salon and b.salon_status = 'approved') then
    raise exception 'The cash agent must be one of your approved barbers, or you';
  end if;
  if p_barber = v_old then return json_build_object('state', 'same'); end if;
  if exists (select 1 from public.drawer_transfers t
              where t.salon_id = p_salon and t.state in ('pending', 'mismatch')) then
    raise exception 'A handover of the drawer is already under way';
  end if;

  v_drawer := public.drawer_cents(p_salon);
  if not public.drawer_clear(p_salon) then
    return json_build_object('state', 'blocked', 'drawer_cents', v_drawer,
      'dues', (select coalesce(json_agg(json_build_object(
                  'barber', d.barber_id, 'name', public.person_name(d.barber_id), 'cents', d.due_cents,
                  'is_agent', d.barber_id = v_old) order by d.due_cents desc), '[]'::json)
                 from public.drawer_dues(p_salon) d where d.due_cents <> 0));
  end if;

  update public.salons set cash_agent_id = p_barber, cash_agent_since = now() where id = p_salon;
  perform public.tell_in_lang(p_barber, 'till_given', '{}'::jsonb);
  if v_old <> v_owner then
    perform public.tell_in_lang(v_old, 'till_taken', '{}'::jsonb);
  end if;
  return json_build_object('state', 'done');
end $$;

-- 0127's start_drawer_transfer
create or replace function public.start_drawer_transfer(p_barber uuid)
returns json
language plpgsql security definer set search_path = ''
as $$
declare v_salon uuid; v_owner uuid; v_till uuid; v_id uuid; v_ref text; v_drawer int;
begin
  select s.id, s.owner_id, coalesce(s.cash_agent_id, s.owner_id) into v_salon, v_owner, v_till
    from public.salons s where s.owner_id = auth.uid() limit 1 for update;
  if v_salon is null then raise exception 'Only the shop''s owner hands the drawer on'; end if;
  if p_barber = v_till then raise exception 'He already holds it'; end if;
  if p_barber <> v_owner and not exists (
       select 1 from public.barbers b
        where b.id = p_barber and b.salon_id = v_salon and b.salon_status = 'approved') then
    raise exception 'The cash agent must be one of your approved barbers, or you';
  end if;
  if exists (select 1 from public.drawer_transfers t
              where t.salon_id = v_salon and t.state in ('pending', 'mismatch')) then
    raise exception 'A handover of the drawer is already under way';
  end if;
  -- nothing attached: nothing to count, the role just moves
  if public.drawer_clear(v_salon) then return public.appoint_till(v_salon, p_barber); end if;

  v_drawer := public.drawer_cents(v_salon);
  insert into public.drawer_transfers (salon_id, from_id, to_id, started_cents, created_by)
  values (v_salon, v_till, p_barber, v_drawer, auth.uid())
  returning id, ref into v_id, v_ref;

  perform public.tell_in_lang(p_barber, 'handover_incoming',
    jsonb_build_object('from', public.person_name(v_till), 'amount', public.dh_text(v_drawer)), v_drawer);
  if v_till <> v_owner then
    perform public.tell_in_lang(v_till, 'handover_outgoing',
      jsonb_build_object('to', public.person_name(p_barber), 'amount', public.dh_text(v_drawer)), v_drawer);
  end if;
  return json_build_object('state', 'pending', 'id', v_id, 'ref', v_ref, 'drawer_cents', v_drawer);
end $$;

-- 0128's agent_pay
create or replace function public.agent_pay(p_barber uuid, p_cents int, p_code text default null, p_idem text default null)
returns json
language plpgsql security definer set search_path = ''
as $$
declare v_salon uuid; v_due int; v_drawer int; c record; e record; v_self boolean;
begin
  if p_idem is not null then
    select * into e from public.drawer_entries where idem_key = p_idem;
    if e.id is not null then
      return json_build_object('ok', true, 'replay', true, 'cents', e.amount_cents);
    end if;
  end if;

  v_salon := public.my_till_salon();
  if v_salon is null then raise exception 'Only the shop''s cash agent pays the chairs'; end if;
  if p_cents is null or p_cents <= 0 then raise exception 'Amount must be more than zero'; end if;
  v_self := p_barber = auth.uid();
  v_due := public.drawer_due_cents(v_salon, p_barber);
  if v_due <= 0 then raise exception 'The shop owes him nothing right now'; end if;
  if p_cents > v_due then
    raise exception 'The shop owes % DH — you can''t pay more than that', round(v_due / 100.0);
  end if;
  v_drawer := public.drawer_cents(v_salon);
  if p_cents > v_drawer then
    raise exception 'The drawer only holds % DH — pay part, the rest stays on his column',
      round(greatest(v_drawer, 0) / 100.0);
  end if;

  if not v_self then
    select * into c from public.payout_codes where barber_id = p_barber and salon_id = v_salon for update;
    if c.code is null or c.issued_at < now() - interval '12 hours' then
      return json_build_object('ok', false, 'reason', 'no_code');
    end if;
    if c.code is distinct from p_code then
      if c.fails + 1 >= 5 then
        delete from public.payout_codes where barber_id = p_barber and salon_id = v_salon;
        perform public.tell_in_lang(p_barber, 'code_spent', '{}'::jsonb);
        return json_build_object('ok', false, 'reason', 'spent');
      end if;
      update public.payout_codes set fails = fails + 1 where barber_id = p_barber and salon_id = v_salon;
      return json_build_object('ok', false, 'reason', 'code', 'left', 4 - c.fails);
    end if;
    delete from public.payout_codes where barber_id = p_barber and salon_id = v_salon;
  end if;

  insert into public.drawer_entries (salon_id, barber_id, agent_id, kind, amount_cents, proof, idem_key, created_by)
  values (v_salon, p_barber, auth.uid(), 'payout', p_cents,
          case when v_self then 'self' else 'payee_code' end, p_idem, auth.uid());
  if not v_self then
    perform public.tell_in_lang(p_barber, case when v_due > p_cents then 'paid_part' else 'paid' end,
      jsonb_build_object('agent', public.person_name(auth.uid()), 'amount', public.dh_text(p_cents),
                         'left', public.dh_text(v_due - p_cents)), p_cents);
  end if;
  return json_build_object('ok', true, 'cents', p_cents, 'left_cents', v_due - p_cents);
end $$;

-- 0127's agent_receive
create or replace function public.agent_receive(p_barber uuid, p_cents int)
returns json
language plpgsql security definer set search_path = ''
as $$
declare v_salon uuid; v_due int;
begin
  v_salon := public.my_till_salon();
  if v_salon is null then raise exception 'Only the shop''s cash agent takes cash into the drawer'; end if;
  if p_cents is null or p_cents <= 0 then raise exception 'Amount must be more than zero'; end if;
  v_due := public.drawer_due_cents(v_salon, p_barber);
  if v_due >= 0 then raise exception 'He owes the drawer nothing'; end if;
  if p_cents > -v_due then
    raise exception 'He owes the drawer % DH — not more', round(-v_due / 100.0);
  end if;
  insert into public.drawer_entries (salon_id, barber_id, agent_id, kind, amount_cents, proof, created_by)
  values (v_salon, p_barber, auth.uid(), 'received', -p_cents, 'agent_received', auth.uid());
  if p_barber <> auth.uid() then
    perform public.tell_in_lang(p_barber, 'received',
      jsonb_build_object('agent', public.person_name(auth.uid()), 'amount', public.dh_text(p_cents)), p_cents);
  end if;
  return json_build_object('ok', true, 'left_cents', v_due + p_cents);
end $$;

-- 0127's confirm_drawer_transfer
create or replace function public.confirm_drawer_transfer(p_transfer uuid, p_counted int, p_expected int)
returns json
language plpgsql security definer set search_path = ''
as $$
declare t record; v_books int; v_dues jsonb; v_owner uuid; u uuid;
begin
  select * into t from public.drawer_transfers where id = p_transfer for update;
  if t.id is null or t.to_id <> auth.uid() then raise exception 'That handover is not yours to confirm'; end if;
  if t.state <> 'pending' then raise exception 'That handover is no longer waiting'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'Type what you counted'; end if;
  v_books := public.drawer_cents(t.salon_id);
  if p_expected is distinct from v_books then
    raise exception 'The drawer changed while you were counting — it should now hold % DH. Count it again.',
      round(v_books / 100.0);
  end if;
  select owner_id into v_owner from public.salons where id = t.salon_id;
  select coalesce(jsonb_agg(jsonb_build_object('barber', d.barber_id, 'cents', d.due_cents)), '[]'::jsonb)
    into v_dues from public.drawer_dues(t.salon_id) d where d.due_cents <> 0;

  if p_counted = v_books then
    update public.drawer_transfers
       set state = 'done', declared_cents = v_books, counted_cents = p_counted, dues = v_dues,
           counted_at = now(), closed_at = now()
     where id = t.id;
    update public.salons set cash_agent_id = t.to_id, cash_agent_since = now() where id = t.salon_id;
    for u in select distinct x from unnest(array[t.from_id, v_owner]) x where x <> t.to_id loop
      perform public.tell_in_lang(u, 'handover_done',
        jsonb_build_object('to', public.person_name(t.to_id), 'amount', public.dh_text(p_counted)), p_counted);
    end loop;
    return json_build_object('state', 'done');
  end if;

  -- two claims and no way to choose between them from here: the role stays where
  -- it is, top-ups stop, and a person at Sterncut rings them both (FIN-18)
  update public.drawer_transfers
     set state = 'mismatch', declared_cents = v_books, counted_cents = p_counted, dues = v_dues,
         counted_at = now()
   where id = t.id;
  for u in select distinct x from unnest(array[t.from_id, t.to_id, v_owner]) x loop
    perform public.tell_in_lang(u, 'handover_mismatch',
      jsonb_build_object('from', public.person_name(t.from_id), 'to', public.person_name(t.to_id),
                         'declared', public.dh_text(v_books), 'counted', public.dh_text(p_counted)),
      v_books - p_counted);
  end loop;
  return json_build_object('state', 'mismatch', 'declared_cents', v_books, 'counted_cents', p_counted);
end $$;

-- 0128's admin_resolve_drawer_transfer
create or replace function public.admin_resolve_drawer_transfer(p_id uuid, p_agreed_cents int, p_note text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare r json; v_gap int; v_owner uuid; v_from uuid; v_to uuid; u uuid;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_agreed_cents is null or p_agreed_cents < 0 then raise exception 'Record the figure that was agreed'; end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'Say what the call settled — it is logged against your name'; end if;

  r := public.resolve_drawer_transfer(p_id, p_agreed_cents, p_note);
  v_gap := (r->>'gap_cents')::int;
  v_from := (r->>'from')::uuid;
  v_to := (r->>'to')::uuid;
  select owner_id into v_owner from public.salons where id = (r->>'salon')::uuid;

  for u in select distinct x from unnest(array[v_from, v_to, v_owner]) x loop
    perform public.tell_in_lang(u,
      case when v_gap > 0 then 'settled_short' when v_gap < 0 then 'settled_over' else 'settled_even' end,
      jsonb_build_object('to', public.person_name(v_to), 'from', public.person_name(v_from),
                         'agreed', public.dh_text(p_agreed_cents), 'gap', public.dh_text(v_gap),
                         'ref', r->>'ref'),
      p_agreed_cents);
  end loop;
  return json_build_object('state', 'resolved', 'gap_cents', v_gap, 'shortfall', r->>'shortfall');
end $$;

-- 0128's agent_take_shortfall
create or replace function public.agent_take_shortfall(p_shortfall uuid)
returns json
language plpgsql security definer set search_path = ''
as $$
declare sf record; t record;
begin
  select * into sf from public.barber_shortfalls where id = p_shortfall for update;
  if sf.id is null then raise exception 'No such shortfall'; end if;
  if public.till_of(sf.salon_id) is distinct from auth.uid() then
    raise exception 'Only the shop''s cash agent takes cash into the drawer';
  end if;
  if sf.barber_id = auth.uid() then
    raise exception 'Somebody else has to take it — you cannot record your own payment';
  end if;
  if sf.status <> 'open' then raise exception 'That shortfall is already %', replace(sf.status, '_', ' '); end if;
  if exists (select 1 from public.drawer_transfers x
              where x.salon_id = sf.salon_id and x.state in ('pending', 'mismatch')) then
    raise exception 'The drawer is changing hands — take it once the new agent has counted it';
  end if;
  update public.barber_shortfalls set status = 'paid', closed_at = now(), closed_by = auth.uid()
   where id = sf.id;
  select * into t from public.drawer_transfers where id = sf.transfer_id;
  perform public.tell_in_lang(sf.barber_id, 'shortfall_paid',
    jsonb_build_object('agent', public.person_name(auth.uid()), 'amount', public.dh_text(sf.amount_cents),
                       'ref', t.ref), sf.amount_cents);
  return json_build_object('ok', true, 'cents', sf.amount_cents);
end $$;

-- 0128's admin_reverse_writeoff, now also telling the owner when the shop bore it
create or replace function public.admin_reverse_writeoff(p_writeoff uuid, p_note text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare w record; sf record; t record; r record; s record;
begin
  perform public.require_signer();
  if length(btrim(coalesce(p_note, ''))) < 20 then
    raise exception 'Write why, in at least 20 characters — it is logged against your name';
  end if;
  select * into w from public.cash_writeoffs where id = p_writeoff;
  if w.id is null or w.reverses_id is not null then raise exception 'That is not a write-off that can be reversed'; end if;
  if exists (select 1 from public.cash_writeoffs x where x.reverses_id = w.id) then
    raise exception 'Write-off % is already reversed', w.ref;
  end if;
  insert into public.cash_writeoffs (shortfall_id, salon_id, amount_cents, bearer, note, signed_by, reverses_id)
  values (w.shortfall_id, w.salon_id, -w.amount_cents, w.bearer, btrim(p_note), auth.uid(), w.id)
  returning * into r;
  update public.barber_shortfalls set status = 'open', closed_at = null, closed_by = null
   where id = w.shortfall_id
  returning * into sf;
  select * into s from public.salons where id = sf.salon_id;
  if w.bearer = 'salon' then
    insert into public.drawer_entries (salon_id, barber_id, agent_id, kind, amount_cents, proof, transfer_id, created_by)
    values (sf.salon_id, s.owner_id, null, 'handover_gap', -w.amount_cents, 'ops_record', sf.transfer_id, auth.uid());
  end if;
  select * into t from public.drawer_transfers where id = sf.transfer_id;

  perform public.tell_in_lang(sf.barber_id, 'writeoff_reversed',
    jsonb_build_object('ref', w.ref, 'amount', public.dh_text(sf.amount_cents)), sf.amount_cents, t.created_at);
  if w.bearer = 'salon' then
    perform public.tell_in_lang(s.owner_id, 'writeoff_reversed_owner',
      jsonb_build_object('ref', w.ref, 'amount', public.dh_text(sf.amount_cents), 'salon', s.name),
      sf.amount_cents, t.created_at);
  end if;
  return json_build_object('ref', r.ref, 'reverses', w.ref);
end $$;

-- ---- 4 · the console's reads ----------------------------------------------------------
-- 0128's FIN-18b preview, plus where this write-off would take the month
create or replace function public.admin_writeoff_preview(p_transfer uuid, p_shortfall uuid, p_bearer text)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare t record; sf record; s record; v_gap int; v_holder uuid; v_incoming boolean; v_sf uuid;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_shortfall is not null then
    select * into sf from public.barber_shortfalls where id = p_shortfall;
    if sf.id is null then raise exception 'No such shortfall'; end if;
    select * into t from public.drawer_transfers where id = sf.transfer_id;
    v_sf := sf.id;
    v_gap := sf.amount_cents;
    v_holder := public.till_of(sf.salon_id);
    v_incoming := false;
  else
    select * into t from public.drawer_transfers where id = p_transfer;
    if t.id is null or t.state <> 'mismatch' then raise exception 'That handover is not open'; end if;
    v_gap := t.declared_cents - t.counted_cents;
    v_holder := t.to_id;
    v_incoming := true;
  end if;
  select * into s from public.salons where id = t.salon_id;

  return json_build_object(
    'transfer', t.id, 'ref', t.ref, 'shortfall', v_sf,
    'salon', s.name, 'from_name', public.person_name(t.from_id), 'to_name', public.person_name(t.to_id),
    'declared_cents', t.declared_cents, 'counted_cents', t.counted_cents, 'gap_cents', v_gap,
    'can_sign', public.admin_can('finance_signer'),
    'signer', public.person_name(auth.uid()),
    'month_cents', public.writeoffs_this_month(),
    'alert_cents', (select writeoff_alert_cents from public.platform_settings where id),
    'messages', case when p_bearer in ('sterncut', 'salon') and v_gap > 0
                     then public.writeoff_texts(t.from_id, v_holder, s.owner_id, s.name, v_gap,
                                                coalesce(t.agreed_cents, t.counted_cents), t.created_at,
                                                p_bearer, null, v_incoming) end);
end $$;

-- 0128's read-only write-off, plus whether this reader may reverse it
create or replace function public.admin_writeoff(p_id uuid)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare w record; sf record; t record; s record; orig record; v_rev json;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select * into w from public.cash_writeoffs where id = p_id;
  if w.id is null then raise exception 'No such write-off'; end if;
  select * into sf from public.barber_shortfalls where id = w.shortfall_id;
  select * into t from public.drawer_transfers where id = sf.transfer_id;
  select * into s from public.salons where id = w.salon_id;
  select * into orig from public.cash_writeoffs where id = w.reverses_id;
  select json_build_object('ref', x.ref, 'signer', public.person_name(x.signed_by), 'at', x.signed_at, 'note', x.note)
    into v_rev from public.cash_writeoffs x where x.reverses_id = w.id;
  return json_build_object(
    'id', w.id, 'ref', w.ref, 'amount_cents', w.amount_cents, 'bearer', w.bearer, 'note', w.note,
    'signer', public.person_name(w.signed_by), 'signed_at', w.signed_at,
    'salon', s.name, 'barber', public.person_name(sf.barber_id),
    'transfer_ref', t.ref, 'declared_cents', t.declared_cents, 'counted_cents', t.counted_cents,
    'from_name', public.person_name(t.from_id), 'to_name', public.person_name(t.to_id),
    'reverses_ref', orig.ref,
    'reversed_by', v_rev,
    'can_reverse', w.reverses_id is null and v_rev is null and public.admin_can('finance_signer'),
    'messages', case when w.reverses_id is null then
                  public.writeoff_texts(sf.barber_id, t.to_id, s.owner_id, s.name, w.amount_cents,
                                        coalesce(t.agreed_cents, t.counted_cents), t.created_at, w.bearer, w.ref, false) end);
end $$;

-- 0128's FIN-19, plus the alert, who last set it, and whether this reader may
create or replace function public.admin_cash_in_shops(p_month date default null)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare v_from timestamptz; v_to timestamptz; v_prev timestamptz; v_month date;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  v_month := date_trunc('month', coalesce(p_month, (now() at time zone 'Africa/Casablanca')::date))::date;
  v_from := v_month::timestamp at time zone 'Africa/Casablanca';
  v_to := (v_month + interval '1 month')::timestamp at time zone 'Africa/Casablanca';
  v_prev := (v_month - interval '1 month')::timestamp at time zone 'Africa/Casablanca';

  return json_build_object(
    'month', v_month,
    'held_cents', (select coalesce(sum(greatest(public.salon_net_cents(s.id), 0)), 0)
                     from public.salons s where s.status in ('live', 'suspended')),
    'shops', (select coalesce(json_agg(x order by x.drawer_cents desc, x.name), '[]'::json) from (
                select s.id, s.name, public.person_name(public.till_of(s.id)) as agent,
                       public.drawer_cents(s.id) as drawer_cents,
                       (select coalesce(sum(d.due_cents), 0) from public.drawer_dues(s.id) d
                         where d.due_cents > 0) as owed_cents
                  from public.salons s where s.status in ('live', 'suspended')) x),
    'writeoffs', (select coalesce(json_agg(json_build_object(
                    'id', r.id, 'ref', r.ref, 'salon', r.salon, 'barber', r.barber, 'at', r.signed_at,
                    'signer', r.signer, 'bearer', r.bearer, 'amount_cents', r.amount_cents,
                    'reversal', r.reversal, 'running_cents', r.running)
                    order by r.signed_at, r.ref), '[]'::json)
                    from (select w.id, w.ref, s.name as salon, public.person_name(sf.barber_id) as barber,
                                 w.signed_at, public.person_name(w.signed_by) as signer, w.bearer, w.amount_cents,
                                 w.reverses_id is not null as reversal,
                                 sum(w.amount_cents) over (order by w.signed_at, w.ref) as running
                            from public.cash_writeoffs w
                            join public.barber_shortfalls sf on sf.id = w.shortfall_id
                            join public.salons s on s.id = w.salon_id
                           where w.signed_at >= v_from and w.signed_at < v_to) r),
    'month_cents', (select coalesce(sum(amount_cents), 0) from public.cash_writeoffs
                     where signed_at >= v_from and signed_at < v_to),
    'sterncut_cents', (select coalesce(sum(amount_cents), 0) from public.cash_writeoffs
                        where signed_at >= v_from and signed_at < v_to and bearer = 'sterncut'),
    'salon_cents', (select coalesce(sum(amount_cents), 0) from public.cash_writeoffs
                     where signed_at >= v_from and signed_at < v_to and bearer = 'salon'),
    'last_month_cents', (select coalesce(sum(amount_cents), 0) from public.cash_writeoffs
                          where signed_at >= v_prev and signed_at < v_from),
    'alert_cents', (select writeoff_alert_cents from public.platform_settings where id),
    'alert_set', (select json_build_object('by', public.person_name(c.changed_by), 'at', c.changed_at, 'note', c.note)
                    from public.settings_changes c
                   where (c.after::jsonb) ? 'writeoff_alert_cents'
                   order by c.changed_at desc limit 1),
    'can_set_alert', public.admin_can('*'));
end $$;

-- ---- 5 · grants ------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.cash_words(text, text)', 'public.tell_in_lang(uuid, text, jsonb, int, timestamptz)',
    'public.writeoffs_this_month()', 'public.appoint_till(uuid, uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.admin_set_writeoff_alert(int, text)', 'public.start_drawer_transfer(uuid)',
    'public.agent_pay(uuid, int, text, text)', 'public.agent_receive(uuid, int)',
    'public.confirm_drawer_transfer(uuid, int, int)', 'public.admin_resolve_drawer_transfer(uuid, int, text)',
    'public.agent_take_shortfall(uuid)', 'public.admin_reverse_writeoff(uuid, text)',
    'public.admin_writeoff_preview(uuid, uuid, text)', 'public.admin_writeoff(uuid)',
    'public.admin_cash_in_shops(date)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---- checked at apply time ----------------------------------------------------------------
do $$
declare k text; l text;
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    assert not exists (
      select 1 from pg_proc p
        join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public'
         and p.proname in (
           'cash_words', 'tell_in_lang', 'writeoffs_this_month', 'appoint_till', 'admin_set_writeoff_alert',
           'start_drawer_transfer', 'agent_pay', 'agent_receive', 'confirm_drawer_transfer',
           'admin_resolve_drawer_transfer', 'agent_take_shortfall', 'admin_reverse_writeoff',
           'admin_writeoff_preview', 'admin_writeoff', 'admin_cash_in_shops')
         and (p.proacl is null or exists (
               select 1 from aclexplode(p.proacl) a
                where a.privilege_type = 'EXECUTE'
                  and (a.grantee = 0 or a.grantee = 'anon'::regrole)))),
      'every function here needs a signed-in caller';
  end if;
  -- every message has a title and a body in all three languages
  foreach k in array array['till_given', 'till_taken', 'handover_incoming', 'handover_outgoing',
                           'handover_done', 'handover_mismatch', 'settled_short', 'settled_over',
                           'settled_even', 'code_spent', 'paid', 'paid_part', 'received',
                           'shortfall_paid', 'writeoff_reversed', 'writeoff_reversed_owner'] loop
    foreach l in array array['en', 'fr', 'ar'] loop
      assert public.cash_words(k || '.title', l) is not null and public.cash_words(k || '.body', l) is not null,
        format('no %s words for %s', l, k);
    end loop;
  end loop;
  assert (select writeoff_alert_cents from public.platform_settings where id) is not distinct from 100000
      or exists (select 1 from public.settings_changes c where (c.after::jsonb) ? 'writeoff_alert_cents'),
    'the alert starts at 1 000 DH a month';
end $$;
