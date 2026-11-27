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
      return { ok: true, data: { setup: !!P.getProperty('APP_KEY'), kakao: !!P.getProperty('KAKAO_REST_KEY'), ex: !!P.getProperty('EX_KEY'), jsKey: !!P.getProperty('KAKAO_JS_KEY'), ex: !!P.getProperty('EX_KEY'), tg: !!P.getProperty('TG_TOKEN'),
        chat: !!P.getProperty('TG_CHAT_ID'), places: !!(pl.work && pl.home && pl.dorm), trigger: ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'tick'), push: pushList_().map(x => (x.endpoint.match(/^https:\/\/([^\/]+)/) || [])[1] + ' ' + (x.at || '') + ' / ' + (x.last || '안 보냄')).join(' | ') || '구독 0', sent: P.getProperty('SENT') || '-', alerts: JSON.stringify(cfg_().alerts), today: todayRoutes_(day_()).join(',') || '없음', seoul: !!P.getProperty('SEOUL_KEY'), seoulData: (() => { try { const L = seoulInfo_(); return L.length + '건 (좌표 ' + L.filter(x => x.lat).length + ')'; } catch (e) { return '오류: ' + plain_(e).slice(0, 80); } })() } };
    }
    const key = P.getProperty('APP_KEY');
    if (!key) return { ok: false, code: 'setup', message: '서버 준비가 아직이에요. 편집기에서 setup() 을 한 번 실행해 주세요' };
    if (String(b.key || '') !== key) return { ok: false, code: 'auth', message: '앱 암호가 맞지 않아요. 설정에서 다시 넣어 주세요' };
    const a = b.action;
    const pr = pushRoute_(b, 'me', ''); if (pr) return { ok: true, data: pr };
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
    seoul: !!P.getProperty('SEOUL_KEY'), kakao: !!P.getProperty('KAKAO_REST_KEY'), calls: calls[0] === day_() ? +calls[1] : 0, tg: tg };
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
  const ck = it => ['nv3', ver, route, it.live ? 'now' + Math.floor(it.t / 18e4) : kst_(it.t, 'yyyyMMddHHmm'), it.full ? 'f' : 's'].join('|');
  const hit = cache.getAll(list.map(ck)), res = list.map(it => hit[ck(it)] ? JSON.parse(hit[ck(it)]) : null);
  const need = list.map((it, i) => res[i] ? -1 : i).filter(i => i >= 0);
  if (need.length) {
    const qs = 'origin=' + o.x + ',' + o.y + '&destination=' + d.x + ',' + d.y + '&priority=RECOMMEND';
    const reqs = need.map(i => { const it = list[i];
      return { url: NAVI + (it.live ? 'directions?' : 'future/directions?departure_time=' + kst_(it.t, 'yyyyMMddHHmm') + '&') + qs + '&summary=' + (it.full ? 'false' : 'true') + '&alternatives=true',
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
      // 여러 길(alternatives) 중 그 시각에 가장 빠른 길을 쓴다 — 카카오가 막히는 길 하나만 고집해 한 칸만 튀던 것 방지
      const j = JSON.parse(r.getContentText()), ok = (j.routes || []).filter(x => x.result_code === 0 && x.summary), rt = ok.sort((a, b) => a.summary.duration - b.summary.duration)[0] || (j.routes || [])[0];
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
      const text = alertText_(load_({ route: r, step: c.step, hours: c.hours }));
      const okTg = tg_(text), okPush = pushAlert_(text), ok = okTg || okPush;
      if (ok) { sent[r] = k; P.setProperty('SENT', JSON.stringify(sent)); }
    });
  } catch (e) { reportError_(e); }
}
function test_() {
  const hasTg = !!P.getProperty('TG_TOKEN'), hasPush = pushCount_() > 0;
  if (!hasTg && !hasPush) return { sent: [], reason: '휴대폰 알림을 켜거나 텔레그램을 연결해 주세요' };
  const c = cfg_(), text = alertText_(load_({ route: nextTrip_(Date.now()).r, step: c.step, hours: c.hours }));
  const sent = [];
  if (hasPush && pushAlert_(text)) sent.push('휴대폰');
  if (hasTg && tg_(text)) sent.push('텔레그램');
  return sent.length ? { sent: sent, text: text } : { sent: [], reason: hasTg ? '봇 대화방에서 시작을 눌렀는지 확인해 주세요' : '휴대폰 알림을 다시 켜 주세요' };
}
/** 출발 알림 글을 휴대폰 알림으로: 첫 줄은 제목, 나머지는 한 줄로 */
function pushAlert_(text) {
  if (!pushCount_()) return false;
  const lines = String(text).split('\n');
  return pushTo_(() => true, '🚗 ' + lines[0].replace('[출발 도우미] ', ''), lines.slice(1).join(' · ')).some(x => /^20[01]/.test(x));
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
  let seoulErr = '';
  try { seoulInfo_().forEach(x => out.push(x)); } catch (e) { seoulErr = plain_(e); }   // 서울시 자료가 안 돼도 고속도로 자료는 보이게
  const res = { items: out, at: Date.now(), test: !P.getProperty('EX_KEY'), seoul: !!P.getProperty('SEOUL_KEY'), seoulErr: seoulErr };
  try { cache.put('ex1', JSON.stringify(res), 180); } catch (e) {}
  return res;
}
/* ── 서울시 실시간 돌발 정보 (서울 열린데이터광장 AccInfo, 올림픽대로·서부간선도로 같은 도시고속도로·일반도로 사고·공사)
   키는 스크립트 속성 SEOUL_KEY. XML 로만 준다(JSON 은 오류). 좌표는 GRS80 TM 중부원점 → 위경도로 바꾼다. 종류 이름은 AccMainCode 로 받아 하루 기억 */
