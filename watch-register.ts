// =====================================================
// PaperLotto — watch-register Edge Function
// 2026-08-30 (15차) 신설
//
// 실물 복권을 산 손님이 추첨 전에 번호를 맡겨두는 유료 서비스의 등록 창구.
// 회차당 100P(point_costs의 watch_register), 한 회차 최대 50줄, 종목별로 각각.
//
// 요청: POST { gameId, lines, bonusLines?, timezone? }
//       Authorization: Bearer <accessToken> 필요
//       ⚠ roundNo는 받지 않습니다. 서버가 draw_results의 마지막 회차+1로 정합니다.
// 응답: 200 { success:true, entryId, roundNo, drawDate, lineCount, pointsCharged, balanceAfter }
//       ⚠ drawDate는 최근 추첨일에서 추론한 '예정일'입니다. 알아내지 못하면 null입니다.
//       400 { error:'INSUFFICIENT_POINTS', shortfall, balance }
//            { error:'ALREADY_REGISTERED', entryId, roundNo }  ← 같은 회차 중복
//            { error:'TOO_MANY_LINES' | 'INVALID_LINES' | ... }
//
// 🔴 처리 순서가 이 함수의 핵심입니다 (설계문서 5절):
//     1) pending 행을 먼저 저장   ← UNIQUE 제약이 중복 차감을 막아줍니다
//     2) 가격 조회 (하드코딩 금지)
//     3) 차감
//     4) 성공 → active
//     5) 실패 → pending 행 삭제
//   차감을 먼저 하면 저장 실패 시 되돌릴 것이 '포인트'가 되는데,
//   points.ts의 deductPoints는 개별 UPDATE라 중간 실패 시 얼마가 깎였는지
//   알 수 없습니다(그 파일의 작성자 경고 참조). 그래서 순서를 뒤집었습니다.
//   되돌릴 것이 '행 하나'면 안전합니다.
//
// ⚠ 채점 규칙은 여기에 두지 않습니다. admin-save-draw-result.ts에 이미 있고
//   복사본이 늘면 등수가 어긋납니다(이미 네 곳).
//
// 배포: supabase functions deploy watch-register
//   ⚠ 같은 폴더에 points.ts가 있어야 합니다 (winning-files-download와 동일).
// =====================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveUserId, deductPoints, getBalance } from './points.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const ACTION_KEY = 'watch_register';
const MAX_LINES = 50;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// ── 게임별 번호 규칙 ──
// 🔴 submit-entries.ts의 GAME_SPECS와 반드시 같아야 합니다.
//   어긋나면 모의구매에서는 거부되는 번호가 알림에서는 통과합니다.
//   (2026-08-30: us_megamillions 보너스 최대값을 24로 맞췄습니다)
// ⚠ 종목을 추가하면 submit-entries.ts / paperlotto_checker.js와 함께 고치세요.
//   main   : 손님이 입력하는 본번호 개수
//   maxNum : 본번호가 가질 수 있는 최대값
//   bonus  : 손님이 직접 입력하는 보너스 개수 (0이면 입력받지 않음)
//   bonusMax: 보너스가 가질 수 있는 최대값
const GAME_RULES: Record<string, { main: number; maxNum: number; bonus: number; bonusMax: number }> = {
  kr_lotto645:     { main: 6, maxNum: 45, bonus: 0, bonusMax: 0 },
  us_powerball:    { main: 5, maxNum: 69, bonus: 1, bonusMax: 26 },
  us_megamillions: { main: 5, maxNum: 70, bonus: 1, bonusMax: 24 },
  eu_euromillions: { main: 5, maxNum: 50, bonus: 2, bonusMax: 12 },
  jp_miniloto:     { main: 5, maxNum: 31, bonus: 0, bonusMax: 0 },
  jp_loto7:        { main: 7, maxNum: 37, bonus: 0, bonusMax: 0 },
  jp_loto6:        { main: 6, maxNum: 43, bonus: 0, bonusMax: 0 },
  ca_lottomax:     { main: 7, maxNum: 50, bonus: 0, bonusMax: 0 },
  ca_lotto649:     { main: 6, maxNum: 49, bonus: 0, bonusMax: 0 },
  au_powerball:    { main: 7, maxNum: 35, bonus: 1, bonusMax: 20 },
  au_ozlotto:      { main: 7, maxNum: 47, bonus: 0, bonusMax: 0 },
  au_tattslotto:   { main: 6, maxNum: 45, bonus: 0, bonusMax: 0 },
};

