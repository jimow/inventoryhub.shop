-- 00006_mpesa_pos.sql
-- M-Pesa STK Push tracking + cash tendered/change capture on payments.

-- Track every STK push request from initiation through callback. Daraja
-- echoes a `CheckoutRequestID` synchronously and POSTs the final result to
-- our callback URL, so we keep a row keyed on that ID.
create table if not exists public.mpesa_stk (
  id                   uuid primary key default gen_random_uuid(),
  checkout_request_id  text not null unique,
  merchant_request_id  text,
  sale_id              uuid references public.sales(id) on delete set null,
  amount               numeric(14,2) not null,
  phone                text not null,
  account_reference    text,
  status               text not null default 'pending'
                       check (status in ('pending','success','failed','cancelled','timeout')),
  result_code          int,
  result_desc          text,
  mpesa_receipt_no     text,
  raw_request          jsonb,
  raw_callback         jsonb,
  payment_id           uuid references public.payments(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid references auth.users(id)
);

create index if not exists mpesa_stk_status_idx  on public.mpesa_stk (status);
create index if not exists mpesa_stk_sale_idx    on public.mpesa_stk (sale_id);
create index if not exists mpesa_stk_created_idx on public.mpesa_stk (created_at desc);

alter table public.mpesa_stk enable row level security;

-- View for anyone with POS or accounting view permission
drop policy if exists mpesa_stk_select on public.mpesa_stk;
create policy mpesa_stk_select on public.mpesa_stk for select
  using (
    public.has_permission(auth.uid(), 'pos', 'view')
    or public.has_permission(auth.uid(), 'payments', 'view')
    or public.has_permission(auth.uid(), 'accounting', 'view')
  );

-- Insert/update is server-only via service-role client; deny direct client writes.
drop policy if exists mpesa_stk_insert on public.mpesa_stk;
create policy mpesa_stk_insert on public.mpesa_stk for insert with check (false);
drop policy if exists mpesa_stk_update on public.mpesa_stk;
create policy mpesa_stk_update on public.mpesa_stk for update using (false);

-- Capture cash-handling on payments so receipts can show change due.
alter table public.payments
  add column if not exists tendered_amount numeric(14,2),
  add column if not exists change_due      numeric(14,2);

-- POS-initiated draft sales sometimes need to be cancelled if STK push fails.
-- The existing 'cancelled' status already covers that; nothing else to add.
