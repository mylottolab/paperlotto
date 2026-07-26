// =====================================================
// PaperLotto — Supabase Edge Function: admin-scrape-draw-results
// 역할: 12개 게임 각각에 대해 "이미 저장된 마지막 회차의 다음 회차"를
//       공식 소스에서 가져오는 것을 시도하고, 성공/실패와 무관하게
//       결과를 scrape_attempts 테이블에 전부 기록합니다.
//       (draw_results에는 직접 쓰지 않습니다 — 관리자가 검수 화면에서
//        승인/수작업해야 draw_results에 반영되는 구조)
//
// 실행 방식: Supabase 대시보드 → Edge Functions → 이 함수 → "스케줄" 설정
// (또는 pg_cron으로 http 확장 이용해 주기적으로 호출) — 매주 각 게임 추첨일
// 다음날 새벽 정도로 잡는 걸 권장합니다.
//
// ⚠️ 중요: 이 코드를 작성하는 시점에 인터넷 접속이 안 되는 환경이라,
// 한국 로또(kr_lotto645)를 제외한 나머지 11개 게임은 실제 소스 URL/응답
// 구조를 검증하지 못했습니다. 그래서 지금은 "미구현" 상태로 명확히
// 실패 처리되도록 해뒀습니다 — 검수 화면에 실패로 뜨고 관리자가 그대로
// 수작업 입력하면 되니 시스템 운영에는 지장이 없습니다.
// 각 게임의 실제 소스가 확인되는 대로 SCRAPERS 객체에 하나씩 채워 넣으면 됩니다.
//
// 배포: supabase functions deploy admin-scrape-draw-results
// =====================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-admin-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ALL_GAME_IDS = [
  'kr_lotto645', 'us_powerball', 'us_megamillions', 'eu_euromillions',
  'jp_loto6', 'jp_loto7', 'jp_miniloto', 'ca_lotto649', 'ca_lottomax',
  'au_powerball', 'au_ozlotto', 'au_tattslotto',
];

type ScrapeResult =
  | { ok: true; roundNo: number; drawDate: string; mainNumbers: number[]; bonusNumbers: number[]; sourceUrl: string; rawResponse: string }
  | { ok: false; roundNo: number | null; errorMessage: string; sourceUrl: string | null; rawResponse: string | null };

// =====================================================
// 게임별 스크래퍼 — nextRoundNo(=DB에 저장된 마지막 회차+1)를 받아서 시도합니다.
// =====================================================
type ScraperFn = (nextRoundNo: number) => Promise<ScrapeResult>;

// ── 한국 로또 6/45 — 동행복권 공식 공개 API 사용 ──
// 참고: 이 API는 개발자들 사이에 널리 알려진 공개 엔드포인트입니다만,
// 배포 후 반드시 한 번 실제로 호출해서 응답 형식이 맞는지 확인해주세요.
const scrapeKrLotto645: ScraperFn = async (nextRoundNo) => {
  const url = `https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=${nextRoundNo}`;
  try {
    const res = await fetch(url, {
      headers: {
        // 일반 브라우저 요청처럼 보이도록 헤더 추가 — 이게 없으면 봇 차단으로 HTML 안내페이지가
        // 대신 내려오면서 JSON.parse가 "Unexpected token '<'" 에러를 내는 경우가 있었음.
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://www.dhlottery.co.kr/gameResult.do?method=byWin',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
      },
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, roundNo: nextRoundNo, errorMessage: `HTTP ${res.status}`, sourceUrl: url, rawResponse: text.slice(0, 2000) };
    }
    const json = JSON.parse(text);
    if (json.returnValue !== 'success') {
      // 아직 추첨 전이거나 회차 번호가 틀린 경우 등
      return { ok: false, roundNo: nextRoundNo, errorMessage: `returnValue=${json.returnValue} (아직 추첨 전이거나 회차 오류)`, sourceUrl: url, rawResponse: text.slice(0, 2000) };
    }
    const mainNumbers = [json.drwtNo1, json.drwtNo2, json.drwtNo3, json.drwtNo4, json.drwtNo5, json.drwtNo6];
    const bonusNumbers = [json.bnusNo];
    if (mainNumbers.some((n) => typeof n !== 'number')) {
      return { ok: false, roundNo: nextRoundNo, errorMessage: '번호 파싱 실패 (응답 형식이 예상과 다름)', sourceUrl: url, rawResponse: text.slice(0, 2000) };
    }
    return {
      ok: true,
      roundNo: nextRoundNo,
      drawDate: json.drwNoDate, // "YYYY-MM-DD" 형식으로 옴
      mainNumbers,
      bonusNumbers,
      sourceUrl: url,
      rawResponse: text.slice(0, 2000),
    };
  } catch (err) {
    return { ok: false, roundNo: nextRoundNo, errorMessage: `요청 실패: ${(err as Error).message}`, sourceUrl: url, rawResponse: null };
  }
};

// ── 아직 미구현 (실제 소스 확인 필요) ──
const notImplemented = (gameId: string): ScraperFn => async (nextRoundNo) => ({
  ok: false,
  roundNo: nextRoundNo,
  errorMessage: `SCRAPER_NOT_IMPLEMENTED: ${gameId}의 실제 소스 URL/응답구조가 아직 코드에 반영되지 않았습니다. 관리자 수작업 입력이 필요합니다.`,
  sourceUrl: null,
  rawResponse: null,
});

