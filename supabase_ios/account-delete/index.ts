// =====================================================================
// PaperLotto — account-delete  (회원 탈퇴)                               2026-10-16 신설
//   애플 5.1.1(v) · 구글 플레이 정책: 계정을 만들 수 있는 앱은 앱 안에서 계정을 지울 수 있어야 합니다.
//
//   POST { confirm: '<내 이메일>' }  (로그인 필요 — Authorization: Bearer <access token>)
//     → 확인 글자가 내 이메일과 같으면 Supabase 로그인 계정을 지웁니다.
//       · "부드러운 삭제"(shouldSoftDelete) — 이메일 등 개인 정보는 지워지고 다시 로그인할 수 없지만,
//         등록번호 · 포인트 · 결제 기록 같은 다른 표의 줄은 그대로 남아 오류 없이 처리됩니다.
//       · 결제 기록은 전자상거래법상 5년 보관 대상이라 지우지 않습니다(개인정보처리방침과 같음).
//       · 남은 포인트는 사라집니다(화면에서 미리 알립니다).
// 배포: Verify JWT 켜 둔 채로 괜찮습니다(로그인한 회원만 부름)
// =====================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return reply({ error: 'method not allowed' }, 405);
  try {
    const tok = (req.headers.get('authorization') || '').replace('Bearer ', '');
    const { data, error } = await admin.auth.getUser(tok);
    if (error || !data.user) return reply({ error: 'login_required' }, 401);
    const user = data.user;

    const body = await req.json().catch(() => ({}));
    const typed = String(body.confirm || '').trim().toLowerCase();
    if (!user.email || typed !== user.email.toLowerCase()) return reply({ error: 'confirm_mismatch' }, 400);

    const { error: delErr } = await admin.auth.admin.deleteUser(user.id, true);
    if (delErr) {
      console.error('[account-delete] 삭제 실패, 로그인 막기로 대신합니다:', delErr);
      const { error: banErr } = await admin.auth.admin.updateUserById(user.id, { ban_duration: '876000h' });
      if (banErr) throw banErr;
    }
    console.log('[account-delete] 탈퇴 완료', user.id);
    return reply({ ok: true });
  } catch (e) {
    console.error('[account-delete] 오류:', e);
    return reply({ error: String((e as Error).message ?? e) }, 500);
  }
});
