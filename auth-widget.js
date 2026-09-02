// =====================================================
// PaperLotto — auth-widget.js
// 모든 페이지 헤더에 공통으로 붙는 로그인 상태 / 포인트 잔액 / 충전 위젯
// 사용법: 각 페이지 <nav> 안, lang-toggle 근처에
//   <div id="authWidget"></div>
// 를 넣고, </body> 직전에
//   <script src="auth-widget.js"></script>
// 를 추가하면 됩니다.
//
// [2026-07-26 수정] 한 줄에 포인트/Charge/이메일/로그아웃이 다 나열되어 있던 걸
// 2줄로 분리: 윗줄 = 포인트 + Charge 버튼, 아랫줄 = 이메일 + 로그아웃.
// =====================================================

(function () {
  const SUPABASE_URL = "https://wzrqaozlbfyejsbvnrxk.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_3KrYMzwrVlbYr-e9d8UiLA_KgvSs8tC";
  const LOGIN_PAGE = "paperlotto_login_connected.html";
  const RECHARGE_PAGE = "paperlotto_recharge_mockup.html";
  const BALANCE_FN_URL = `${SUPABASE_URL}/functions/v1/points-balance`;

  const LABELS = {
    ko: { login: "로그인", charge: "충전", logout: "로그아웃", loading: "…" },
    en: { login: "Log in", charge: "Charge", logout: "Log out", loading: "…" },
    ja: { login: "ログイン", charge: "チャージ", logout: "ログアウト", loading: "…" },
  };
  function currentLabels() {
    const lang = document.documentElement.lang;
    return LABELS[lang] || LABELS.ko;
  }

  const style = document.createElement('style');
  style.textContent = `
    .auth-widget{ display:flex; flex-direction:column; align-items:flex-end; gap:4px; font-size:12.5px; margin-top:2px; }
    .auth-widget-row{ display:flex; align-items:center; gap:10px; }
    .auth-login-btn{
      color:inherit; text-decoration:none; border:1px solid rgba(167,173,199,0.35);
      border-radius:16px; padding:5px 14px; white-space:nowrap;
    }
    .auth-login-btn:hover{ border-color:rgba(224,170,78,0.6); color:#e0aa4e; }
    .auth-points{
      font-family:'IBM Plex Mono',monospace; color:#e0aa4e; white-space:nowrap;
      display:flex; align-items:center; gap:4px;
    }
    .auth-charge-btn{
      color:inherit; text-decoration:none; background:#b8862e; color:#1c2130 !important;
      border-radius:14px; padding:4px 11px; font-weight:600; white-space:nowrap;
    }
    .auth-charge-btn:hover{ background:#e0aa4e; }
    .auth-user-email{ color:#a7adc7; white-space:nowrap; max-width:140px; overflow:hidden; text-overflow:ellipsis; font-size:11px; }
    .auth-logout-btn{
      background:none; border:none; color:#6b7195; cursor:pointer; font-size:11px;
      text-decoration:underline; padding:6px 2px; font-family:inherit; white-space:nowrap;
      -webkit-tap-highlight-color:transparent;
    }
    .auth-logout-btn:hover{ color:#a7adc7; }
    @media (max-width:640px){
      .auth-widget{ font-size:11px; gap:5px; }
      .auth-widget-row{ gap:10px; }
      .auth-user-email{ max-width:100px; }
      .auth-login-btn{ padding:4px 10px; }
      .auth-logout-btn{ padding:8px 4px; font-size:12px; } /* 터치 영역 확대 — 실수로 로그아웃 방지 */
    }
  `;
  document.head.appendChild(style);

  function fmtPoints(n) {
    return Number(n || 0).toLocaleString();
  }

  async function render() {
    const el = document.getElementById('authWidget');
    if (!el) return;
    const t = currentLabels();

    if (!window.supabase) {
      // supabase-js가 아직 로드 안 된 페이지라면 스크립트를 동적으로 붙여서 로드
      await loadSupabaseScript();
    }
    const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    const { data: { session } } = await sb.auth.getSession();

    if (!session) {
      el.innerHTML = `<a class="auth-login-btn" href="${LOGIN_PAGE}">${t.login}</a>`;
      return;
    }

    el.innerHTML = `
      <div class="auth-widget-row">
        <span class="auth-points">🪙 ${t.loading}</span>
        <a class="auth-charge-btn" href="${RECHARGE_PAGE}">${t.charge}</a>
      </div>
      <div class="auth-widget-row">
        <span class="auth-user-email">${session.user.email || ''}</span>
        <button class="auth-logout-btn" id="authLogoutBtn">${t.logout}</button>
      </div>`;

    document.getElementById('authLogoutBtn').addEventListener('click', async () => {
      const confirmMsg = t === LABELS.en ? 'Log out?' : t === LABELS.ja ? 'ログアウトしますか？' : '로그아웃 하시겠습니까?';
      if (!confirm(confirmMsg)) return;
      await sb.auth.signOut();
      location.reload();
    });

    try {
      const res = await fetch(BALANCE_FN_URL, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const balance = await res.json();
        const pointsEl = el.querySelector('.auth-points');
        if (pointsEl) pointsEl.innerHTML = `🪙 <b>${fmtPoints(balance.total)}</b>P`;
      }
    } catch (err) {
      console.error('[auth-widget] 잔액 조회 실패', err);
    }
  }

  // 다른 페이지의 스크립트(베팅, 추천번호 구매 등 포인트를 차감하는 동작 직후)에서
  // window.refreshAuthBalance() 를 호출하면, 전체 위젯을 다시 그리지 않고 포인트 숫자만
  // 서버에서 다시 조회해서 갱신합니다. (전체 render()는 로그아웃 버튼 리스너를 매번 새로
  // 붙이는 등 무거우므로, 잔액만 가벼운게 다시 읽어오는 전용 함수를 따로 둠)
  window.refreshAuthBalance = async function () {
    const el = document.getElementById('authWidget');
    if (!el) return;
    const pointsEl = el.querySelector('.auth-points');
    if (!pointsEl) return; // 로그인 안 된 상태(로그인 버튼만 있음)면 갱신할 게 없음
    if (!window.supabase) await loadSupabaseScript();
    const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;
    try {
      const res = await fetch(BALANCE_FN_URL, { headers: { Authorization: `Bearer ${session.access_token}` } });
      if (res.ok) {
        const balance = await res.json();
        pointsEl.innerHTML = `🪙 <b>${fmtPoints(balance.total)}</b>P`;
      }
    } catch (err) {
      console.error('[auth-widget] refreshAuthBalance 실패', err);
    }
  };

  function loadSupabaseScript() {
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
      s.onload = resolve;
      document.head.appendChild(s);
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // 방문 기록 (2026-09-02 신설)
  //
  // 🔴 왜 여기 붙였나:
  //   이 파일이 모든 화면의 머리말에 이미 실려 있습니다. 화면마다 따로
  //   붙이면 언젠가 빠뜨린 화면이 생기고, 그 화면만 통계에서 사라집니다.
  //
  // 🔴 개인을 식별하지 않습니다.
  //   브라우저가 스스로 만든 임의의 번호만 씁니다. 로그인 여부와 무관합니다.
  //   ⚠ 여기에 이메일이나 user_id 를 넣지 마세요. 넣는 순간
  //     "누가 무엇을 봤는지"가 되어 개인정보가 됩니다.
  //
  // 🔴 navigator.sendBeacon 을 쓰지 않습니다.
  //   sendBeacon 은 언제나 쿠키를 함께 보내는데(credentials=include),
  //   서버가 CORS 를 '*' 로 열어두면 브라우저가 그 조합을 막습니다.
  //   My Lotto Lab 이 그 이유로 방문 기록이 통째로 막혀 있었습니다(2026-09-02 발견).
  //   fetch 는 기본이 'same-origin' 이라 다른 도메인에는 쿠키를 안 보냅니다.
  //
  // 🔴 실패해도 화면에 영향을 주지 않습니다. 통계 때문에 화면이 멈추면 안 됩니다.
  // ═══════════════════════════════════════════════════════════════════
  const TRACK_FN_URL = `${SUPABASE_URL}/functions/v1/track-visit`;

  function getOrCreateVisitorId() {
    const key = 'paperlotto_vid';
    try {
      let vid = localStorage.getItem(key);
      if (!vid) {
        vid = 'v_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem(key, vid);
      }
      return vid;
    } catch (e) {
      // 저장을 막아둔 브라우저 — 그래도 방문 수는 세어집니다(사람 수만 부정확).
      return 'v_nostorage';
    }
  }

  // 포워딩 도메인으로 들어왔을 때(?entry=도메인명) 최초 1회 잡아 세션 내내 유지합니다.
  // 예: 광고에 allimlotto.com/?entry=ad_google 을 걸어두면 그 방문과
  //     이어지는 같은 세션의 다른 화면들이 전부 "ad_google 로 들어온 방문"이 됩니다.
  // ⚠ 이것이 없으면 어느 광고가 손님을 데려왔는지 알 수 없습니다.
  function getEntryDomain() {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get('entry');
      if (fromUrl) {
        sessionStorage.setItem('paperlotto_entry_domain', fromUrl);
        return fromUrl;
      }
      return sessionStorage.getItem('paperlotto_entry_domain') || '';
    } catch (e) {
      return '';
    }
  }

  function trackVisit() {
    try {
      const payload = JSON.stringify({
        path: window.location.pathname,
        referrer: document.referrer || '',
        visitorId: getOrCreateVisitorId(),
        entryDomain: getEntryDomain(),
        // ⚠ 언어를 함께 보냅니다. 영어권 광고의 효과를 이 값으로 잽니다.
        //   화면이 아직 언어를 정하기 전일 수 있어 저장값도 함께 봅니다.
        lang: document.documentElement.lang ||
              (function(){ try { return localStorage.getItem('paperlotto_lang') || ''; } catch(e) { return ''; } })(),
      });

      fetch(TRACK_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(function () { /* 통계 실패는 조용히 무시 */ });
    } catch (e) { /* 통계 실패는 조용히 무시 */ }
  }

  // 페이지의 언어 전환(각 페이지 applyLang 함수가 document.documentElement.lang을 바꿔줌)에
  // 맞춰 위젯 라벨(로그인/충전/로그아웃)도 같이 갱신되도록 감시
  const langObserver = new MutationObserver(() => render());
  langObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
    // ⚠ 방문 기록은 위젯이 그려지는 것과 무관하게 한 번만 보냅니다.
    //   render() 안에 넣으면 언어를 바꿀 때마다 다시 불려 방문 수가 부풀려집니다.
    document.addEventListener('DOMContentLoaded', trackVisit);
  } else {
    render();
    trackVisit();
  }
})();