const SCRAPERS: Record<string, ScraperFn> = {
  kr_lotto645: scrapeKrLotto645,
  us_powerball: notImplemented('us_powerball'),
  us_megamillions: notImplemented('us_megamillions'),
  eu_euromillions: notImplemented('eu_euromillions'),
  jp_loto6: notImplemented('jp_loto6'),
  jp_loto7: notImplemented('jp_loto7'),
  jp_miniloto: notImplemented('jp_miniloto'),
  ca_lotto649: notImplemented('ca_lotto649'),
  ca_lottomax: notImplemented('ca_lottomax'),
  au_powerball: notImplemented('au_powerball'),
  au_ozlotto: notImplemented('au_ozlotto'),
  au_tattslotto: notImplemented('au_tattslotto'),
};

// =====================================================
// 게임 하나 처리: DB에서 마지막 회차 조회 → 스크래핑 시도 → scrape_attempts에 기록
// =====================================================
async function processGame(gameId: string) {
  // 1) 이미 저장된 마지막 회차 조회
  const { data: lastRow, error: lastErr } = await supabase
    .from('draw_results')
    .select('round_no')
    .eq('game_id', gameId)
    .order('round_no', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastErr) {
    return { gameId, skipped: true, reason: `마지막 회차 조회 실패: ${lastErr.message}` };
  }

  const nextRoundNo = (lastRow?.round_no ?? 0) + 1;

  // 2) 이미 이 회차에 대한 미검수 시도 기록이 있는지 확인
  //    - 성공 기록이 있으면 다시 시도할 필요 없음 → 건너뜀
  //    - 실패 기록이 있으면 재시도 허용 (예: 소스 접근 방식을 고쳐서 다시 시도하는 경우) →
  //      기존 실패 기록은 지우고 새로 기록 (같은 회차가 중복으로 쌓이지 않도록)
  const { data: existingAttempt } = await supabase
    .from('scrape_attempts')
    .select('id, status')
    .eq('game_id', gameId)
    .eq('round_no', nextRoundNo)
    .eq('reviewed', false)
    .maybeSingle();

  if (existingAttempt) {
    if (existingAttempt.status === 'success') {
      return { gameId, skipped: true, reason: `${nextRoundNo}회차는 이미 검수 대기 중인 성공 기록이 있어 건너뜀` };
    }
    // 실패 기록은 재시도를 위해 삭제 후 진행
    await supabase.from('scrape_attempts').delete().eq('id', existingAttempt.id);
  }

  // 3) 스크래핑 시도
  const scraper = SCRAPERS[gameId];
  const result = await scraper(nextRoundNo);

  // 4) 결과 기록
  if (result.ok) {
    const { error: insertErr } = await supabase.from('scrape_attempts').insert({
      game_id: gameId,
      round_no: result.roundNo,
      draw_date: result.drawDate,
      status: 'success',
      source_url: result.sourceUrl,
      raw_response: result.rawResponse,
      parsed_main_numbers: result.mainNumbers,
      parsed_bonus_numbers: result.bonusNumbers,
    });
    if (insertErr) return { gameId, skipped: true, reason: `기록 저장 실패: ${insertErr.message}` };
    return { gameId, status: 'success', roundNo: result.roundNo };
  } else {
    const { error: insertErr } = await supabase.from('scrape_attempts').insert({
      game_id: gameId,
      round_no: result.roundNo,
      status: 'failed',
      source_url: result.sourceUrl,
      raw_response: result.rawResponse,
      error_message: result.errorMessage,
    });
    if (insertErr) return { gameId, skipped: true, reason: `기록 저장 실패: ${insertErr.message}` };
    return { gameId, status: 'failed', roundNo: result.roundNo, error: result.errorMessage };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  // 관리자 키 인증 (스케줄러/cron이 호출할 때도 이 헤더를 실어서 호출해야 합니다)
  const adminKeyRaw = req.headers.get('x-admin-key');
  const expectedKeyRaw = Deno.env.get('ADMIN_API_KEY');
  const adminKey = adminKeyRaw?.trim();
  const expectedKey = expectedKeyRaw?.trim();

  if (!expectedKey || !adminKey || adminKey !== expectedKey) {
    // 값 자체는 로그에 남기지 않고, 진단에 필요한 최소 정보만 남깁니다.
    console.error('[admin-scrape-draw-results] 관리자 키 불일치', {
      receivedKeyPresent: !!adminKeyRaw,
      receivedKeyLength: adminKeyRaw?.length ?? 0,
      expectedKeyPresent: !!expectedKeyRaw,
      expectedKeyLength: expectedKeyRaw?.length ?? 0,
      matchAfterTrim: adminKey === expectedKey,
    });
    return new Response(JSON.stringify({ error: '관리자 인증이 필요합니다.' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const results = [];
    for (const gameId of ALL_GAME_IDS) {
      const r = await processGame(gameId);
      results.push(r);
    }
    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[admin-scrape-draw-results] 오류:', err);
    return new Response(JSON.stringify({ error: String((err as Error).message ?? err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
