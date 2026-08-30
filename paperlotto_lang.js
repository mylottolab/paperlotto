// =====================================================
// PaperLotto — 언어 판별 공용 파일
// 2026-08-31 (15차) 신설
//
// 🔴 왜 만들었나
//   화면마다 기본 언어가 제각각이었습니다.
//     paperlotto_checker.html        → 'ko'
//     paperlotto_detail_powerball    → 'en'
//     paperlotto_login_connected     → select 기본값 'en'
//   같은 사이트인데 페이지를 옮길 때마다 언어가 바뀔 수 있었습니다.
//   또 기본을 하나로 고정하면 어느 한쪽 손님은 반드시 남의 언어를 보게 됩니다.
//
// 🔴 정하는 순서
//   1. 주소의 ?lang=en        광고·메일 링크에서 언어를 지정할 때
//   2. localStorage           손님이 화면에서 고른 값
//   3. 브라우저 언어           한국어면 ko, 일본어면 ja, 나머지는 en
//
//   영어권을 주 대상으로 하지만, 브라우저가 한국어인 손님까지 영어로 만들 이유는
//   없습니다. 브라우저 언어를 따르면 양쪽 다 맞습니다.
//
// 쓰는 법 — 각 화면의 <head> 또는 다른 스크립트보다 먼저 불러오세요.
//   <script src="paperlotto_lang.js"></script>
//   var currentLang = window.getPaperLottoLang();      // 'ko' | 'en' | 'ja'
//   window.setPaperLottoLang('ja');                    // 손님이 바꿨을 때
//
// ⚠ 이 파일이 없어도 화면이 죽지 않도록, 각 화면에는 같은 계산을 하는
//   대비책을 함께 넣어두었습니다.
// =====================================================

(function () {
  // 다른 파일이 먼저 정의했으면 그대로 둡니다 (중복 정의 방지)
  if (typeof window.getPaperLottoLang === 'function') return;

  var KEY = 'paperlotto_lang';
  window.PAPERLOTTO_LANG_KEY = KEY;

  function norm(v) {
    var l = String(v || '').toLowerCase();
    if (l.indexOf('ko') === 0) return 'ko';
    if (l.indexOf('ja') === 0 || l.indexOf('jp') === 0) return 'ja';
    return 'en';   // 기본은 영어
  }
  window.normPaperLottoLang = norm;

  window.getPaperLottoLang = function () {
    // ① 주소로 지정한 언어가 가장 우선입니다.
    //    영어권 광고에서 ?lang=en 을 달아 보내면 브라우저 설정과 무관하게 영어로 열립니다.
    try {
      var q = new URLSearchParams(window.location.search).get('lang');
      if (q) return norm(q);
    } catch (e) {}

    // ② 손님이 화면에서 고른 값
    try {
      var v = localStorage.getItem(KEY);
      if (v) return norm(v);
    } catch (e) {}

    // ③ 브라우저 언어
    var nav = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
    return norm(nav);
  };

  window.setPaperLottoLang = function (lang) {
    var v = norm(lang);
    try { localStorage.setItem(KEY, v); } catch (e) {}
    return v;
  };
})();
