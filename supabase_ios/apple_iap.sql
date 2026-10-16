-- PaperLotto — 아이폰 앱 애플 결제 기록 (2026-10-16)
-- Supabase(PaperLotto) → SQL Editor 에 통째로 붙여 넣고 Run
create table if not exists public.pl_apple_iap_orders (
  transaction_id          text primary key,
  original_transaction_id text,
  user_id                 uuid not null,
  product_id              text not null,
  points                  integer not null,
  environment             text,
  purchased_at            timestamptz,
  created_at              timestamptz not null default now()
);
create index if not exists pl_apple_iap_orders_user on public.pl_apple_iap_orders (user_id);
-- 서버(Edge Function)만 읽고 씁니다 — 화면에서 직접 못 보게 잠급니다(정책 없음 = 막힘)
alter table public.pl_apple_iap_orders enable row level security;
