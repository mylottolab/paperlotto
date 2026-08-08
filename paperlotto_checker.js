// =====================================================
// PaperLotto — 당첨확인 위젯 (checker)
// 실물복권을 가진 사용자가 회차(또는 추첨일)를 고르고 자기 번호를 입력하면,
// 그 회차의 실제 당첨결과와 대조해서 등수를 바로 알려주는 기능.
// 채점규칙은 admin-save-draw-result.ts / race-advance.ts와 완전히 동일하게 옮겨왔습니다
// (등수 판정 기준이 서로 어긋나면 안 되므로 — 세 곳 모두 항상 같이 유지보수할 것).
//
// 사용법: <div id="myContainer"></div> 를 두고
//   PLChecker.mount('myContainer', 'kr_lotto645', { lang: 'ko' });
// 페이지 안에 여러 개 동시에 mount 가능(각각 독립 상태).
// =====================================================
(function (global) {
  'use strict';

  var SUPABASE_URL = 'https://wzrqaozlbfyejsbvnrxk.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_3KrYMzwrVlbYr-e9d8UiLA_KgvSs8tC';
  var ROUNDS_PAGE_SIZE = 300;

  // ── 게임 메타 (표시명/본번호개수/보너스개수) ──
  var GAME_META = {
    kr_lotto645:     { nameKr: '로또 6/45', nameEn: 'Lotto 6/45', nameJa: 'ロト6/45', main: 6, bonus: 0 },
    us_powerball:    { nameKr: '파워볼', nameEn: 'Powerball', nameJa: 'パワーボール', main: 5, bonus: 1, roundLabel: false },
    us_megamillions: { nameKr: '메가밀리언스', nameEn: 'Mega Millions', nameJa: 'メガミリオンズ', main: 5, bonus: 1, roundLabel: false },
    eu_euromillions: { nameKr: '유로밀리언스', nameEn: 'EuroMillions', nameJa: 'ユーロミリオンズ', main: 5, bonus: 2, roundLabel: false },
    jp_miniloto:     { nameKr: '미니로또', nameEn: 'Mini Loto', nameJa: 'ミニロト', main: 5, bonus: 1 },
    jp_loto7:        { nameKr: '로또7', nameEn: 'Loto 7', nameJa: 'ロト7', main: 7, bonus: 2 },
    jp_loto6:        { nameKr: '로또6', nameEn: 'Loto 6', nameJa: 'ロト6', main: 6, bonus: 1 },
    ca_lottomax:     { nameKr: '로또맥스', nameEn: 'Lotto Max', nameJa: 'ロトマックス', main: 7, bonus: 1 },
    ca_lotto649:     { nameKr: '로또 6/49', nameEn: 'Lotto 6/49', nameJa: 'ロト6/49', main: 6, bonus: 1 },
    au_powerball:    { nameKr: '호주 파워볼', nameEn: 'Australia Powerball', nameJa: '豪パワーボール', main: 7, bonus: 1, roundLabel: false },
    au_ozlotto:      { nameKr: '오즈로또', nameEn: 'Oz Lotto', nameJa: 'オズロト', main: 7, bonus: 3 },
    au_tattslotto:   { nameKr: '새터데이로또', nameEn: 'Saturday Lotto', nameJa: 'サタデーロト', main: 6, bonus: 2 },
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
    ko: {
      pickRound: '회차 선택', main: '내 번호 (본번호)', bonusSep: '보너스 번호',
      placeholder: '예: 3 12 25 34 41 45 (스페이스로 구분)', check: '당첨 확인', loadMore: '더 예전 회차 불러오기',
      loading: '불러오는 중...', win: '등 당첨입니다!', lose: '아쉽지만 낙첨입니다.', matched: '일치',
      needCount: '개 입력해주세요', selectRound: '먼저 회차를 선택해주세요', invalidRange: '올바른 번호를 입력해주세요',
      ocr: '사진으로 인식', ocrRunning: '사진 분석 중... (시간이 좀 걸려요)', ocrFail: '번호를 못 읽었어요. 직접 입력해주세요.',
      ocrPartial: '번호를 인식했어요 — 맞는지 확인하고 눌러주세요.', resultDate: '추첨일',
      addCombo: '+ 조합 추가', comboLabel: '조합', ocrNote: '⚠️ 카메라인식과 작업상 다소 불편함이 있음을 양해해 주시기 바랍니다.',
      qrScan: '🔍 QR코드로 회차·번호 자동입력', qrRunning: '카메라로 QR코드를 찾는 중... 표적 안에 맞춰주세요',
      qrFail: 'QR코드를 읽지 못했어요. 사진으로 인식 또는 직접입력을 이용해주세요.',
      qrOk: '✅ {round}회차, {count}개 조합을 QR코드에서 자동으로 채웠어요. 맞는지 확인하고 눌러주세요.',
      camStop: '종료',
    },
    en: {
      pickRound: 'Select draw', main: 'My Numbers', bonusSep: 'Bonus Numbers',
      placeholder: 'e.g. 3 12 25 34 41 45 (space-separated)', check: 'Check Result', loadMore: 'Load older draws',
      loading: 'Loading...', win: '-tier winner!', lose: 'Sorry, not a winner this time.', matched: 'matched',
      needCount: ' numbers needed', selectRound: 'Please select a draw first', invalidRange: 'Please enter valid numbers',
      ocr: 'Scan photo', ocrRunning: 'Analyzing photo... (may take a moment)', ocrFail: "Couldn't read the numbers — please enter manually.",
      ocrPartial: 'Numbers detected — please verify before checking.', resultDate: 'Draw date',
      addCombo: '+ Add combo', comboLabel: 'Combo', ocrNote: '⚠️ Please note that camera recognition and manual entry may be a bit inconvenient.',
      qrScan: '🔍 Auto-fill via QR code', qrRunning: 'Looking for a QR code... Align it inside the frame',
      qrFail: "Couldn't read the QR code — try Scan photo or manual entry.",
      qrOk: '✅ Auto-filled draw #{round} with {count} combo(s) from the QR code. Please verify before checking.',
      camStop: 'Stop',
    },
    ja: {
      pickRound: '回を選択', main: '自分の番号（本数字）', bonusSep: 'ボーナス番号',
      placeholder: '例: 3 12 25 34 41 45（スペース区切り）', check: '当選確認', loadMore: 'もっと過去の回を読み込む',
      loading: '読み込み中...', win: '等当選です！', lose: '残念ながら落選です。', matched: '一致',
      needCount: '個入力してください', selectRound: 'まず回を選択してください', invalidRange: '正しい番号を入力してください',
      ocr: '写真で読み取る', ocrRunning: '写真を解析中...（少し時間がかかります）', ocrFail: '番号を読み取れませんでした。直接入力してください。',
      ocrPartial: '番号を認識しました — 確認してから押してください。', resultDate: '抽選日',
      addCombo: '+ 組み合わせ追加', comboLabel: '組み合わせ', ocrNote: '⚠️ カメラ認識や手作業には多少の不便があることをご了承ください。',
      qrScan: '🔍 QRコードで自動入力', qrRunning: 'QRコードを探しています...枠内に合わせてください',
      qrFail: 'QRコードを読み取れませんでした。写真認識または直接入力をご利用ください。',
      qrOk: '✅ QRコードから第{round}回、{count}組を自動入力しました。確認してから押してください。',
      camStop: '終了',
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
    var lang = (opts.lang === 'en' || opts.lang === 'ja') ? opts.lang : 'ko';
    var t = T[lang];
    var meta = GAME_META[gameId];
    var el = document.getElementById(containerId);
    if (!el || !meta) return;

    var needsSeparateBonus = !!SEPARATE_BONUS_GAMES[gameId];
    var bonusCount = SEPARATE_BONUS_GAMES[gameId] || 0;
    var state = { offset: 0, rounds: [] };
    var comboSeq = 0;

    function comboRowHtml(idx) {
      return (
        '<div class="plck-combo-row" data-idx="' + idx + '">' +
          '<div class="plck-combo-inputs">' +
            '<input class="plck-input plck-combo-main" placeholder="' + t.placeholder + '" inputmode="numeric" autocomplete="off">' +
            (needsSeparateBonus ? '<input class="plck-input plck-combo-bonus" placeholder="' + (bonusCount === 1 ? '예: 24' : '예: 4 9') + '" inputmode="numeric" autocomplete="off">' : '') +
          '</div>' +
          '<div class="plck-combo-actions">' +
            '<button class="plck-icon-btn plck-combo-ocr" type="button" title="' + t.ocr + '">📷</button>' +
            '<input type="file" accept="image/*" capture="environment" class="plck-combo-ocrfile" style="display:none;">' +
            '<button class="plck-icon-btn plck-combo-remove" type="button" title="remove">✕</button>' +
          '</div>' +
        '</div>'
      );
    }

    var camScan = CAMERA_SCAN_CONFIG[gameId]; // 이 게임이 실시간 카메라 스캔을 지원하는지

    el.innerHTML =
      '<div class="plck-box">' +
        '<label class="plck-label">' + t.pickRound + '</label>' +
        '<select class="plck-select" id="' + containerId + '_round"><option value="">' + t.loading + '</option></select>' +
        '<div class="plck-loadmore" id="' + containerId + '_loadmore" style="display:none;">' + t.loadMore + '</div>' +
        (camScan ?
          '<div class="plck-row" style="margin-top:10px;">' +
            '<button class="plck-btn plck-btn-ghost" type="button" id="' + containerId + '_qrbtn" style="flex:1;">' + t.qrScan + '</button>' +
          '</div>' +
          '<div class="plck-camview" id="' + containerId + '_camview" style="display:none;"></div>' +
          '<div class="plck-camctrls" id="' + containerId + '_camctrls" style="display:none;">' +
            '<button class="plck-btn plck-btn-ghost" type="button" id="' + containerId + '_camstop">⏹ ' + t.camStop + '</button>' +
            '<button class="plck-btn plck-btn-ghost" type="button" id="' + containerId + '_camtorch" style="display:none;flex:0 0 auto;">🔦</button>' +
          '</div>'
        : '') +
        '<label class="plck-label" style="margin-top:14px;">' + t.main + ' (' + meta.main + t.needCount + ')' + (needsSeparateBonus ? ' · ' + t.bonusSep + ' (' + bonusCount + t.needCount + ')' : '') + '</label>' +
        '<div class="plck-combos" id="' + containerId + '_combos">' + comboRowHtml(0) + '</div>' +
        '<div class="plck-addcombo" id="' + containerId + '_addcombo">' + t.addCombo + '</div>' +
        '<div class="plck-ocrnote">' + t.ocrNote + '</div>' +
        '<div class="plck-row">' +
          '<button class="plck-btn plck-btn-primary" id="' + containerId + '_checkbtn" type="button">' + t.check + '</button>' +
        '</div>' +
        '<div class="plck-result" id="' + containerId + '_result"></div>' +
      '</div>';

    var roundSelect = document.getElementById(containerId + '_round');
    var loadMoreBtn = document.getElementById(containerId + '_loadmore');
    var resultBox = document.getElementById(containerId + '_result');
    var combosBox = document.getElementById(containerId + '_combos');
    var addComboBtn = document.getElementById(containerId + '_addcombo');
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
    function updateRemoveButtons() {
      var rows = combosBox.querySelectorAll('.plck-combo-row');
      rows.forEach(function (row) {
        var btn = row.querySelector('.plck-combo-remove');
        btn.style.visibility = rows.length > 1 ? 'visible' : 'hidden';
      });
    }
    updateRemoveButtons();

    function wireOcrForRow(row) {
      var ocrBtn = row.querySelector('.plck-combo-ocr');
      var ocrFile = row.querySelector('.plck-combo-ocrfile');
      var mainInput = row.querySelector('.plck-combo-main');
      var bonusInput = row.querySelector('.plck-combo-bonus');
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
            mainInput.value = uniq.slice(0, meta.main).join(' ');
            if (needsSeparateBonus && uniq.length > meta.main) bonusInput.value = uniq.slice(meta.main, meta.main + bonusCount).join(' ');
            showResult(t.ocrPartial, 'warn');
          }).catch(function () { showResult(t.ocrFail, 'warn'); });
        });
      });
    }
    combosBox.querySelectorAll('.plck-combo-row').forEach(wireOcrForRow);

    if (camScan) {
      var qrBtn = document.getElementById(containerId + '_qrbtn');
      var camview = document.getElementById(containerId + '_camview');
      var camctrls = document.getElementById(containerId + '_camctrls');
      var camStopBtn = document.getElementById(containerId + '_camstop');
      var camTorchBtn = document.getElementById(containerId + '_camtorch');

      // 이 mount 인스턴스 전용 카메라 상태 (여러 개 동시에 mount돼도 서로 안 얽히도록)
      var camStream = null, camTrack = null, camVideo = null, camCanvas = null;
      var camTimer = null, camBusy = false, torchOn = false;

      function stopCam() {
        if (camTimer) { clearTimeout(camTimer); camTimer = null; }
        if (camStream) { camStream.getTracks().forEach(function (tr) { tr.stop(); }); camStream = null; }
        camTrack = null; camVideo = null; camBusy = false; torchOn = false;
        camview.style.display = 'none'; camview.innerHTML = '';
        camctrls.style.display = 'none';
        qrBtn.style.display = 'block';
      }

      function toggleTorch() {
        if (!camTrack) return;
        torchOn = !torchOn;
        try { camTrack.applyConstraints({ advanced: [{ torch: torchOn }] }); } catch (e) {}
        camTorchBtn.textContent = torchOn ? '🔦✕' : '🔦';
      }

      async function decodeCanvasQr(ctx, side) {
        if ('BarcodeDetector' in global) {
          try {
            var blob = await new Promise(function (r) { ctx.canvas.toBlob(r, 'image/jpeg', 0.92); });
            var bmp = await createImageBitmap(blob);
            var det = new global.BarcodeDetector({ formats: camScan.formats });
            var codes = await det.detect(bmp);
            if (codes.length > 0) return codes[0].rawValue;
          } catch (e) {}
        }
        try {
          await ensureZxing();
          var imageData = ctx.getImageData(0, 0, side, side);
          var results = await global.ZXingWASM.readBarcodes(imageData, { formats: camScan.zxingFormats, tryHarder: true, maxNumberOfSymbols: 1 });
          if (results && results.length > 0) return results[0].text;
        } catch (e) {}
        return null;
      }

      function applyParsedResult(parsed) {
        var roundStr = String(parsed.round);
        var hasOption = Array.prototype.some.call(roundSelect.options, function (o) { return o.value === roundStr; });
        if (!hasOption) {
          var opt = document.createElement('option');
          opt.value = roundStr; opt.textContent = '#' + roundStr;
          roundSelect.insertBefore(opt, roundSelect.firstChild);
        }
        roundSelect.value = roundStr;

        combosBox.innerHTML = '';
        comboSeq = 0;
        parsed.combos.forEach(function (nums) {
          var wrap = document.createElement('div');
          wrap.innerHTML = comboRowHtml(comboSeq);
          var row = wrap.firstChild;
          combosBox.appendChild(row);
          wireOcrForRow(row);
          row.querySelector('.plck-combo-main').value = nums.join(' ');
          comboSeq++;
        });
        updateRemoveButtons();
        showResult(t.qrOk.replace('{round}', roundStr).replace('{count}', String(parsed.combos.length)), 'warn');
      }

      async function scanLoop() {
        if (!camStream) return; // stopCam()으로 이미 종료됨
        if (camBusy || !camVideo || camVideo.readyState < 2) { camTimer = setTimeout(scanLoop, 150); return; }
        camBusy = true;
        try {
          var vw = camVideo.videoWidth, vh = camVideo.videoHeight;
          if (vw && vh) {
            var side = Math.min(vw, vh);
            var sx = (vw - side) / 2, sy = (vh - side) / 2;
            camCanvas.width = side; camCanvas.height = side;
            var ctx = camCanvas.getContext('2d');
            ctx.drawImage(camVideo, sx, sy, side, side, 0, 0, side, side);
            var text = await decodeCanvasQr(ctx, side);
            if (text) {
              var parsed = camScan.parse(text);
              if (parsed) { stopCam(); applyParsedResult(parsed); return; }
              // 우리가 찾는 QR이 아니면(예: 광고용 QR) 계속 스캔
            }
          }
        } catch (e) {}
        camBusy = false;
        if (camStream) camTimer = setTimeout(scanLoop, 200);
      }

      async function startCam() {
        try {
          qrBtn.style.display = 'none';
          camview.style.display = 'block'; camview.innerHTML = '';
          camctrls.style.display = 'flex';

          camVideo = document.createElement('video');
          camVideo.setAttribute('playsinline', ''); camVideo.setAttribute('muted', '');
          camVideo.muted = true; camVideo.playsInline = true;
          camview.appendChild(camVideo);
          var target = document.createElement('div');
          target.className = 'plck-camtarget';
          camview.appendChild(target);

          camStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, advanced: [{ focusMode: 'continuous' }] }
          });
          camVideo.srcObject = camStream;
          await camVideo.play();
          camTrack = camStream.getVideoTracks()[0];

          var caps = camTrack.getCapabilities ? camTrack.getCapabilities() : {};
          camTorchBtn.style.display = caps.torch ? 'inline-flex' : 'none';
          torchOn = false; camTorchBtn.textContent = '🔦';

          camCanvas = document.createElement('canvas');
          showResult(t.qrRunning, 'warn');
          scanLoop();
        } catch (e) {
          stopCam();
          showResult(t.qrFail, 'warn');
        }
      }

      qrBtn.addEventListener('click', startCam);
      camStopBtn.addEventListener('click', stopCam);
      camTorchBtn.addEventListener('click', toggleTorch);
    }

    combosBox.addEventListener('click', function (e) {
      if (e.target.classList.contains('plck-combo-remove')) {
        var rows = combosBox.querySelectorAll('.plck-combo-row');
        if (rows.length > 1) { e.target.closest('.plck-combo-row').remove(); updateRemoveButtons(); }
      }
    });
    addComboBtn.addEventListener('click', function () {
      comboSeq++;
      var wrap = document.createElement('div');
      wrap.innerHTML = comboRowHtml(comboSeq);
      var row = wrap.firstChild;
      combosBox.appendChild(row);
      wireOcrForRow(row);
      updateRemoveButtons();
    });

    function ballsHtml(nums, matchSet, bonusCls) {
      return nums.map(function (n) {
        var cls = 'plck-ball' + (bonusCls ? ' plck-ball-bonus' : '') + (matchSet && matchSet[n] ? ' plck-ball-matched' : '');
        return '<span class="' + cls + '">' + n + '</span>';
      }).join('');
    }

    checkBtn.addEventListener('click', function () {
      var roundNo = roundSelect.value;
      if (!roundNo) { showResult(t.selectRound, 'warn'); return; }

      var rows = Array.prototype.slice.call(combosBox.querySelectorAll('.plck-combo-row'));
      var combos = [];
      for (var i = 0; i < rows.length; i++) {
        var mainNums = parseNums(rows[i].querySelector('.plck-combo-main').value);
        var bonusNums = needsSeparateBonus ? parseNums(rows[i].querySelector('.plck-combo-bonus').value) : [];
        if (mainNums.length !== meta.main || (needsSeparateBonus && bonusNums.length !== bonusCount)) {
          showResult((t.comboLabel + ' ' + (i + 1) + ': ') + t.invalidRange, 'warn'); return;
        }
        combos.push({ main: mainNums, bonus: bonusNums });
      }

      showResult(t.loading, 'warn');
      fetchRoundDetail(gameId, roundNo).then(function (draw) {
        if (!draw) { showResult(t.invalidRange, 'warn'); return; }
        var gradeFn = GRADE_RULES[gameId];
        var drawMain = draw.main_numbers || [];
        var drawBonus = draw.bonus_numbers || [];
        var drawMatchSet = {}; drawMain.forEach(function (n) { drawMatchSet[n] = true; });
        var header = '<div class="plck-drawinfo">' + t.resultDate + ': ' + draw.draw_date + ' (#' + draw.round_no + ')' +
          '<div class="plck-drawballs">' + ballsHtml(drawMain) + (drawBonus.length ? '<span class="plck-plus">+</span>' + ballsHtml(drawBonus, null, true) : '') + '</div></div>';

        var blocksHtml = combos.map(function (c, i) {
          var grade = gradeFn(drawMain, drawBonus, c.main, c.bonus);
          var matchedCount = countMatches(c.main, drawMain);
          var myBallsHtml = ballsHtml(c.main, drawMatchSet) + (needsSeparateBonus && c.bonus.length ? '<span class="plck-plus">+</span>' + ballsHtml(c.bonus, null, true) : '');
          var gradeLine = grade
            ? '<div class="plck-grade-win">🎉 ' + grade + t.win + '</div>'
            : '<div class="plck-grade-lose">' + t.lose + '</div>';
          return '<div class="plck-combo-result-block ' + (grade ? 'is-win' : 'is-lose') + '">' +
            '<div class="plck-combo-result-label">' + t.comboLabel + ' ' + (i + 1) + '</div>' +
            '<div class="plck-drawballs">' + myBallsHtml + '</div>' +
            gradeLine +
            '<div class="plck-grade-sub">' + matchedCount + t.matched + '</div>' +
          '</div>';
        }).join('');

        var anyWin = combos.some(function (c) { return !!gradeFn(drawMain, drawBonus, c.main, c.bonus); });
        showResult(header + blocksHtml, anyWin ? 'win' : 'lose');
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

  // ── 한국 로또(kr_lotto645) 전용 QR스캔 ──
  // 동행복권 QR(qr.dhlottery.co.kr)은 URL 안에 회차와 최대 5개 조합(A~E)이 그대로
  // 인코딩되어 있어서, 다른 나라 게임처럼 OCR로 숫자를 하나하나 읽을 필요 없이
  // QR 하나로 회차+전체 조합을 한번에 정확하게 채울 수 있음.
  // (My Lotto Lab에서 이미 검증된 zxing-wasm 인식엔진을 그대로 재사용)
  var zxingLoading = null;
  function ensureZxing() {
    if (global.ZXingWASM) return Promise.resolve();
    if (zxingLoading) return zxingLoading;
    zxingLoading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.0/dist/iife/reader/index.js';
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
    return zxingLoading;
  }

  function parseLottoQrUrl(url) {
    try {
      var match = url.match(/[?&]v=([^&]+)/);
      if (!match) return null;
      var v = match[1];
      var roundMatch = v.match(/^(\d+)/);
      if (!roundMatch) return null;
      var round = parseInt(roundMatch[1], 10);
      var comboPattern = /([mqs])(\d{12})/g;
      var combos = [];
      var m;
      while ((m = comboPattern.exec(v)) !== null) {
        var nums = [];
        for (var i = 0; i < 12; i += 2) nums.push(parseInt(m[2].slice(i, i + 2), 10));
        var uniq = nums.filter(function (n, idx) { return nums.indexOf(n) === idx; });
        if (nums.length === 6 && nums.every(function (n) { return n >= 1 && n <= 45; }) && uniq.length === 6) {
          combos.push(nums);
        }
      }
      if (!round || !combos.length) return null;
      return { round: round, combos: combos };
    } catch (e) { return null; }
  }

  // ── 실시간 카메라 스캔 지원 게임 목록 (확장 지점) ──────────────────────────────
  // 지금은 한국로또만 있지만, 다른 나라 게임도 실물 QR/바코드 표준이 생기면
  // 여기에 항목 하나(어떤 포맷을 찾을지 + 그 텍스트를 회차/번호로 해석할 파서 함수)만
  // 추가하면 됩니다. 나머지 카메라 UI·인식 로직은 전부 공용으로 재사용됩니다.
  var CAMERA_SCAN_CONFIG = {
    kr_lotto645: { formats: ['qr_code'], zxingFormats: ['QRCode'], parse: parseLottoQrUrl },
  };

  function fetchLatestDraw(gameId) {
    var url = SUPABASE_URL + '/rest/v1/draw_results?select=round_no,draw_date,main_numbers,bonus_numbers&game_id=eq.' + gameId + '&order=round_no.desc&limit=1';
    return fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY } })
      .then(function (r) { return r.ok ? r.json() : []; }).then(function (rows) { return rows[0] || null; });
  }

  global.PLChecker = { mount: mount, fetchLatestDraw: fetchLatestDraw, GAME_META: GAME_META, GRADE_RULES: GRADE_RULES, SEPARATE_BONUS_GAMES: SEPARATE_BONUS_GAMES };
})(window);
