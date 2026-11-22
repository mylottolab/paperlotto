-- PaperLotto 서버 — 지금 관리자 계정 찾기 (읽기만). PaperLotto Supabase SQL Editor 에서 Run → 결과를 캡처해 보내 주세요.
select u.email as login, p.nickname, u.last_sign_in_at
  from public.profiles p join auth.users u on u.id = p.id
 where p.is_admin = true
 order by u.last_sign_in_at desc nulls last;