const SEOUL_ROADS = ['올림픽대로', '강변북로', '서부간선도로', '동부간선도로', '내부순환로', '북부간선도로', '강남순환로', '경부고속도로', '분당수서로', '양재대로', '남부순환로', '노들로', '공항대로', '양천로', '가양대교', '성산대교', '한강대교', '반포대교', '영동대교', '청담대교', '봉은교', '탄천'];
function seoulInfo_() {
  const key = (P.getProperty('SEOUL_KEY') || '').trim(); if (!key) return [];
  const cache = CacheService.getScriptCache(), get = path => {
    const r = UrlFetchApp.fetch('http://openapi.seoul.go.kr:8088/' + encodeURIComponent(key) + '/xml/' + path, { muteHttpExceptions: true });
    const root = XmlService.parse(r.getContentText()).getRootElement(), code = root.getChild('RESULT') && root.getChild('RESULT').getChildText('CODE');
    if (code && code !== 'INFO-000') { if (code === 'INFO-200') return []; throw new Error('서울시 자료: ' + (root.getChild('RESULT').getChildText('MESSAGE') || code)); }
    return root.getChildren('row').map(e => Object.fromEntries(e.getChildren().map(c => [c.getName(), c.getText()])));
  };
  let names = cache.get('seoulCodes');
  // 칸 이름을 몰라도 되게 (코드, 이름) 순서로 읽는다
  if (!names) { const m = {}; get('AccMainCode/1/100/').forEach(r => { const v = Object.values(r); m[v[0]] = v[1]; }); names = JSON.stringify(m); cache.put('seoulCodes', names, 21600); }
  names = JSON.parse(names);
  return get('AccInfo/1/1000/').map(r => {
    const nm = names[r.acc_type] || '돌발', info = String(r.acc_info || '').replace(/\r/g, '\n').trim(), first = info.split('\n')[0];
    const ll = (+r.grs80tm_x && +r.grs80tm_y) ? tm2ll_(+r.grs80tm_x, +r.grs80tm_y) : [null, null];
    const g = /사고|고장|낙하|화재/.test(nm) ? 'acc' : /공사|작업/.test(nm) ? 'work' : /기상|강우|강설|결빙|안개|침수/.test(nm) ? 'wx' : /정체/.test(nm) ? 'jam' : 'etc';
    const road = SEOUL_ROADS.find(n => info.indexOf(n) >= 0) || '서울시 도로';
    const d8 = v => String(v || ''), hm = v => d8(v).padStart(4, '0').slice(0, 2) + ':' + d8(v).padStart(4, '0').slice(2, 4);
    return { k: nm, c: 'S' + r.acc_type, g: g, src: '서울시', road: road, dir: '', at: first.length > 40 ? '' : first, text: first.length > 40 ? info : info.split('\n').slice(1).join(' ').trim(),
      len: 0, time: d8(r.occr_date).slice(4, 6) + '.' + d8(r.occr_date).slice(6, 8) + ' ' + hm(r.occr_time),
      until: d8(r.exp_clr_date) ? d8(r.exp_clr_date).slice(0, 4) + '.' + d8(r.exp_clr_date).slice(4, 6) + '.' + d8(r.exp_clr_date).slice(6, 8) : '',
      lanes: [0, 0, 0, 0, 0, 0], sh: 0, lon: ll[0], lat: ll[1] };
  });
}
// 서울시 돌발 정보 좌표(GRS80 TM 중부원점, EPSG:5181: 원점 38N·127E, 가산 200000/500000) → 위경도
function tm2ll_(x, y) {
  const a = 6378137, f = 1 / 298.257222101, e2 = f * (2 - f), ep2 = e2 / (1 - e2), k0 = 1, lat0 = 38 * Math.PI / 180, lon0 = 127 * Math.PI / 180;
  const Mf = p => a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256) * p - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * p) + (15 * e2 * e2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * p) - (35 * e2 ** 3 / 3072) * Math.sin(6 * p));
  const mu = (Mf(lat0) + (y - 500000) / k0) / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256)), e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu) + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const s = Math.sin(p1), c = Math.cos(p1), t = Math.tan(p1), C1 = ep2 * c * c, T1 = t * t, N1 = a / Math.sqrt(1 - e2 * s * s), R1 = a * (1 - e2) / Math.pow(1 - e2 * s * s, 1.5), D = (x - 200000) / (N1 * k0);
  const lat = p1 - (N1 * t / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
  const lon = lon0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / c;
  return [Math.round(lon * 180 / Math.PI * 1e6) / 1e6, Math.round(lat * 180 / Math.PI * 1e6) / 1e6];
}

