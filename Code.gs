/* 출발 도우미 — 서버 (Google Apps Script)
   · 화면(GitHub Pages)이 부르면 카카오모빌리티 길찾기로 "지금 출발"과 "출발 시각별 예상 시간"을 받아 돌려준다.
   · 집·회사·숙소 주소, 카카오 키, 텔레그램 토큰은 모두 스크립트 속성에만 둔다. 이 파일(공개 저장소)에는 넣지 않는다.
   · 스크립트 속성
       KAKAO_REST_KEY  카카오 REST API 키 (사용자가 직접 넣음)
       TG_TOKEN        텔레그램 봇 토큰 (사용자가 직접 넣음), TG_CHAT_ID 는 비워 두면 찾아서 저장
       APP_KEY         앱 암호 (setup() 이 만든다)
       PLACES · CFG · SENT · CALLS · PVER  서버가 쓰는 값
   · 처음 한 번: 편집기에서 setup() 실행 → 실행 기록에 나온 서버 주소·앱 암호를 앱 설정에 넣는다. */

const P = PropertiesService.getScriptProperties();
const NAVI = 'https://apis-navi.kakaomobility.com/v1/';
const ROUTES = {
  w2h: { name: '퇴근', short: '마곡 → 기흥', from: 'work', to: 'home' },
  h2w: { name: '출근', short: '기흥 → 회사', from: 'home', to: 'work' },
  h2d: { name: '숙소로', short: '기흥 → 숙소', from: 'home', to: 'dorm' },
};
// 공휴일 (2026~2027, 대체공휴일 포함). 앱 index.html 의 HOL 과 같은 목록
const HOL = {
  '2026-01-01': '새해', '2026-02-16': '설 연휴', '2026-02-17': '설날', '2026-02-18': '설 연휴', '2026-03-01': '삼일절', '2026-03-02': '대체공휴일',
  '2026-05-05': '어린이날', '2026-05-24': '부처님오신날', '2026-05-25': '대체공휴일', '2026-06-03': '지방선거', '2026-06-06': '현충일',
  '2026-08-15': '광복절', '2026-08-17': '대체공휴일', '2026-09-24': '추석 연휴', '2026-09-25': '추석', '2026-09-26': '추석 연휴', '2026-09-28': '대체공휴일',
  '2026-10-03': '개천절', '2026-10-05': '대체공휴일', '2026-10-09': '한글날', '2026-12-25': '성탄절',
  '2027-01-01': '새해', '2027-02-06': '설 연휴', '2027-02-07': '설날', '2027-02-08': '설 연휴', '2027-02-09': '대체공휴일', '2027-03-01': '삼일절',
  '2027-05-05': '어린이날', '2027-05-13': '부처님오신날', '2027-06-06': '현충일', '2027-08-15': '광복절', '2027-08-16': '대체공휴일',
  '2027-09-14': '추석 연휴', '2027-09-15': '추석', '2027-09-16': '추석 연휴', '2027-10-03': '개천절', '2027-10-04': '대체공휴일',
  '2027-10-09': '한글날', '2027-10-11': '대체공휴일', '2027-12-25': '성탄절', '2027-12-27': '대체공휴일',
};
const DEF_CFG = { step: 10, hours: 4, offDays: [], ev: true,
  alerts: { w2h: { on: true, time: '17:00' }, h2w: { on: false, time: '06:30' }, h2d: { on: true, time: '19:00' } } };

