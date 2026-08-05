// =====================================================
// PaperLotto — 당첨확인 위젯 (checker)
// 실물복권을 가진 사용자가 회차(또는 추첨일)를 고르고 자기 번호를 입력하면,
// 그 회차의 실제 당첨결과와 대조해서 등수를 바로 알려주는 기능.
// 채점규칙은 admin-save-draw-result.ts / race-advance.ts와 완전히 동일하게 옮겨왔습니다
// (등수 판정 기준이 서로 어긋나면 안 되므로 — 세 곳 모두 항상 같이 유지보수할 것).
//
// 사용법: <div id="myContainer"></div> 를 두고
//   PLChecker.mount('myContainer', 'kr_lotto645', { lang: 'kr' });
// 페이지 안에 여러 개 동시에 mount 가능(각각 독립 상태).
// =====================================================
(function (global) {
  'use strict';

  var SUPABASE_URL = 'https://wzrqaozlbfyejsbvnrxk.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_3KrYMzwrVlbYr-e9d8UiLA_KgvSs8tC';
  var ROUNDS_PAGE_SIZE = 300;

  // ── 게임 메타 (표시명/본번호개수/보너스개수) ──
  var GAME_META = {
    kr_lotto645:     { nameKr: '로또 6/45', nameEn: 'Lotto 6/45', main: 6, bonus: 0 },
    us_powerball:    { nameKr: '파워볼', nameEn: 'Powerball', main: 5, bonus: 1, roundLabel: false },
    us_megamillions: { nameKr: '메가밀리언스', nameEn: 'Mega Millions', main: 5, bonus: 1, roundLabel: false },
    eu_euromillions: { nameKr: '유로밀리언스', nameEn: 'EuroMillions', main: 5, bonus: 2, roundLabel: false },
    jp_miniloto:     { nameKr: '미니로또', nameEn: 'Mini Loto', main: 5, bonus: 1 },
    jp_loto7:        { nameKr: '로또7', nameEn: 'Loto 7', main: 7, bonus: 2 },
    jp_loto6:        { nameKr: '로또6', nameEn: 'Loto 6', main: 6, bonus: 1 },
    ca_lottomax:     { nameKr: '로또맥스', nameEn: 'Lotto Max', main: 7, bonus: 1 },
    ca_lotto649:     { nameKr: '로또 6/49', nameEn: 'Lotto 6/49', main: 6, bonus: 1 },
    au_powerball:    { nameKr: '호주 파워볼', nameEn: 'Australia Powerball', main: 7, bonus: 1, roundLabel: false },
    au_ozlotto:      { nameKr: '오즈로또', nameEn: 'Oz Lotto', main: 7, bonus: 3 },
    au_tattslotto:   { nameKr: '새터데이로또', nameEn: 'Saturday Lotto', main: 6, bonus: 2 },
  };
  // 위 bonus는 "추첨되는 보너스/서플리멘터리 개수"일 뿐, 아래 SEPARATE_BONUS_GAMES에 없는 게임은
  // 그 보너스가 운영사 추첨(본번호 풀에서 뽑힘)이라 사용자가 입력할 필요가 없다 — 본번호만 입력받음.
  var SEPARATE_BONUS_GAMES = { us_powerball: 1, us_megamillions: 1, eu_euromillions: 2, au_powerball: 1 };

  function countMatches(a, b) { var s = {}; b.forEach(function (n) { s[n] = 1; }); return a.filter(function (n) { return s[n]; }).length; }

  // ── 채점규칙: admin-save-draw-result.ts 원본과 완전히 동일 ──
  var GRADE_RULES = {
    kr_lotto645: function (main, bonus, eMain) {
      var m = countMatches(eMain, main), b = bonus.length > 0 && eMain.indexOf(bonus[0]) >= 0;
      if (m === 6) return 1; if (m === 5 && b) return 2; if (m === 5) return 3; if (m === 4) return 4; if (m === 3) return 5; return null;
    },
    jp_loto6: function (main, bonus, eMain) {
      var m = countMatches(eMain, main), b = bonus.length > 0 && eMain.indexOf(bonus[0]) >= 0;
      if (m === 6) return 1; if (m === 5 && b) return 2; if (m === 5) return 3; if (m === 4) return 4; if (m === 3) return 5; return null;
    },
    ca_lotto649: function (main, bonus, eMain) {
      var m = countMatches(eMain, main), b = bonus.length > 0 && eMain.indexOf(bonus[0]) >= 0;
      if (m === 6) return 1; if (m === 5 && b) return 2; if (m === 5) return 3; if (m === 4) return 4; if (m === 3) return 5;
      if (m === 2 && b) return 6; if (m === 2) return 7; return null;
    },
    us_powerball: function (main, bonus, eMain, eBonus) {
      var m = countMatches(eMain, main), pb = bonus.length > 0 && eBonus.length > 0 && eBonus[0] === bonus[0];
      if (m === 5 && pb) return 1; if (m === 5) return 2; if (m === 4 && pb) return 3; if (m === 4) return 4;
      if (m === 3 && pb) return 5; if (m === 3) return 6; if (m === 2 && pb) return 7; if (m === 1 && pb) return 8; if (m === 0 && pb) return 9; return null;
    },
    us_megamillions: function (main, bonus, eMain, eBonus) {
      var m = countMatches(eMain, main), mb = bonus.length > 0 && eBonus.length > 0 && eBonus[0] === bonus[0];
      if (m === 5 && mb) return 1; if (m === 5) return 2; if (m === 4 && mb) return 3; if (m === 4) return 4;
      if (m === 3 && mb) return 5; if (m === 3) return 6; if (m === 2 && mb) return 7; if (m === 1 && mb) return 8; if (m === 0 && mb) return 9; return null;
    },
    eu_euromillions: function (main, bonus, eMain, eBonus) {
      var m = countMatches(eMain, main), s = countMatches(eBonus, bonus);
      if (m === 5 && s === 2) return 1; if (m === 5 && s === 1) return 2; if (m === 5) return 3;
      if (m === 4 && s === 2) return 4; if (m === 4 && s === 1) return 5; if (m === 3 && s === 2) return 6;
      if (m === 4) return 7; if (m === 2 && s === 2) return 8; if (m === 3 && s === 1) return 9; if (m === 3) return 10;
      if (m === 1 && s === 2) return 11; if (m === 2 && s === 1) return 12; if (m === 2) return 13; return null;
    },
    jp_loto7: function (main, bonus, eMain) {
      var m = countMatches(eMain, main), b = countMatches(eMain, bonus) >= 1;
      if (m === 7) return 1; if (m === 6 && b) return 2; if (m === 6) return 3; if (m === 5) return 4; if (m === 4) return 5; if (m === 3 && b) return 6; return null;
    },
    jp_miniloto: function (main, bonus, eMain) {
      var m = countMatches(eMain, main), b = bonus.length > 0 && eMain.indexOf(bonus[0]) >= 0;
      if (m === 5) return 1; if (m === 4 && b) return 2; if (m === 4) return 3; if (m === 3) return 4; return null;
    },
    ca_lottomax: function (main, bonus, eMain) {
      var m = countMatches(eMain, main), b = bonus.length > 0 && eMain.indexOf(bonus[0]) >= 0;
      if (m === 7) return 1; if (m === 6 && b) return 2; if (m === 6) return 3; if (m === 5 && b) return 4; if (m === 5) return 5;
      if (m === 4 && b) return 6; if (m === 4) return 7; if (m === 3 && b) return 8; if (m === 3) return 9; return null;
    },
    au_powerball: function (main, bonus, eMain, eBonus) {
      var m = countMatches(eMain, main), pb = bonus.length > 0 && eBonus.length > 0 && eBonus[0] === bonus[0];
      if (m === 7 && pb) return 1; if (m === 7) return 2; if (m === 6 && pb) return 3; if (m === 6) return 4;
      if (m === 5 && pb) return 5; if (m === 4 && pb) return 6; if (m === 5) return 7; if (m === 3 && pb) return 8; if (m === 2 && pb) return 9; return null;
    },
    au_ozlotto: function (main, bonus, eMain) {
      var m = countMatches(eMain, main), s = countMatches(eMain, bonus);
      if (m === 7) return 1; if (m === 6 && s >= 1) return 2; if (m === 6) return 3; if (m === 5 && s >= 1) return 4;
      if (m === 5) return 5; if (m === 4) return 6; if (m === 3 && s >= 1) return 7; return null;
    },
    au_tattslotto: function (main, bonus, eMain) {
      var m = countMatches(eMain, main), s = countMatches(eMain, bonus);
      if (m === 6) return 1; if (m === 5 && s >= 1) return 2; if (m === 5) return 3; if (m === 4) return 4;
      if (m === 3 && s >= 1) return 5; if (s === 2) return 6; return null;
    },
  };

  var T = {
    kr: {
      pickRound: '회차 선택', main: '내 번호 (본번호)', bonusSep: '보너스 번호',
      placeholder: '예: 3 12 25 34 41 45 (스페이스로 구분)', check: '당첨 확인', loadMore: '더 예전 회차 불러오기',
      loading: '불러오는 중...', win: '등 당첨입니다!', lose: '아쉽지만 낙첨입니다.', matched: '일치',
      needCount: '개 입력해주세요', selectRound: '먼저 회차를 선택해주세요', invalidRange: '올바른 번호를 입력해주세요',
      ocr: '사진으로 인식', ocrRunning: '사진 분석 중... (시간이 좀 걸려요)', ocrFail: '번호를 못 읽었어요. 직접 입력해주세요.',
      ocrPartial: '번호를 인식했어요 — 맞는지 확인하고 눌러주세요.', resultDate: '추첨일',
    },
    en: {
      pickRound: 'Select draw', main: 'My Numbers', bonusSep: 'Bonus Numbers',
      placeholder: 'e.g. 3 12 25 34 41 45 (space-separated)', check: 'Check Result', loadMore: 'Load older draws',
      loading: 'Loading...', win: '-tier winner!', lose: 'Sorry, not a winner this time.', matched: 'matched',
      needCount: ' numbers needed', selectRound: 'Please select a draw first', invalidRange: 'Please enter valid numbers',
      ocr: 'Scan photo', ocrRunning: 'Analyzing photo... (may take a moment)', ocrFail: "Couldn't read the numbers — please enter manually.",
      ocrPartial: 'Numbers detected — please verify before checking.', resultDate: 'Draw date',
    },
  };

  function parseNums(str) {
    return (str || '').split(/[\s,，、]+/).map(function (s) { return s.trim(); }).filter(Boolean).map(Number).filter(function (n) { return Number.isFinite(n); });
  }

  function fetchRounds(gameId, offset) {
    var url = SUPABASE_URL + '/rest/v1/draw_results?select=round_no,draw_date&game_id=eq.' + gameId
      + '&order=round_no.desc&offset=' + offset + '&limit=' + ROUNDS_PAGE_SIZE;
    return fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY } }).then(function (r) { return r.ok ? r.json() : []; });
  }

  function fetchRoundDetail(gameId, roundNo) {
    var url = SUPABASE_URL + '/rest/v1/draw_results?select=round_no,draw_date,main_numbers,bonus_numbers&game_id=eq.' + gameId + '&round_no=eq.' + roundNo + '&limit=1';
    return fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY } })
      .then(function (r) { return r.ok ? r.json() : []; }).then(function (rows) { return rows[0] || null; });
  }

  function mount(containerId, gameId, opts) {
    opts = opts || {};
    var lang = opts.lang === 'en' ? 'en' : 'kr';
    var t = T[lang];
    var meta = GAME_META[gameId];
    var el = document.getElementById(containerId);
    if (!el || !meta) return;

    var needsSeparateBonus = !!SEPARATE_BONUS_GAMES[gameId];
    var bonusCount = SEPARATE_BONUS_GAMES[gameId] || 0;
    var state = { offset: 0, rounds: [], selectedRound: null };

    el.innerHTML =
      '<div class="plck-box">' +
        '<label class="plck-label">' + t.pickRound + '</label>' +
        '<select class="plck-select" id="' + containerId + '_round"><option value="">' + t.loading + '</option></select>' +
        '<div class="plck-loadmore" id="' + containerId + '_loadmore" style="display:none;">' + t.loadMore + '</div>' +
        '<label class="plck-label" style="margin-top:14px;">' + t.main + ' (' + meta.main + t.needCount + ')</label>' +
        '<input class="plck-input" id="' + containerId + '_main" placeholder="' + t.placeholder + '" inputmode="numeric" autocomplete="off">' +
        (needsSeparateBonus ? (
          '<label class="plck-label" style="margin-top:10px;">' + t.bonusSep + ' (' + bonusCount + t.needCount + ')</label>' +
          '<input class="plck-input" id="' + containerId + '_bonus" placeholder="' + (bonusCount === 1 ? '예: 24' : '예: 4 9') + '" inputmode="numeric" autocomplete="off">'
        ) : '') +
        '<div class="plck-row">' +
          '<button class="plck-btn plck-btn-ghost" id="' + containerId + '_ocrbtn" type="button">📷 ' + t.ocr + '</button>' +
          '<input type="file" accept="image/*" capture="environment" id="' + containerId + '_ocrfile" style="display:none;">' +
          '<button class="plck-btn plck-btn-primary" id="' + containerId + '_checkbtn" type="button">' + t.check + '</button>' +
        '</div>' +
        '<div class="plck-result" id="' + containerId + '_result"></div>' +
      '</div>';

    var roundSelect = document.getElementById(containerId + '_round');
    var loadMoreBtn = document.getElementById(containerId + '_loadmore');
    var resultBox = document.getElementById(containerId + '_result');
    var mainInput = document.getElementById(containerId + '_main');
    var bonusInput = document.getElementById(containerId + '_bonus');
    var ocrBtn = document.getElementById(containerId + '_ocrbtn');
    var ocrFile = document.getElementById(containerId + '_ocrfile');
    var checkBtn = document.getElementById(containerId + '_checkbtn');

    function renderRoundOptions(rows, append) {
      var opts2 = rows.map(function (r) {
        return '<option value="' + r.round_no + '">' + r.draw_date + ' (#' + r.round_no + ')</option>';
      }).join('');
      roundSelect.innerHTML = (append ? roundSelect.innerHTML : '') + opts2;
    }

    function loadRounds(append) {
      fetchRounds(gameId, state.offset).then(function (rows) {
        if (!append) roundSelect.innerHTML = '';
        renderRoundOptions(rows, true);
        state.rounds = state.rounds.concat(rows);
        state.offset += rows.length;
        loadMoreBtn.style.display = rows.length >= ROUNDS_PAGE_SIZE ? 'block' : 'none';
        if (!append && rows.length) roundSelect.value = rows[0].round_no;
      });
    }
    loadRounds(false);
    loadMoreBtn.addEventListener('click', function () { loadRounds(true); });

    function showResult(html, kind) {
      resultBox.className = 'plck-result show plck-result-' + kind;
      resultBox.innerHTML = html;
    }

    checkBtn.addEventListener('click', function () {
      var roundNo = roundSelect.value;
      if (!roundNo) { showResult(t.selectRound, 'warn'); return; }
      var mainNums = parseNums(mainInput.value);
      var bonusNums = needsSeparateBonus ? parseNums(bonusInput.value) : [];
      if (mainNums.length !== meta.main || (needsSeparateBonus && bonusNums.length !== bonusCount)) {
        showResult(t.invalidRange, 'warn'); return;
      }
      showResult(t.loading, 'warn');
      fetchRoundDetail(gameId, roundNo).then(function (draw) {
        if (!draw) { showResult(t.invalidRange, 'warn'); return; }
        var gradeFn = GRADE_RULES[gameId];
        var grade = gradeFn(draw.main_numbers || [], draw.bonus_numbers || [], mainNums, bonusNums);
        var matchedCount = countMatches(mainNums, draw.main_numbers || []);
        var drawBallsHtml = (draw.main_numbers || []).map(function (n) { return '<span class="plck-ball">' + n + '</span>'; }).join('')
          + ((draw.bonus_numbers || []).length ? '<span class="plck-plus">+</span>' + draw.bonus_numbers.map(function (n) { return '<span class="plck-ball plck-ball-bonus">' + n + '</span>'; }).join('') : '');
        var header = '<div class="plck-drawinfo">' + t.resultDate + ': ' + draw.draw_date + ' (#' + draw.round_no + ')<div class="plck-drawballs">' + drawBallsHtml + '</div></div>';
        if (grade) {
          showResult(header + '<div class="plck-grade-win">🎉 ' + grade + t.win + '</div><div class="plck-grade-sub">' + matchedCount + t.matched + '</div>', 'win');
        } else {
          showResult(header + '<div class="plck-grade-lose">' + t.lose + '</div><div class="plck-grade-sub">' + matchedCount + t.matched + '</div>', 'lose');
        }
      });
    });

    // ── OCR (Tesseract.js, 브라우저에서만 돎 — 서버 전송 없음) ──
    ocrBtn.addEventListener('click', function () { ocrFile.click(); });
    ocrFile.addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      showResult(t.ocrRunning, 'warn');
      ensureTesseract().then(function () {
        var img = URL.createObjectURL(file);
        global.Tesseract.recognize(img, 'eng', {}).then(function (res) {
          URL.revokeObjectURL(img);
          var text = (res && res.data && res.data.text) || '';
          var nums = (text.match(/\d{1,2}/g) || []).map(Number).filter(function (n) { return n >= 1 && n <= 90; });
          var uniq = nums.filter(function (n, i) { return nums.indexOf(n) === i; });
          if (!uniq.length) { showResult(t.ocrFail, 'warn'); return; }
          var mainGuess = uniq.slice(0, meta.main);
          mainInput.value = mainGuess.join(' ');
          if (needsSeparateBonus && uniq.length > meta.main) {
            bonusInput.value = uniq.slice(meta.main, meta.main + bonusCount).join(' ');
          }
          showResult(t.ocrPartial, 'warn');
        }).catch(function () { showResult(t.ocrFail, 'warn'); });
      });
    });
  }

  var tesseractLoading = null;
  function ensureTesseract() {
    if (global.Tesseract) return Promise.resolve();
    if (tesseractLoading) return tesseractLoading;
    tesseractLoading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
    return tesseractLoading;
  }

  global.PLChecker = { mount: mount, GAME_META: GAME_META, GRADE_RULES: GRADE_RULES, SEPARATE_BONUS_GAMES: SEPARATE_BONUS_GAMES };
})(window);