// 위젯 자료: 다음 길의 지금 시간·도착·가장 빠른 출발 + 30분마다 시간 + 막힘 막대 + 길 위 사고·공사 (화면 앱과 같은 계산)
const EMO_ = { crash: '💥', wrench: '🔧', warn: '⚠️', cone: '🚧', light: '🚦', rain: '🌧️', snow: '❄️', fog: '🌫️', wind: '💨', info: 'ℹ️' };
function exGrp_(x) {
  if (x.g) return x.g; const c = x.c;
  return ['00', '01', '02', '16', '30', '31'].indexOf(c) >= 0 ? 'acc' : ['03', '75'].indexOf(c) >= 0 ? 'work' : c === '04' ? 'jam' : ['06', '09', '17', '18', '19', '20', '21'].indexOf(c) >= 0 ? 'wx' : 'etc';
}
function exEmo_(x) {
  const g = exGrp_(x), k = x.k || '';
  if (g === 'acc') return EMO_[/고장/.test(k) || x.c === '01' ? 'wrench' : /역주행|장애물|낙하/.test(k) || x.c === '02' || x.c === '16' ? 'warn' : 'crash'];
  if (g === 'work') return EMO_.cone; if (g === 'jam') return EMO_.light;
  if (g === 'wx') return EMO_[/눈|강설|적설|결빙/.test(k) ? 'snow' : /안개/.test(k) ? 'fog' : /강풍/.test(k) ? 'wind' : 'rain'];
  return EMO_.info;
}
function widget_() {
  const t = nextTrip_(Date.now()), d = load_({ route: t.r, step: 30, hours: 3 }), n = d.slots[0];
  const mn = Math.min.apply(null, d.slots.map(x => x.min)), b = d.slots.filter(x => x.min === mn)[0];
  // 막힘 막대: 구간 길이 비율과 막힘 정도(1 정체 ~ 4 원활), 비슷한 것끼리 합쳐 40칸 안쪽
  const tot = d.path.reduce((a, x) => a + (x.d || 0), 0) || 1, bar = [];
  d.path.forEach(x => { const f = (x.d || 0) / tot, last = bar[bar.length - 1]; if (last && (last[0] === x.s || f < .01)) last[1] += f; else bar.push([x.s, f]); });
  // 길 위 사고·공사 (400m 안, 정체는 막힘 막대로 보이므로 뺀다), 가는 순서대로
  let inc = [];
  try {
    const pts = []; d.path.forEach(x => x.p.forEach(q => pts.push(q)));
    inc = exInfo_().items.filter(x => x.lat != null && exGrp_(x) !== 'jam').map(x => {
      let bi = -1, bd = 400; pts.forEach((q, k) => { const m = Math.sqrt(Math.pow((q[0] - x.lon) * 88800, 2) + Math.pow((q[1] - x.lat) * 111000, 2)); if (m < bd) { bd = m; bi = k; } });
      return { x: x, i: bi };
    }).filter(o => o.i >= 0).sort((a, c) => a.i - c.i).map(o => ({ e: exEmo_(o.x), at: String(o.x.at || o.x.road || '').replace(/^\S+선 /, '').slice(0, 18), road: o.x.road, k: o.x.k }));
  } catch (e) {}
  const pn = { w2h: ['회사', '집'], h2w: ['집', '회사'], h2d: ['집', '숙소'] }[d.route] || ['출발', '도착'];
  return { route: d.route, name: ROUTES[d.route].name, short: ROUTES[d.route].short, from: pn[0], to: pn[1], min: n.min, arrive: kst_(n.t + n.min * 6e4, 'HH:mm'),
    best: kst_(b.t, 'HH:mm'), bestMin: b.min, gain: n.min - b.min, bestIsNow: b === n,
    mins: d.slots.map(x => x.min), times: d.slots.map((x, i) => i ? kst_(x.t, 'HH:mm') : '지금'), bar: bar, inc: inc, at: kst_(Date.now(), 'HH:mm') };
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

const PUSH_SUB_URL = 'https://friese8807.github.io/commute/';
// ════════════════════════ 휴대폰 푸시 알림 ════════════════════════
// friese-mobile-webapp-kit · web-push. 내용 없는 푸시를 VAPID 서명으로 보내고, 휴대폰(sw.js)이 pushMsg 로 문구를 받아 띄운다.
// 구독 목록·열쇠는 스크립트 속성(PUSH_SUBS·VAPID_*). 처음 한 번 편집기에서 allowPush() 실행 → 외부 연결 권한 허용.
// route: pushKey · pushMsg · pushSub · pushOff · pushTest (아래 pushRoute_ 한 줄로 연결)

/** 편집기에서 한 번 실행: '외부 서비스 연결' 권한 허용 창을 띄운다 */
function allowPush() {
  UrlFetchApp.fetch('https://web.push.apple.com/', { muteHttpExceptions: true });
  Logger.log('알림 권한이 허용돼 있어요. 이제 앱에서 휴대폰 알림을 켜 보세요.');
}
/** route 에서: const pr = pushRoute_(req, who, name); if (pr) return pr; — 푸시 요청이 아니면 null */
function pushRoute_(req, who, name) {
  const a = req.action, ep = String(req.endpoint || '');
  if (a === 'pushKey') return { key: vapid_().pub };
  if (a === 'pushMsg') return { msg: popMsg_(ep) };
  if (a === 'pushSub') { pushSub_(ep, who, name); return { on: true }; }
  if (a === 'pushOff') { pushOff_(ep); return { on: false }; }
  if (a === 'pushTest') return { res: pushTo_(function (x) { return x.endpoint === ep; }, '알림이 잘 와요 🔔', (name ? name + ' ' : '') + '휴대폰에 알림이 켜져 있어요') };
  return null;
}
function pushList_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('PUSH_SUBS') || '[]'); } catch (e) { return []; } }
function pushSave_(l) { PropertiesService.getScriptProperties().setProperty('PUSH_SUBS', JSON.stringify(l.slice(-30))); }
function pushSub_(ep, who, name) {
  if (!/^https:\/\/[^\s]{10,900}$/.test(ep)) throw new Error('알림 주소가 올바르지 않아요');
  const l = pushList_().filter(function (x) { return x.endpoint !== ep; });
  l.push({ endpoint: ep, who: String(who || ''), name: String(name || '').slice(0, 20), at: Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm') });
  pushSave_(l);
}
function pushOff_(ep) { pushSave_(pushList_().filter(function (x) { return x.endpoint !== ep; })); }
function pushCount_() { return pushList_().length; }
function msgKey_(ep) { return 'pm_' + pBig_(pSha_(String(ep))).toString(16); }
function popMsg_(ep) {
  const c = CacheService.getScriptCache(), k = msgKey_(ep); let list = [];
  try { list = JSON.parse(c.get(k) || '[]'); } catch (e) { list = []; }
  const m = list.shift() || null; c.put(k, JSON.stringify(list), 21600);
  return m;
}
/** 조건에 맞는 휴대폰마다 문구를 맡기고 내용 없는 푸시를 보낸다. 결과 문자열 배열. 오류는 삼킨다(본래 동작을 막지 않게). */
function pushTo_(match, title, body) {
  const out = [];
  try {
    const all = pushList_(), targets = all.filter(match); if (!targets.length) return out;
    const v = vapid_(), c = CacheService.getScriptCache(), gone = {};
    targets.forEach(function (t) {
      const k = msgKey_(t.endpoint); let list = [];
      try { list = JSON.parse(c.get(k) || '[]'); } catch (e) {}
      list.push({ title: String(title).slice(0, 80), body: String(body).slice(0, 300) }); c.put(k, JSON.stringify(list.slice(-5)), 21600);
      const res = UrlFetchApp.fetch(t.endpoint, { method: 'post', payload: '', muteHttpExceptions: true,
        headers: { TTL: '86400', Urgency: 'high', Authorization: 'vapid t=' + jwt_(v, t.endpoint.match(/^https:\/\/[^\/]+/)[0]) + ', k=' + v.pub } });
      const code = res.getResponseCode(), txt = code + ' ' + String(res.getContentText() || '').slice(0, 120);
      out.push(txt); t.last = Utilities.formatDate(new Date(), 'Asia/Seoul', 'MM-dd HH:mm') + ' ' + txt;
      if (code === 404 || code === 410) gone[t.endpoint] = 1;
    });
    pushSave_(all.filter(function (x) { return !gone[x.endpoint]; }));
  } catch (e) { out.push('오류 ' + e); }
  return out;
}
// ---- VAPID (ES256, P-256) — Apps Script V8 의 BigInt 로 직접 서명 ----
function pB64u_(x) { return (typeof x === 'string' ? Utilities.base64EncodeWebSafe(x, Utilities.Charset.UTF_8) : Utilities.base64EncodeWebSafe(x)).replace(/=+$/, ''); }
function pSha_(x) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, x); }
function pBig_(bytes) { var h = '0x0'; bytes.forEach(function (b) { h += ('0' + ((b + 256) % 256).toString(16)).slice(-2); }); return BigInt(h); }
function pBytes_(x, n) { var h = x.toString(16); while (h.length < n * 2) h = '0' + h; var o = []; for (var i = 0; i < n; i++) { var v = parseInt(h.substr(i * 2, 2), 16); o.push(v > 127 ? v - 256 : v); } return o; }
var P256_ = null;
function p256_() {
  if (!P256_) P256_ = { p: BigInt('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff'), n: BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551'),
    G: [BigInt('0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296'), BigInt('0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5')] };
  return P256_;
}
function pMod_(a, m) { a = a % m; return a < BigInt(0) ? a + m : a; }
function pInv_(a, m) { var t = BigInt(0), nt = BigInt(1), r = m, nr = pMod_(a, m), q, x; while (nr !== BigInt(0)) { q = r / nr; x = t - q * nt; t = nt; nt = x; x = r - q * nr; r = nr; nr = x; } return pMod_(t, m); }
function pAdd_(P, Q) {
  if (!P) return Q; if (!Q) return P;
  var p = p256_().p, l;
  if (P[0] === Q[0]) { if (pMod_(P[1] + Q[1], p) === BigInt(0)) return null; l = pMod_(BigInt(3) * P[0] * P[0] - BigInt(3), p) * pInv_(BigInt(2) * P[1], p) % p; }
  else l = pMod_(Q[1] - P[1], p) * pInv_(Q[0] - P[0], p) % p;
  var x = pMod_(l * l - P[0] - Q[0], p);
  return [x, pMod_(l * (P[0] - x) - P[1], p)];
}
function pMul_(k, P) { var R = null; while (k > BigInt(0)) { if (k % BigInt(2) === BigInt(1)) R = pAdd_(R, P); P = pAdd_(P, P); k = k / BigInt(2); } return R; }
function pRnd_(extra) { return pBig_(pSha_(Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid() + String(extra || '') + Date.now())); }
function vapid_() {
  const P_ = PropertiesService.getScriptProperties();
  var d = P_.getProperty('VAPID_D'), pub = P_.getProperty('VAPID_PUB');
  if (!d || !pub) {
    var n = p256_().n, D = pMod_(pRnd_(), n - BigInt(1)) + BigInt(1), Q = pMul_(D, p256_().G);
    d = D.toString(16); pub = pB64u_([4].concat(pBytes_(Q[0], 32), pBytes_(Q[1], 32)));
    P_.setProperties({ VAPID_D: d, VAPID_PUB: pub });
  }
  return { d: BigInt('0x' + d), pub: pub };
}
function jwt_(v, aud) {
  var msg = pB64u_(JSON.stringify({ typ: 'JWT', alg: 'ES256' })) + '.' + pB64u_(JSON.stringify({ aud: aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: PUSH_SUB_URL }));
  var c = p256_(), e = pBig_(pSha_(msg)), r = BigInt(0), s = BigInt(0);
  while (r === BigInt(0) || s === BigInt(0)) {
    var k = pMod_(pRnd_(v.d.toString(16) + msg), c.n - BigInt(1)) + BigInt(1);
    r = pMod_(pMul_(k, c.G)[0], c.n);
    s = pMod_(pInv_(k, c.n) * (e + r * v.d), c.n);
  }
  return msg + '.' + pB64u_(pBytes_(r, 32).concat(pBytes_(s, 32)));
}