/* ── 요청 받기 ── */
function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (x) {}
  return out_(handle_(body));
}
// fetch 가 막힐 때 화면이 JSONP 로 부른다(?p=JSON&callback=이름). 위젯도 GET 으로 부른다(?action=widget&key=…)
function doGet(e) {
  const q = e.parameter || {};
  let body = {};
  try { body = q.p ? JSON.parse(q.p) : { action: q.action, key: q.key }; } catch (x) {}
  if (!body.action) return ContentService.createTextOutput('출발 도우미 서버가 켜져 있어요');
  return out_(handle_(body), q.callback);
}
function out_(obj, cb) {
  const s = JSON.stringify(obj);
  if (cb && /^[A-Za-z_$][\w$]*$/.test(cb)) return ContentService.createTextOutput(cb + '(' + s + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.JSON);
}
function handle_(b) {
  try {
    // 점검(GitHub Actions): 키·주소 값은 돌려주지 않고 있는지 여부만
    if (b.action === 'health') {
      const pl = json_('PLACES', {});
      // 서울 열린데이터광장(8088 포트)에 구글 서버가 닿는지 (응답 코드만)
      let seoul = 'x'; try { const r = UrlFetchApp.fetch('http://openapi.seoul.go.kr:8088/sample/xml/AccMainCode/1/30/', { muteHttpExceptions: true }); seoul = r.getResponseCode() + ' ' + r.getContentText().replace(/\s+/g, ' ').replace(/<\/?(row|RESULT|CODE|MESSAGE)>/g, ' ').slice(0, 1500); } catch (e) { seoul = '못 닿음: ' + plain_(e).slice(0, 60); }
      return { ok: true, data: { setup: !!P.getProperty('APP_KEY'), kakao: !!P.getProperty('KAKAO_REST_KEY'), ex: !!P.getProperty('EX_KEY'), jsKey: !!P.getProperty('KAKAO_JS_KEY'), ex: !!P.getProperty('EX_KEY'), tg: !!P.getProperty('TG_TOKEN'),
        chat: !!P.getProperty('TG_CHAT_ID'), places: !!(pl.work && pl.home && pl.dorm), trigger: ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'tick'), seoul: seoul } };
    }
    const key = P.getProperty('APP_KEY');
    if (!key) return { ok: false, code: 'setup', message: '서버 준비가 아직이에요. 편집기에서 setup() 을 한 번 실행해 주세요' };
    if (String(b.key || '') !== key) return { ok: false, code: 'auth', message: '앱 암호가 맞지 않아요. 설정에서 다시 넣어 주세요' };
    const a = b.action;
    if (a === 'load') return { ok: true, data: load_(b) };
    if (a === 'config') return { ok: true, data: config_() };
    if (a === 'save') return { ok: true, data: save_(b) };
    if (a === 'places') return { ok: true, data: places_(b.places || {}) };
    if (a === 'test') return { ok: true, data: test_() };
    if (a === 'widget') return { ok: true, data: widget_() };
    if (a === 'ex') return { ok: true, data: exInfo_() };
    return { ok: false, message: '모르는 요청이에요' };
  } catch (e) {
    return { ok: false, message: plain_(e) };
  }
}

