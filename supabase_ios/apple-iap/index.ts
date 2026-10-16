// =====================================================================
// PaperLotto — apple-iap  (아이폰 앱 포인트 충전 · 애플 인앱 결제)        2026-10-16 신설
//
//   POST { action: 'products' }                 → 아이폰에서 파는 포인트 상품 목록
//   POST { action: 'account' }   (로그인 필요)   → 결제에 붙일 "누가 샀는지" 번호(appAccountToken = 회원 번호)
//   POST { action: 'verify', transactionId }    → 애플(App Store Server API)에 직접 묻고, 진짜일 때만 point_ledger 에 적립
//
// 지키는 것
//   · 같은 거래는 한 번만 (pl_apple_iap_orders.transaction_id 기본키)
//   · 앱 번호(bundleId) · 상품 번호가 맞아야 함
//   · 산 사람(appAccountToken)이 지금 로그인한 사람과 같아야 함
//   · 환불된 거래면 넣지 않음
//   · ⚠ 애플 규칙(3.1.1): 인앱으로 산 포인트는 사라지면 안 됨 → point_ledger 는 원래 소멸이 없습니다(points.ts 참고)
//
// Secrets (Supabase → Edge Functions → Secrets) — 알림로또 · 부름과 같은 "앱 내 구입 키"(…H7)
//   APPLE_IAP_KEY_ID · APPLE_IAP_ISSUER_ID · APPLE_IAP_KEY_P8 · APPLE_BUNDLE_ID(=com.weaveapp.paperlotto)
// 배포: Verify JWT 켜 둔 채로 괜찮습니다(로그인한 회원만 부름 · products 는 공개 키로도 통과)
// =====================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } });
const BUNDLE_ID = Deno.env.get('APPLE_BUNDLE_ID') || 'com.weaveapp.paperlotto';

// 1원 = 1P (웹의 카드 충전과 같은 비율). 상품 번호는 App Store Connect 에 똑같이 만들어야 합니다.
const PRODUCTS = [
  { id: 'pl_points_1100',  krw: 1100,  points: 1100 },
  { id: 'pl_points_3300',  krw: 3300,  points: 3300 },
  { id: 'pl_points_5500',  krw: 5500,  points: 5500 },
  { id: 'pl_points_11000', krw: 11000, points: 11000 },
  { id: 'pl_points_33000', krw: 33000, points: 33000 },
  { id: 'pl_points_55000', krw: 55000, points: 55000 },
];
const POINTS_OF: Record<string, number> = Object.fromEntries(PRODUCTS.map((p) => [p.id, p.points]));

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function userId(req: Request): Promise<string | null> {
  const tok = (req.headers.get('authorization') || '').replace('Bearer ', '');
  if (!tok || tok.startsWith('sb_publishable_')) return null;
  const { data, error } = await supabase.auth.getUser(tok);
  return error || !data.user ? null : data.user.id;
}

