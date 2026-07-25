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

  function loadSupabaseScript() {
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
      s.onload = resolve;
      document.head.appendChild(s);
    });
  }

  // 페이지의 언어 전환(각 페이지 applyLang 함수가 document.documentElement.lang을 바꿔줌)에
  // 맞춰 위젯 라벨(로그인/충전/로그아웃)도 같이 갱신되도록 감시
  const langObserver = new MutationObserver(() => render());
  langObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
