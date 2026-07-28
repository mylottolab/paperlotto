// =====================================================
// PaperLotto — Supabase Edge Function: admin-business-reports
// 역할: 관리자 대시보드용 3가지 리포트 제공
//   1) payments : 입금현황 (신용카드 결제 + 계좌이체 통합)
//   2) signups  : 일자별 가입된 신규회원 명단
//   3) sales    : 항목별 판매현황 (point_usage_log 집계, 오늘 이후 데이터부터 쌓임)
//
// 인증: Authorization: Bearer <accessToken> (profiles.is_admin=true)
// 요청: GET ?report=payments|signups|sales&from=YYYY-MM-DD&to=YYYY-MM-DD
//       (from/to 생략 시 최근 30일 기본)
// =====================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

async function resolveUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user.id;
}

function parseRange(url: URL) {
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 86400000);
  const fromStr = url.searchParams.get('from') || defaultFrom.toISOString().slice(0, 10);
  const toStr = url.searchParams.get('to') || now.toISOString().slice(0, 10);
  // to는 그날 23:59:59까지 포함
  const fromISO = new Date(fromStr + 'T00:00:00.000Z').toISOString();
  const toISO = new Date(toStr + 'T23:59:59.999Z').toISOString();
  return { fromISO, toISO };
}

async function getNicknameMap(userIds: string[]): Promise<Record<string, string>> {
  const uniq = [...new Set(userIds)].filter(Boolean);
  if (uniq.length === 0) return {};
  const { data } = await supabase.from('profiles').select('id, nickname').in('id', uniq);
  const map: Record<string, string> = {};
  (data ?? []).forEach((p: { id: string; nickname: string }) => { map[p.id] = p.nickname; });
  return map;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const userId = await resolveUserId(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: 'AUTH_REQUIRED' }), { status: 401, headers: CORS });
  }
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', userId).maybeSingle();
  if (!profile?.is_admin) {
    return new Response(JSON.stringify({ error: 'NOT_ADMIN' }), { status: 403, headers: CORS });
  }

  const url = new URL(req.url);
  const report = url.searchParams.get('report');
  const { fromISO, toISO } = parseRange(url);

  try {
    if (report === 'payments') {
      const [{ data: cardRows, error: cardErr }, { data: bankRows, error: bankErr }] = await Promise.all([
        supabase.from('payments').select('*').gte('created_at', fromISO).lte('created_at', toISO).neq('method', 'bank_transfer').order('created_at', { ascending: false }),
        supabase.from('bank_transfer_requests').select('*').gte('submitted_at', fromISO).lte('submitted_at', toISO).order('submitted_at', { ascending: false }),
      ]);
      if (cardErr || bankErr) throw new Error(String(cardErr?.message || bankErr?.message));

      const nickMap = await getNicknameMap([
        ...(cardRows ?? []).map((r: { user_id: string }) => r.user_id),
        ...(bankRows ?? []).map((r: { user_id: string }) => r.user_id),
      ]);

      const methodLabel = (m: string | null | undefined) => {
        if (m === 'paypal') return 'PayPal';
        if (m === 'inicis') return '신용카드(이니시스)';
        return m ? m : '신용카드';
      };

      const items = [
        ...(cardRows ?? []).map((r: Record<string, unknown>) => ({
          date: r.created_at,
          method: 'card',
          method_label: methodLabel(r.method as string),
          payer_name: nickMap[r.user_id as string] || '-',
          amount: r.amount_krw ?? r.amount ?? 0,
          currency: r.currency ?? 'KRW',
          points: r.points ?? null,
          status: r.status,
          order_id: r.order_id,
        })),
        ...(bankRows ?? []).map((r: Record<string, unknown>) => ({
          date: r.submitted_at,
          method: 'bank',
          method_label: '계좌이체',
          payer_name: r.depositor_name,
          amount: r.amount_krw ?? 0,
          currency: 'KRW',
          points: r.points_credited ?? null,
          status: r.status,
          order_id: null,
        })),
      ].sort((a, b) => new Date(b.date as string).getTime() - new Date(a.date as string).getTime());

      return new Response(JSON.stringify({ items, from: fromISO, to: toISO }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    if (report === 'signups') {
      const { data: rows, error } = await supabase
        .from('profiles')
        .select('id, nickname, email, country_code, preferred_lang, created_at')
        .gte('created_at', fromISO)
        .lte('created_at', toISO)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);

      const items = (rows ?? []).map((r) => ({
        date: r.created_at,
        nickname: r.nickname,
        email: r.email ?? '-',
        country_code: r.country_code,
        preferred_lang: r.preferred_lang,
      }));

      return new Response(JSON.stringify({ items, from: fromISO, to: toISO }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    if (report === 'sales') {
      const [{ data: logRows, error: logErr }, { data: costRows, error: costErr }] = await Promise.all([
        supabase.from('point_usage_log').select('*').gte('created_at', fromISO).lte('created_at', toISO),
        supabase.from('point_costs').select('action_key, label_kr'),
      ]);
      if (logErr || costErr) throw new Error(String(logErr?.message || costErr?.message));

      const labelMap: Record<string, string> = {};
      (costRows ?? []).forEach((c: { action_key: string; label_kr: string }) => { labelMap[c.action_key] = c.label_kr; });

      const totalsByKey: Record<string, { count: number; quantity: number; points_spent: number }> = {};
      (logRows ?? []).forEach((r: { action_key: string; quantity: number; points_spent: number }) => {
        const k = r.action_key;
        if (!totalsByKey[k]) totalsByKey[k] = { count: 0, quantity: 0, points_spent: 0 };
        totalsByKey[k].count += 1;
        totalsByKey[k].quantity += r.quantity ?? 1;
        totalsByKey[k].points_spent += r.points_spent ?? 0;
      });

      const actionTotals = Object.entries(totalsByKey)
        .map(([action_key, v]) => ({ action_key, label_kr: labelMap[action_key] || action_key, ...v }))
        .sort((a, b) => b.points_spent - a.points_spent);

      const grandTotal = actionTotals.reduce((sum, r) => sum + r.points_spent, 0);

      return new Response(JSON.stringify({ actionTotals, grandTotal, from: fromISO, to: toISO }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'UNKNOWN_REPORT' }), { status: 400, headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), { status: 500, headers: CORS });
  }
});
