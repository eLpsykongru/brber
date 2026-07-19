-- 0022_wallet: Phase 2 starts (trigger pulled 2026-07-19) — the ledger we own.
-- One rail: cash top-up at the salon, taken by the owner (the v1 cash agent
-- per BACKLOG). DECIDED: no agent commission — instant liquidity is the reward.
-- Later increments: settlement/netting against payouts, card rail (YouCan Pay),
-- paying bookings from the wallet, a real outstanding-float cap.

create table public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),   -- whose wallet is credited
  salon_id uuid not null references public.salons (id),    -- till where the cash was handed
  created_by uuid not null references public.barbers (id), -- the agent who took the cash
  kind text not null default 'cash_topup' check (kind = 'cash_topup'),
  amount_cents int not null check (amount_cents > 0),
  created_at timestamptz not null default now()
);

alter table public.wallet_transactions enable row level security;

-- customer sees their own wallet; the agent sees the till they run
create policy wallet_select on public.wallet_transactions for select to authenticated
  using (user_id = auth.uid() or created_by = auth.uid());
grant select on public.wallet_transactions to authenticated;
-- no insert/update/delete grants: money moves only through agent_cash_topup()

create index wallet_tx_user_idx on public.wallet_transactions (user_id, created_at desc);
create index wallet_tx_agent_idx on public.wallet_transactions (created_by, created_at desc);

-- The salon owner credits a customer who handed over cash. Customer is looked up
-- by phone, matched on the trailing 9 digits so "+212 612 345 678" and
-- "0612345678" both hit the same account.
create or replace function public.agent_cash_topup(customer_phone text, topup_cents int)
returns table (tx_id uuid, customer_name text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_salon uuid;
  v_customer uuid;
  v_name text;
  v_digits text := right(regexp_replace(coalesce(customer_phone, ''), '\D', '', 'g'), 9);
begin
  select s.id into v_salon from public.salons s where s.owner_id = auth.uid() limit 1;
  if v_salon is null then
    raise exception 'Only the salon owner can take cash top-ups';
  end if;
  if topup_cents is null or topup_cents <= 0 then
    raise exception 'Amount must be more than zero';
  end if;
  -- ponytail: flat 5,000 DH per-top-up cap; the real cap is on outstanding float,
  -- which only exists once settlement lands
  if topup_cents > 500000 then
    raise exception 'Top-up is above the 5,000 DH limit';
  end if;
  if length(v_digits) < 9 then
    raise exception 'Enter the customer''s full phone number';
  end if;
  begin
    select p.id, coalesce(p.full_name, 'Client') into strict v_customer, v_name
    from public.profiles p
    where right(regexp_replace(p.phone, '\D', '', 'g'), 9) = v_digits;
  exception
    when no_data_found then raise exception 'No brber account with that phone';
    when too_many_rows then raise exception 'That phone matches more than one account';
  end;
  return query
    insert into public.wallet_transactions (user_id, salon_id, created_by, amount_cents)
    values (v_customer, v_salon, auth.uid(), topup_cents)
    returning id, v_name;
end;
$$;

grant execute on function public.agent_cash_topup(text, int) to authenticated;
