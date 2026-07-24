// =====================================================
// PaperLotto — auth-widget.js
// 모든 페이지 헤더에 공통으로 붙는 로그인 상태 / 포인트 잔액 / 충전 위젯
// 사용법: 각 페이지 <nav> 안, lang-toggle 근처에
//   <div id="authWidget"></div>
// 를 넣고, </body> 직전에
//   <script src="auth-widget.js"></script>
// 를 추가하면 됩니다.
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
    .auth-widget{ display:flex; align-items:center; gap:10px; font-size:12.5px; }
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
    .auth-user-email{ color:#a7adc7; white-space:nowrap; max-width:120px; overflow:hidden; text-overflow:ellipsis; }
    .auth-logout-btn{
      background:none; border:none; color:#6b7195; cursor:pointer; font-size:12px;
      text-decoration:underline; padding:0; font-family:inherit; white-space:nowrap;
    }
    .auth-logout-btn:hover{ color:#a7adc7; }
    @media (max-width:640px){
      .auth-widget{ font-size:11px; gap:6px; }
      .auth-user-email{ display:none; } /* 좁은 화면에선 이메일 생략, 포인트/버튼만 */
      .auth-login-btn{ padding:4px 10px; }
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

    el.innerHTML = `<span class="auth-points">🪙 ${t.loading}</span>
      <a class="auth-charge-btn" href="${RECHARGE_PAGE}">${t.charge}</a>
      <span class="auth-user-email">${session.user.email || ''}</span>
      <button class="auth-logout-btn" id="authLogoutBtn">${t.logout}</button>`;

    document.getElementById('authLogoutBtn').addEventListener('click', async () => {
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