// ── 애플 서버에 묻기 위한 출입증(JWT, ES256) ──
const b64url = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
let jwtCache: string | null = null, jwtAt = 0;
async function appleJwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (jwtCache && now - jwtAt < 15 * 60) return jwtCache;
  const p8 = Deno.env.get('APPLE_IAP_KEY_P8') || '';
  const kid = (Deno.env.get('APPLE_IAP_KEY_ID') || '').replace(/[^A-Za-z0-9]/g, '');
  const iss = (Deno.env.get('APPLE_IAP_ISSUER_ID') || '').replace(/[^A-Za-z0-9-]/g, '');
  if (!p8 || !kid || !iss) throw new Error('APPLE_IAP_KEY_P8 · APPLE_IAP_KEY_ID · APPLE_IAP_ISSUER_ID 비밀값이 없습니다');
  const b64 = p8.replace(/\\n/g, '\n').replace(/-----[A-Z ]+-----/g, '').replace(/[^A-Za-z0-9+/=]/g, '');
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', raw.buffer, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const enc = new TextEncoder();
  const unsigned = b64url(enc.encode(JSON.stringify({ alg: 'ES256', kid, typ: 'JWT' }))) + '.' +
    b64url(enc.encode(JSON.stringify({ iss, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1', bid: BUNDLE_ID })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned));
  jwtCache = unsigned + '.' + b64url(new Uint8Array(sig));
  jwtAt = now;
  return jwtCache;
}
function jwsPayload(jws: string): any {
  const part = String(jws || '').split('.')[1] || '';
  const b = part.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((part.length + 3) % 4);
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b), (c) => c.charCodeAt(0))));
}
// 정식 → 시험(TestFlight · 샌드박스) 순서로 묻습니다
async function askApple(txId: string): Promise<{ env: string; tx: any }> {
  const jwt = await appleJwt();
  let last = '';
  for (const [env, host] of [['Production', 'https://api.storekit.itunes.apple.com'],
                             ['Sandbox', 'https://api.storekit-sandbox.itunes.apple.com']]) {
    const res = await fetch(host + '/inApps/v1/transactions/' + txId, { headers: { Authorization: 'Bearer ' + jwt } });
    if (res.ok) return { env, tx: jwsPayload((await res.json()).signedTransactionInfo) };
    last += (last ? ' / ' : '') + env + ' ' + res.status + ' ' + (await res.text()).slice(0, 120);
    if (res.status === 401) jwtCache = null;
  }
  throw new Error('애플 확인 실패: ' + last);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return reply({ error: 'method not allowed' }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');

    if (action === 'products') return reply({ items: PRODUCTS });

    const uid = await userId(req);
    if (!uid) return reply({ error: 'login_required' }, 401);

    if (action === 'account') return reply({ account: uid });

    if (action === 'verify') {
      const txId = String(body.transactionId || '').replace(/^apple:/, '').replace(/[^0-9]/g, '');
      if (!txId) return reply({ error: 'transactionId 가 없습니다' }, 400);

      // 이미 받은 거래면 그대로 "됐다"고(앱이 정리할 수 있게)
      const { data: done } = await supabase.from('pl_apple_iap_orders').select('user_id, points')
        .eq('transaction_id', txId).maybeSingle();
      if (done) {
        if (done.user_id !== uid) return reply({ error: '다른 계정으로 받은 결제입니다' }, 403);
        return reply({ ok: true, already: true, points: done.points });
      }

      const { env, tx } = await askApple(txId);
      if (tx.bundleId !== BUNDLE_ID) return reply({ error: '다른 앱의 결제입니다' }, 400);
      const per = POINTS_OF[tx.productId];
      if (!per) return reply({ error: '모르는 상품입니다: ' + tx.productId }, 400);
      if (!tx.appAccountToken || String(tx.appAccountToken).toLowerCase() !== uid.toLowerCase()) {
        return reply({ error: '다른 계정으로 산 결제입니다' }, 403);
      }
      if (tx.revocationDate) return reply({ ok: true, revoked: true, points: 0 });   // 환불 — 정리만
      const total = per * Math.max(1, Number(tx.quantity) || 1);

      // 거래 줄을 먼저 잡습니다(같은 거래가 동시에 와도 한 번만 적립)
      const { error: insErr } = await supabase.from('pl_apple_iap_orders').insert({
        transaction_id: txId, original_transaction_id: String(tx.originalTransactionId || ''),
        user_id: uid, product_id: tx.productId, points: total, environment: env,
        purchased_at: tx.purchaseDate ? new Date(Number(tx.purchaseDate)).toISOString() : null,
      });
      if (insErr) {
        if (String(insErr.code) === '23505') return reply({ ok: true, already: true, points: total });
        throw insErr;
      }
      // points.ts 의 creditPoints 와 같은 방식(소멸 없음)
      const { error: ledErr } = await supabase.from('point_ledger').insert({
        user_id: uid, amount: total, remaining: total, source: 'apple_iap', order_id: 'apple:' + txId,
        earned_at: new Date().toISOString(),
      });
      if (ledErr) {
        await supabase.from('pl_apple_iap_orders').delete().eq('transaction_id', txId);   // 다음에 다시 시도할 수 있게
        throw ledErr;
      }
      console.log(`[apple-iap] 적립 user=${uid} ${total}P ${tx.productId} tx=${txId} (${env})`);
      return reply({ ok: true, points: total });
    }

    return reply({ error: 'unknown action' }, 400);
  } catch (e) {
    console.error('[apple-iap] 오류:', e);
    return reply({ error: String((e as Error).message ?? e) }, 500);
  }
});