// 한 줄이 규칙에 맞는지 검사. 문제가 없으면 null, 있으면 사유를 돌려줍니다.
function checkLine(line: unknown, count: number, maxNum: number): string | null {
  if (!Array.isArray(line)) return 'NOT_ARRAY';
  if (line.length !== count) return 'WRONG_COUNT';
  const seen = new Set<number>();
  for (const raw of line) {
    const n = Number(raw);
    if (!Number.isInteger(n)) return 'NOT_INTEGER';
    if (n < 1 || n > maxNum) return 'OUT_OF_RANGE';
    if (seen.has(n)) return 'DUPLICATE';
    seen.add(n);
  }
  return null;
}

// ── 다음 추첨 예정일 추론 ──
// 🔴 요일표를 코드에 박지 않습니다. 종목마다 다르고, 운영사가 추첨 요일을 바꾸면
//   조용히 틀리기 시작합니다. 대신 그 게임의 최근 추첨일에서 요일을 읽어냅니다.
//   사장님이 넣으신 데이터가 곧 시간표라, 요일이 바뀌면 저절로 따라갑니다.
//
//   예) 미국 파워볼 → 최근 기록에서 월·수·토가 잡힘 → 마지막이 토요일이면 다음은 월요일
//
// 알아내지 못하면 null을 돌려줍니다. 그때는 draw_date를 비워두고,
// 나중에 결과가 들어올 때 채우면 됩니다(화면은 회차로 안내).
const RECENT_DRAWS_FOR_SCHEDULE = 12;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function inferNextDrawDate(gameId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('draw_results')
    .select('draw_date')
    .eq('game_id', gameId)
    .order('round_no', { ascending: false })
    .limit(RECENT_DRAWS_FOR_SCHEDULE);

  if (error || !data || data.length === 0) {
    if (error) console.error('[watch-register] 추첨일 조회 오류:', error);
    return null;
  }

  // 날짜 문자열을 UTC 자정으로 다룹니다. 시간대 때문에 하루가 밀리는 것을 막습니다.
  const dates = data
    .map((r) => r.draw_date)
    .filter(Boolean)
    .map((s: string) => new Date(String(s).slice(0, 10) + 'T00:00:00Z'))
    .filter((d) => !isNaN(d.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());

  if (dates.length === 0) return null;

  const last = dates[0];
  const weekdays = new Set(dates.map((d) => d.getUTCDay()));

  // 마지막 추첨일 다음날부터 하루씩 나아가며 같은 요일을 찾습니다.
  // 최대 14일까지만 봅니다 — 그보다 드문 추첨이면 추론을 포기합니다.
  for (let i = 1; i <= 14; i++) {
    const cand = new Date(last.getTime() + i * 86400000);
    if (weekdays.has(cand.getUTCDay())) return ymd(cand);
  }
  return null;
}



  let entryId: number | null = null;

  try {
    // ── 로그인 확인 ──
    const userId = await resolveUserId(req);
    if (!userId) return json({ error: 'AUTH_REQUIRED' }, 401);

    const body = await req.json().catch(() => ({}));
    // 🔴 roundNo는 받지 않습니다. 손님이 회차를 고를 수 없고, 건너뛴 미래회차도 없습니다.
    //   submit-entries.ts와 같은 방식으로 서버가 계산합니다.
    const { gameId, lines, bonusLines, timezone } = body;

    // ── 입력 검사 ──
    const rules = GAME_RULES[gameId];
    if (!rules) return json({ error: 'UNKNOWN_GAME' }, 400);

    if (!Array.isArray(lines) || lines.length === 0) return json({ error: 'INVALID_LINES' }, 400);
    if (lines.length > MAX_LINES) {
      return json({ error: 'TOO_MANY_LINES', max: MAX_LINES, got: lines.length }, 400);
    }

    for (let i = 0; i < lines.length; i++) {
      const reason = checkLine(lines[i], rules.main, rules.maxNum);
      if (reason) return json({ error: 'INVALID_LINES', at: i + 1, reason }, 400);
    }

    // 보너스를 직접 입력받는 4종만 검사합니다.
    // 나머지 종목은 운영사가 본번호 풀에서 뽑으므로 손님이 넣을 것이 없습니다.
    let bonus: number[][] = [];
    if (rules.bonus > 0) {
      if (!Array.isArray(bonusLines) || bonusLines.length !== lines.length) {
        return json({ error: 'BONUS_REQUIRED', need: rules.bonus }, 400);
      }
      for (let i = 0; i < bonusLines.length; i++) {
        const reason = checkLine(bonusLines[i], rules.bonus, rules.bonusMax);
        if (reason) return json({ error: 'INVALID_BONUS', at: i + 1, reason }, 400);
      }
      bonus = bonusLines.map((l: unknown[]) => l.map(Number));
    }

    const cleanLines: number[][] = lines.map((l: unknown[]) => l.map(Number));

    // ── 🔴 회차 결정 — 서버가 계산합니다 ──
    // submit-entries.ts와 동일: draw_results의 마지막 회차 + 1이 다음 추첨 회차입니다.
    // 손님은 회차를 고를 수 없고, 건너뛴 미래회차도 없습니다.
    //
    // ⚠ 알려진 빈틈: 추첨이 끝났는데 사장님이 아직 결과를 입력하지 않은 사이에는
    //   이미 끝난 회차가 "다음 회차"로 계산됩니다. 그 시간대에 등록한 손님은
    //   사지도 않은 회차를 기다리게 됩니다.
    //   판매마감 시각으로 막는 것이 정답이며, 설계문서 11절에 이월해두었습니다.
    const { data: lastRow, error: lastErr } = await supabase
      .from('draw_results')
      .select('round_no')
      .eq('game_id', gameId)
      .order('round_no', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastErr) {
      console.error('[watch-register] 회차 조회 오류:', lastErr);
      return json({ error: 'SERVER_ERROR' }, 500);
    }
    const round = (lastRow?.round_no ?? 0) + 1;

    // 다음 추첨 예정일. 회차를 안 쓰는 종목(파워볼·메가밀리언스·유로밀리언스·호주파워볼)은
    // 손님에게 이 날짜를 보여줍니다. 리마인더("추첨일 하루 전")도 이 값을 씁니다.
    const expectedDrawDate = await inferNextDrawDate(gameId);

    // ── ① pending 행을 먼저 저장 ──
    // UNIQUE (user_id, game_id, round_no)가 중복 등록을 여기서 막습니다.
    // 손님이 단추를 두 번 눌러도 두 번째는 23505로 튕겨나가 차감이 일어나지 않습니다.
    const { data: inserted, error: insErr } = await supabase
      .from('watch_entries')
      .insert({
        user_id: userId,
        game_id: gameId,
        round_no: round,
        draw_date: expectedDrawDate,
        lines: cleanLines,
        bonus_lines: bonus,
        line_count: cleanLines.length,
        status: 'pending',
        timezone: timezone || 'Asia/Seoul',
      })
      .select('id')   // ⚠ .select()까지 붙여야 "오류 없이 0건"을 잡을 수 있습니다
      .single();

    if (insErr) {
      // 23505 = unique 위반 → 이미 이 회차에 등록되어 있습니다
      if ((insErr as { code?: string }).code === '23505') {
        const { data: existing } = await supabase
          .from('watch_entries')
          .select('id, line_count, status')
          .eq('user_id', userId)
          .eq('game_id', gameId)
          .eq('round_no', round)
          .maybeSingle();
        return json({
          error: 'ALREADY_REGISTERED',
          entryId: existing?.id ?? null,
          roundNo: round,
          lineCount: existing?.line_count ?? null,
        }, 400);
      }
      console.error('[watch-register] watch_entries 저장 오류:', insErr);
      return json({ error: 'SERVER_ERROR' }, 500);
    }

    entryId = inserted.id;

    // ── ② 가격 조회 (하드코딩 금지 — winning-files-download와 동일한 방식) ──
    const { data: costRow, error: costErr } = await supabase
      .from('point_costs')
      .select('cost_points')
      .eq('action_key', ACTION_KEY)
      .eq('active', true)
      .maybeSingle();

    if (costErr || !costRow) {
      console.error('[watch-register] 가격 조회 실패:', costErr);
      await supabase.from('watch_entries').delete().eq('id', entryId);
      return json({ error: 'PRICE_UNAVAILABLE' }, 500);
    }
    const cost = Number(costRow.cost_points);

    // ── ③ 차감 ──
    let spend;
    try {
      spend = await deductPoints(userId, cost, { actionKey: ACTION_KEY, refId: String(entryId) });
    } catch (e) {
      // deductPoints가 도중에 던진 경우입니다.
      // ⚠ 이때는 일부 lot이 이미 깎였을 수 있습니다(points.ts의 작성자 경고 참조).
      //   금액을 알 수 없어 자동 반환을 못 하므로, 수동 확인이 가능하도록 크게 남깁니다.
      console.error('[watch-register] 🔴 차감 중 예외 — 수동 확인 필요:', {
        userId, entryId, cost, message: String((e as Error).message ?? e),
      });
      await supabase.from('watch_entries').delete().eq('id', entryId);
      return json({ error: 'POINT_ERROR' }, 500);
    }

    if (!spend.success) {
      // ── ⑤ 잔액 부족 → pending 행을 지웁니다. 포인트는 건드리지 않았으므로 안전합니다 ──
      await supabase.from('watch_entries').delete().eq('id', entryId);
      return json({
        error: 'INSUFFICIENT_POINTS',
        shortfall: spend.shortfall,
        balance: spend.balance,
        cost,
      }, 400);
    }

    // ── ④ 차감 성공 → active ──
    const { error: updErr } = await supabase
      .from('watch_entries')
      .update({
        status: 'active',
        points_charged: cost,
        updated_at: new Date().toISOString(),
      })
      .eq('id', entryId);

    if (updErr) {
      // 차감은 끝났는데 상태만 못 바꾼 경우입니다.
      // 행은 남겨둡니다 — pending으로 남아 있으면 나중에 손으로 살릴 수 있고,
      // 여기서 지우면 손님이 돈만 내고 아무 기록도 없게 됩니다.
      console.error('[watch-register] 🔴 차감 후 상태변경 실패 — 수동 확인 필요:', {
        userId, entryId, cost, updErr,
      });
      return json({ error: 'PARTIAL_SUCCESS', entryId, cost }, 500);
    }

    const after = await getBalance(userId).catch(() => ({ total: null }));

    return json({
      success: true,
      entryId,
      gameId,
      roundNo: round,
      drawDate: expectedDrawDate,
      lineCount: cleanLines.length,
      pointsCharged: cost,
      balanceAfter: after.total,
    });
  } catch (err) {
    console.error('[watch-register] 오류:', err);
    // 어디서 터졌든 pending 행이 남아 있으면 치웁니다.
    if (entryId !== null) {
      await supabase.from('watch_entries').delete().eq('id', entryId).eq('status', 'pending');
    }
    return json({ error: String((err as Error).message ?? err) }, 500);
  }
});