/* ── 설정 ── */
const json_ = (k, d) => { try { const v = P.getProperty(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
function cfg_() { const c = json_('CFG', {}); return Object.assign({}, DEF_CFG, c, { alerts: Object.assign({}, DEF_CFG.alerts, c.alerts || {}) }); }
function config_() {
  const c = cfg_(), pl = json_('PLACES', {}), calls = String(P.getProperty('CALLS') || '').split('|');
  const tok = P.getProperty('TG_TOKEN');
  let tg = { ok: false };
  if (tok) {
    const bot = CacheService.getScriptCache().get('tgbot') || (() => {
      try { const me = JSON.parse(UrlFetchApp.fetch('https://api.telegram.org/bot' + tok.trim() + '/getMe', { muteHttpExceptions: true }).getContentText());
        if (me.ok) { CacheService.getScriptCache().put('tgbot', '@' + me.result.username, 21600); return '@' + me.result.username; } } catch (e) {}
      return '';
    })();
    tg = { ok: !!bot, bot: bot };
  }
  return { places: { work: (pl.work || {}).q || '', home: (pl.home || {}).q || '', dorm: (pl.dorm || {}).q || '' },
    step: c.step, hours: c.hours, offDays: c.offDays, alerts: c.alerts, ev: c.ev !== false,
    jsKey: (P.getProperty('KAKAO_JS_KEY') || '').trim(),   // 지도용 JavaScript 키(도메인 제한 키라 화면에 줘도 된다). REST 키는 주지 않는다
    kakao: !!P.getProperty('KAKAO_REST_KEY'), calls: calls[0] === day_() ? +calls[1] : 0, tg: tg };
}
// 바뀐 칸만 받는다. 잘못된 값은 받지 않는다
function save_(b) {
  const c = cfg_();
  if (b.step != null) { if ([10, 15, 20, 30].indexOf(+b.step) < 0) throw new Error('간격은 10·15·20·30분만 돼요'); c.step = +b.step; }
  if (b.hours != null) { if ([2, 3, 4].indexOf(+b.hours) < 0) throw new Error('2·3·4시간만 돼요'); c.hours = +b.hours; }
  if (b.ev != null) c.ev = !!b.ev;
  if (b.offDays) c.offDays = b.offDays.filter(k => /^\d{4}-\d\d-\d\d$/.test(k)).slice(0, 60);
  if (b.alerts) Object.keys(b.alerts).forEach(k => {
    if (!ROUTES[k]) return; const a = b.alerts[k] || {};
    if (a.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(a.time)) throw new Error('시각이 이상해요');
    c.alerts[k] = { on: !!a.on, time: a.time || c.alerts[k].time };
  });
  P.setProperty('CFG', JSON.stringify(c));
  if (b.alerts) ensureTrigger_();
  return { saved: true };
}

/* ── 장소: 주소나 이름 → 좌표 (카카오 로컬 검색) ── */
function places_(input) {
  const key = kakaoKey_(), found = {}, pl = {};
  ['work', 'home', 'dorm'].forEach(k => {
    const q = String(input[k] || '').trim(); if (!q) throw new Error('세 곳을 모두 넣어 주세요');
    if (q.length < 2) throw new Error('주소나 건물 이름으로 넣어 주세요 (두 글자 이상)');
    const h = { headers: { Authorization: 'KakaoAK ' + key }, muteHttpExceptions: true };
    let r = UrlFetchApp.fetch('https://dapi.kakao.com/v2/local/search/address.json?query=' + encodeURIComponent(q), h), d = r.getResponseCode() === 200 ? JSON.parse(r.getContentText()).documents : null;
    if (r.getResponseCode() !== 200) throw new Error(kakaoErr_(r, '주소 찾기'));
    let doc = d && d[0], name = doc && (doc.road_address ? doc.road_address.address_name : doc.address_name);
    if (!doc) {
      r = UrlFetchApp.fetch('https://dapi.kakao.com/v2/local/search/keyword.json?query=' + encodeURIComponent(q), h);
      if (r.getResponseCode() !== 200) throw new Error(kakaoErr_(r, '장소 찾기'));
      doc = (JSON.parse(r.getContentText()).documents || [])[0]; name = doc && (doc.place_name + ' · ' + (doc.road_address_name || doc.address_name));
    }
    if (!doc) throw new Error('"' + q + '"을(를) 찾지 못했어요. 도로명 주소로 넣어 주세요');
    pl[k] = { q: q, x: (+doc.x).toFixed(6), y: (+doc.y).toFixed(6), name: name };
    found[k] = name;
  });
  P.setProperty('PLACES', JSON.stringify(pl));
  P.setProperty('PVER', String(Date.now() % 1e6));     // 장소가 바뀌면 기억해 둔 길 시간도 버린다
  return { found: found };
}

/* ── 길 시간 받기 ── */
function load_(b) {
  const c = cfg_(), pl = json_('PLACES', {});
  const step = [10, 15, 20, 30].indexOf(+b.step) >= 0 ? +b.step : c.step, hours = [2, 3, 4].indexOf(+b.hours) >= 0 ? +b.hours : c.hours;
  let route, o, d, ckey, to;
  if (b.route === 'here') {
    // 지금 위치 → 고른 장소. 위치는 이번 길찾기에만 쓰고 저장하지 않는다 (서버 기억 키는 약 100m 단위로 뭉갠 값)
    const x = +(b.origin || {}).x, y = +(b.origin || {}).y;
    if (!(x > 124 && x < 132 && y > 33 && y < 39)) throw new Error('지금 위치를 알 수 없어요. 위치 권한을 확인해 주세요');
    route = 'here'; to = ['home', 'work', 'dorm'].indexOf(b.to) >= 0 ? b.to : 'home';
    o = { x: x.toFixed(6), y: y.toFixed(6) }; d = pl[to]; ckey = 'here' + to + x.toFixed(3) + ',' + y.toFixed(3);
  } else {
    route = ROUTES[b.route] ? b.route : nextTrip_(Date.now()).r; o = pl[ROUTES[route].from]; d = pl[ROUTES[route].to]; ckey = route;
  }
  if (!o || !d) throw new Error('먼저 설정에서 회사·집·숙소 장소를 저장해 주세요');
  const now = Date.now(), from = +b.from || 0, t0 = Math.max(now, from), live = !from || from <= now;
  // 첫 칸은 지금(실시간 길찾기) 또는 고른 시각, 나머지는 간격에 맞춘 시각 — 시각이 고정돼야 서버 기억(캐시)을 다시 쓸 수 있다
  const ts = [t0];
  for (let t = Math.ceil((t0 + 6e4) / (step * 6e4)) * step * 6e4; t <= t0 + hours * 36e5 && ts.length < 26; t += step * 6e4) ts.push(t);
  // '지금'은 실시간 길찾기, 나머지는 미래 운행 정보(통계 예측)라 바로 비교하면 첫 칸만 튄다 →
  // 같은 '지금' 시각의 예측을 하나 더 받아 실시간÷예측 비율을 구하고, 가까운 시각일수록 그 비율로 맞춘다(90분이면 약 1/3)
  const fNow = live ? Math.ceil((now + 6e4) / 6e4) * 6e4 : 0, list = ts.map((t, i) => ({ t: t, live: i === 0 && live, full: i === 0 }));
  if (fNow) list.push({ t: fNow, live: false, full: false });
  const rs = directions_(ckey, o, d, list), fr = fNow ? rs.pop() : null;
  const k = fr && rs[0] && fr.sec ? Math.min(1.8, Math.max(.6, rs[0].sec / fr.sec)) : 1;
  const first = rs[0];
  if (!first) throw new Error('카카오 길찾기 결과를 받지 못했어요. 잠시 후 다시 해주세요');
  const slots = rs.map((r, i) => r && { t: ts[i], min: Math.round(r.sec * (i ? 1 + (k - 1) * Math.exp(-(ts[i] - now) / 54e5) : 1) / 60), raw: Math.round(r.sec / 60), km: Math.round(r.dist / 100) / 10 }).filter(Boolean);
  slots[0].live = live;
  return { route: route, to: to, calib: Math.round(k * 100) / 100, slots: slots, dist: Math.round(first.dist / 100) / 10, toll: first.toll, roads: first.roads || [], path: first.path || [], ev: c.ev !== false, at: now };
}
// 여러 출발 시각을 한꺼번에(fetchAll) 묻는다. 받은 값은 지금=3분, 미래=10분 기억한다
function directions_(route, o, d, list) {
  const key = kakaoKey_(), cache = CacheService.getScriptCache(), ver = P.getProperty('PVER') || '0';
  const ck = it => ['nv2', ver, route, it.live ? 'now' + Math.floor(it.t / 18e4) : kst_(it.t, 'yyyyMMddHHmm'), it.full ? 'f' : 's'].join('|');
  const hit = cache.getAll(list.map(ck)), res = list.map(it => hit[ck(it)] ? JSON.parse(hit[ck(it)]) : null);
  const need = list.map((it, i) => res[i] ? -1 : i).filter(i => i >= 0);
  if (need.length) {
    const qs = 'origin=' + o.x + ',' + o.y + '&destination=' + d.x + ',' + d.y + '&priority=RECOMMEND';
    const reqs = need.map(i => { const it = list[i];
      return { url: NAVI + (it.live ? 'directions?' : 'future/directions?departure_time=' + kst_(it.t, 'yyyyMMddHHmm') + '&') + qs + '&summary=' + (it.full ? 'false' : 'true'),
        headers: { Authorization: 'KakaoAK ' + key }, muteHttpExceptions: true }; });
    let rr;
    try { rr = UrlFetchApp.fetchAll(reqs); }
    catch (e) { Utilities.sleep(1500); rr = reqs.map(q => { try { return UrlFetchApp.fetch(q.url, q); } catch (x) { return null; } }); }  // 한 건만 늦어도 묶음 전체가 예외 → 하나씩
    countCalls_(reqs.length);
    const put = {};
    rr.forEach((r, k) => {
      const i = need[k];
      if (!r) return;
      if (r.getResponseCode() !== 200) { if (i === 0) throw new Error(kakaoErr_(r, '길찾기')); return; }
      const j = JSON.parse(r.getContentText()), rt = (j.routes || [])[0];
      if (!rt || rt.result_code !== 0) { if (i === 0) throw new Error('카카오 길찾기: ' + ((rt && rt.result_msg) || '길을 찾지 못했어요')); return; }
      const s = rt.summary, v = { sec: s.duration, dist: s.distance, toll: (s.fare || {}).toll || 0 };
      if (list[i].full) { v.roads = mainRoads_(rt.sections || []); v.path = path_(rt.sections || []); }
      res[i] = v; put[ck(list[i])] = JSON.stringify(v);
    });
    if (Object.keys(put).length) cache.putAll(put, list[0].live ? 180 : 600);
  }
  return res;
}
// 지도에 그릴 길: 도로마다 막힘 정도(traffic_state 1 정체·2 지체·3 서행·4 원활·0 모름)와 좌표.
// 같은 이름·같은 막힘이 이어지면 합치고, 40m 안쪽 점은 건너뛰어 크기를 줄인다(서버 기억 한 칸 100KB 제한)
function path_(sections) {
  const out = [];
  sections.forEach(sec => (sec.roads || []).forEach(r => {
    const v = r.vertexes || [], pts = [];
    for (let i = 0; i + 1 < v.length; i += 2) pts.push([Math.round(v[i] * 1e5) / 1e5, Math.round(v[i + 1] * 1e5) / 1e5]);
    if (pts.length < 2) return;
    const st = [1, 2, 3, 4, 6].indexOf(r.traffic_state) >= 0 ? r.traffic_state : 0, last = out[out.length - 1];
    if (last && last.n === (r.name || '') && last.s === st) { last.p = last.p.concat(pts.slice(1)); last.d += r.distance || 0; }
    else out.push({ n: r.name || '', s: st, d: r.distance || 0, p: pts });
  }));
  out.forEach(x => { const k = [x.p[0]];
    for (let i = 1; i < x.p.length - 1; i++) { const a = k[k.length - 1], b = x.p[i]; if (Math.abs(b[0] - a[0]) * 88800 + Math.abs(b[1] - a[1]) * 111000 > 40) k.push(b); }
    k.push(x.p[x.p.length - 1]); x.p = k; });
  return out;
}
// 지나는 길 중 이름 있는 도로를 거리순으로 3개
function mainRoads_(sections) {
  const m = {};
  sections.forEach(s => (s.roads || []).forEach(r => { if (r.name) m[r.name] = (m[r.name] || 0) + (r.distance || 0); }));
  return Object.keys(m).filter(n => m[n] > 1500).sort((a, b) => m[b] - m[a]).slice(0, 3);
}
function kakaoKey_() {
  const k = (P.getProperty('KAKAO_REST_KEY') || '').trim();
  if (!k) throw new Error('카카오 키가 아직 없어요. 앱 설정의 "카카오 길찾기 키" 안내대로 넣어 주세요');
  return k;
}
function kakaoErr_(r, what) {
  const c = r.getResponseCode(), t = r.getContentText();
  if (c === 401) return '카카오 키가 맞지 않아요(' + what + '). REST API 키를 다시 확인해 주세요';
  if (c === 403 || /disabled|NotAuthorized/i.test(t)) return '카카오에서 ' + what + ' 사용 설정이 꺼져 있어요. 앱 설정의 안내 3·4번을 확인해 주세요';
  if (c === 429) return '오늘 카카오 무료 사용량을 다 썼어요. 내일 다시 돼요';
  return '카카오 ' + what + ' 오류(' + c + ')';
}
function countCalls_(n) {
  const v = String(P.getProperty('CALLS') || '').split('|');
  P.setProperty('CALLS', day_() + '|' + ((v[0] === day_() ? +v[1] : 0) + n));
}

/* ── 날짜·다음 길 (앱과 같은 규칙) ── */
const kst_ = (ms, f) => Utilities.formatDate(new Date(ms), 'Asia/Seoul', f);
const day_ = () => kst_(Date.now(), 'yyyy-MM-dd');
const addDays_ = (k, n) => new Date(Date.parse(k + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const dow_ = k => new Date(k + 'T00:00:00Z').getUTCDay();
const at_ = (k, h, m) => Date.parse(k + 'T00:00:00+09:00') + (h * 60 + (m || 0)) * 6e4;
function isOff_(k, off) { return dow_(k) === 0 || dow_(k) === 6 || !!HOL[k] || off.indexOf(k) >= 0; }
// 오늘 해당하는 길: 쉬는 날 전날=퇴근, 쉬는 날 다음 날=출근, 출근 전날(쉬는 날)=숙소로
function todayRoutes_(k) {
  const off = cfg_().offDays, r = [];
  if (!isOff_(k, off) && isOff_(addDays_(k, 1), off)) r.push('w2h');
  if (!isOff_(k, off) && isOff_(addDays_(k, -1), off)) r.push('h2w');
  if (isOff_(k, off) && !isOff_(addDays_(k, 1), off)) r.push('h2d');
  return r;
}
function nextTrip_(now) {
  const today = kst_(now, 'yyyy-MM-dd'), list = [];
  for (let i = -1; i <= 10; i++) {
    const d = addDays_(today, i), rs = todayRoutes_(d);
    if (rs.indexOf('w2h') >= 0) list.push({ r: 'w2h', from: at_(d, 12), to: at_(addDays_(d, 1), 3) });
    if (rs.indexOf('h2w') >= 0) list.push({ r: 'h2w', from: at_(d, 3), to: at_(d, 12) });
    if (rs.indexOf('h2d') >= 0) list.push({ r: 'h2d', from: at_(d, 12), to: at_(addDays_(d, 1), 3) });
  }
  list.sort((a, b) => a.from - b.from);
  return list.filter(x => x.to > now)[0] || { r: 'w2h' };
}

/* ── 알림 ── */
function dur_(m) { return m >= 60 ? (Math.floor(m / 60) + '시간' + (m % 60 ? ' ' + (m % 60) + '분' : '')) : m + '분'; }
function alertText_(d) {
  const s = d.slots, n = s[0], mn = Math.min.apply(null, s.map(x => x.min)), b = s.filter(x => x.min === mn)[0];
  const hm = t => kst_(t, 'HH:mm');
  let t = '[출발 도우미] ' + ROUTES[d.route].name + ' ' + ROUTES[d.route].short + '\n지금 출발하면 ' + dur_(n.min) + ' (도착 ' + hm(n.t + n.min * 6e4) + ')';
  t += (b.t === n.t || n.min - b.min < 3) ? '\n지금 떠나는 게 가장 빨라요' : '\n가장 빠른 출발은 ' + hm(b.t) + ' · ' + dur_(b.min) + ' (' + (n.min - b.min) + '분 덜 걸려요)';
  return t;
}
// 5분마다 돈다. 오늘 해당하는 길의 알림 시각이 지났고(1시간 안) 오늘 아직 안 보냈으면 보낸다
function tick() {
  try {
    const now = Date.now(), k = day_(), hmNow = kst_(now, 'HH:mm'), c = cfg_(), sent = json_('SENT', {});
    todayRoutes_(k).forEach(r => {
      const a = c.alerts[r]; if (!a || !a.on || sent[r] === k) return;
      const due = at_(k, +a.time.slice(0, 2), +a.time.slice(3, 5));
      if (now < due || now > due + 36e5) return;
      const ok = tg_(alertText_(load_({ route: r, step: c.step, hours: c.hours })));
      if (ok) { sent[r] = k; P.setProperty('SENT', JSON.stringify(sent)); }
    });
  } catch (e) { reportError_(e); }
}
function test_() {
  if (!P.getProperty('TG_TOKEN')) return { sent: [], reason: '스크립트 속성에 TG_TOKEN 이 없어요' };
  const c = cfg_(), text = alertText_(load_({ route: nextTrip_(Date.now()).r, step: c.step, hours: c.hours }));
  const ok = tg_(text);
  return ok ? { sent: ['텔레그램'], text: text } : { sent: [], reason: '봇 대화방에서 시작을 눌렀는지 확인해 주세요' };
}
/* ── 한국도로공사 고속도로 실시간 문자 안내 (사고·고장·작업·정체·날씨). 키는 스크립트 속성 EX_KEY (data.ex.co.kr 에서 바로 발급)
   없으면 포털의 시험용 키(test)로 받는다. 좌표는 latitude(위도)·altitude(경도) 칸에 온다. 3분 기억 */
function exInfo_() {
  const cache = CacheService.getScriptCache(), hit = cache.get('ex1'); if (hit) return JSON.parse(hit);
  const key = (P.getProperty('EX_KEY') || 'test').trim(), out = [];
  for (let page = 1; page <= 3; page++) {
    const r = UrlFetchApp.fetch('https://data.ex.co.kr/openapi/burstInfo/realTimeSms?type=json&numOfRows=200&pageNo=' + page + '&key=' + encodeURIComponent(key), { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) throw new Error('한국도로공사 자료를 받지 못했어요(' + r.getResponseCode() + ')');
    const j = JSON.parse(r.getContentText()), L = j.realTimeSMSList || [];
    if (j.code && !L.length) throw new Error('한국도로공사 키를 확인해 주세요 (' + (j.message || j.code) + ')');
    L.forEach(x => {
      if (x.accTypeCode === '15') return;   // 이벤트/홍보 문구는 뺀다
      const lat = parseFloat(x.latitude), lon = parseFloat(x.altitude);
      out.push({ k: x.accType || '', c: x.accTypeCode || '', road: x.roadNM || '', dir: x.startEndTypeCode || '', at: String(x.accPointNM || '').trim(),
        text: String(x.smsText || '').trim(), len: parseFloat(x.lateLength) || 0, time: (x.accDate || '') + ' ' + (x.accHour || ''),
        lanes: [1, 2, 3, 4, 5, 6].map(n => x['laneYn' + n] === 'Y' ? 1 : 0), sh: x.shldroadYn === 'Y' ? 1 : 0,
        lat: lat > 33 && lat < 39 ? lat : null, lon: lon > 124 && lon < 132 ? lon : null });
    });
    if (L.length < 200) break;
  }
  const res = { items: out, at: Date.now(), test: !P.getProperty('EX_KEY') };
  try { cache.put('ex1', JSON.stringify(res), 180); } catch (e) {}
  return res;
}
function widget_() {
  const t = nextTrip_(Date.now()), d = load_({ route: t.r, step: 30, hours: 3 }), n = d.slots[0];
  const mn = Math.min.apply(null, d.slots.map(x => x.min)), b = d.slots.filter(x => x.min === mn)[0];
  return { route: d.route, name: ROUTES[d.route].name, short: ROUTES[d.route].short, min: n.min, arrive: kst_(n.t + n.min * 6e4, 'HH:mm'),
    best: kst_(b.t, 'HH:mm'), bestMin: b.min, gain: n.min - b.min, at: kst_(Date.now(), 'HH:mm') };
}

/** 텔레그램 (스크립트 속성 TG_TOKEN · TG_CHAT_ID). 채팅 번호가 없으면 봇에게 온 메시지에서 찾아 기억한다 */
function tg_(text) {
  const token = (P.getProperty('TG_TOKEN') || '').trim(); if (!token) return false;
  let chat = (P.getProperty('TG_CHAT_ID') || '').trim();
  if (!chat) {
    try {
      const u = JSON.parse(UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getUpdates', { muteHttpExceptions: true }).getContentText());
      const m = (u.result || []).map(x => x.message || x.channel_post).filter(Boolean).pop();
      if (m) { chat = String(m.chat.id); P.setProperty('TG_CHAT_ID', chat); }
    } catch (e) {}
  }
  if (!chat) return false;
  const r = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'post', muteHttpExceptions: true, payload: { chat_id: chat, text: text.slice(0, 4000), disable_web_page_preview: 'true' },
  });
  if (r.getResponseCode() !== 200) console.warn('텔레그램 보내기 실패: ' + r.getContentText());
  return r.getResponseCode() === 200;
}
/** 텔레그램만 따로 시험. 실패하면 이유를 쉬운 말로 로그에 남긴다 */
function testTelegram() {
  const token = (P.getProperty('TG_TOKEN') || '').trim();
  if (!token) throw new Error('스크립트 속성에 TG_TOKEN(봇 토큰)이 없어요');
  const me = JSON.parse(UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getMe', { muteHttpExceptions: true }).getContentText());
  if (!me.ok) throw new Error('봇 토큰이 맞지 않아요. BotFather가 준 토큰 전체(숫자:영문)를 앞뒤 빈칸 없이 넣어 주세요');
  if (!tg_('[출발 도우미] 텔레그램 연결 시험이에요. 이 메시지가 보이면 성공!')) throw new Error('@' + me.result.username + ' 대화방에서 시작(/start)을 누른 뒤 다시 실행해 주세요');
  console.log('보냈어요. @' + me.result.username + ' 대화방을 확인하세요');
}
/** 같은 오류는 하루 한 번만 메일로 */
function reportError_(e) {
  const msg = plain_(e), key = day_() + '|' + msg.slice(0, 60);
  if (P.getProperty('lastErrMail') === key) return;
  P.setProperty('lastErrMail', key);
  try { MailApp.sendEmail(Session.getEffectiveUser().getEmail(), '[출발 도우미 오류] ' + msg.slice(0, 80), msg + '\n\n' + (e && e.stack || '')); } catch (x) {}
}
function plain_(e) { return String((e && e.message) || e).replace(/KakaoAK\s+\S+/g, 'KakaoAK ***').replace(/bot\d+:[\w-]+/g, 'bot***'); }
function ensureTrigger_() {
  if (ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'tick')) return;
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(5).create();
}

/** 처음 한 번 실행: 앱 암호를 만들고 알림 확인(5분마다)을 건다. 실행 기록에 앱 설정에 넣을 값을 찍는다 */
function setup() {
  let key = P.getProperty('APP_KEY');
  if (!key) { key = Utilities.getUuid().replace(/-/g, '').slice(0, 20); P.setProperty('APP_KEY', key); }
  ensureTrigger_();
  const url = ScriptApp.getService().getUrl() || '(아직 웹 앱으로 배포하지 않았어요: 배포 → 새 배포 → 웹 앱, 실행: 나, 액세스: 모든 사용자)';
  console.log('서버 주소: ' + url);
  console.log('앱 암호: ' + key);
  if (/\/exec$/.test(url)) console.log('한 번 누르는 연결 링크: https://friese8807.github.io/commute/#setup=' + Utilities.base64EncodeWebSafe(JSON.stringify({ url: url, key: key })));
  console.log('카카오 키: ' + (P.getProperty('KAKAO_REST_KEY') ? '있어요' : '아직 없어요 (스크립트 속성 KAKAO_REST_KEY)'));
  console.log('텔레그램: ' + (P.getProperty('TG_TOKEN') ? '토큰 있어요' : '아직 없어요 (스크립트 속성 TG_TOKEN)'));
}
/** 카카오 연결 시험: 저장한 장소로 지금 퇴근길을 물어본다 */
function testKakao() {
  const d = load_({ route: 'w2h', step: 30, hours: 2 });
  console.log(alertText_(d) + '\n거리 ' + d.dist + 'km · 통행료 ' + d.toll + '원 · ' + d.roads.join(', '));
}
