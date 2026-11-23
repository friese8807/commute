// COMMUTE_WIDGET — 출발 도우미 위젯 본체 (Scriptable 앱용)
// 로더가 실행될 때마다 이 파일을 새로 받아 씁니다. 여기만 고쳐서 올리면 모든 폰의 위젯이 바뀝니다.
// 크기: 작은·중간·큰 위젯, 잠금 화면(사각형·한 줄·원). 사용자가 고른 B(시각별 막대)+C(막힘 막대·사고) 합친 모양

const APP_URL = "https://friese8807.github.io/commute/";

// 밝은·어두운 화면 색 (앱의 파스텔 하늘 색과 맞춘다)
const D = (l, d) => Color.dynamic(new Color(l), new Color(d));
const C = { bg: D("#ffffff", "#1c2430"), ink: D("#111318", "#eef0f4"), sub: D("#6b7079", "#9aa1ad"), go: D("#1d6b3c", "#9fdcb4") };
// DrawContext 그림은 밝기 전환이 안 되므로 양쪽에서 보이는 고정색
const BAR = "#a9cbe8", NOW = "#e0794f", BEST = "#4f93c9", TS = { 1: "#e5484d", 2: "#f07a32", 3: "#e9b10c", 4: "#30a46c", 6: "#8e4ec6", 0: "#9aa3b2" };

const FONT = { r: "systemFont", m: "mediumSystemFont", s: "semiboldSystemFont", b: "boldSystemFont", rb: "boldRoundedSystemFont" };
function txt(st, s, size, color, w, scale) {
  const t = st.addText(String(s)); t.font = Font[FONT[w || "r"]](size); t.textColor = color;
  t.lineLimit = 1; t.minimumScaleFactor = scale || 0.6;      // 길면 줄바꿈 대신 글자를 줄인다
  return t;
}
function hstack(p) { const s = p.addStack(); s.layoutHorizontally(); s.centerAlignContent(); return s; }
function vstack(p) { const s = p.addStack(); s.layoutVertically(); return s; }
const dur = m => m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`;

/* 데이터: 서버(Apps Script)에서 새로 받고, 실패하면 마지막으로 받은 것을 "오프라인"으로 */
async function getData(opts) {
  const fm = FileManager.local(), path = fm.joinPath(fm.cacheDirectory(), "commute-widget.json");
  let d = null, stale = false;
  try {
    if (!opts.server || !opts.pin) throw new Error("no setup");
    const r = new Request(opts.server + "?action=widget&key=" + encodeURIComponent(opts.pin) + "&t=" + Date.now());
    r.timeoutInterval = 20;
    const j = await r.loadJSON();
    if (j && j.ok) { d = j.data; fm.writeString(path, JSON.stringify(d)); }
  } catch (e) { d = null; }
  if (!d && fm.fileExists(path)) { try { d = JSON.parse(fm.readString(path)); stale = true; } catch (e) {} }
  if (!d) return null;
  d.when = (stale ? "오프라인 " : "") + d.at;
  return d;
}

/* 그림: 시각별 막대 (지금 주황, 가장 빠름 진한 파랑) */
function barsImage(d, w, h, lock) {
  const dc = new DrawContext(); dc.size = new Size(w, h); dc.opaque = false; dc.respectScreenScale = true;
  const m = d.mins || [], mx = Math.max(...m), mn = Math.min(...m), lo = Math.max(0, mn - (mx - mn) * 0.8 - 5), n = m.length, gap = 3, bw = (w - gap * (n - 1)) / n;
  m.forEach((v, i) => {
    const bh = Math.max(3, (v - lo) / Math.max(1, mx - lo) * h), p = new Path();
    p.addRoundedRect(new Rect(i * (bw + gap), h - bh, bw, bh), 2.5, 2.5); dc.addPath(p);
    dc.setFillColor(new Color(lock ? (i === 0 ? "#ffffff" : "#ffffff") : i === 0 ? NOW : v === mn ? BEST : BAR, lock && i !== 0 ? 0.45 : 1)); dc.fillPath();
  });
  return dc.getImage();
}
/* 그림: 막힘 막대 (출발 → 도착, 구간 길이만큼 색) */
function trafficImage(d, w, h) {
  const dc = new DrawContext(); dc.size = new Size(w, h); dc.opaque = false; dc.respectScreenScale = true;
  const clip = new Path(); clip.addRoundedRect(new Rect(0, 0, w, h), h / 2, h / 2);
  let x = 0; (d.bar || []).forEach(([s, f]) => { const p = new Path(); p.addRect(new Rect(x, 0, Math.max(1, f * w) + 0.5, h)); dc.addPath(p); dc.setFillColor(new Color(TS[s] || TS[0])); dc.fillPath(); x += f * w; });
  return dc.getImage();
}
const img = (st, image, w, h) => { const i = st.addImage(image); i.imageSize = new Size(w, h); return i; };
const incIcons = d => (d.inc || []).map(x => x.e).join("");

function header(w, d, size) {
  const h = hstack(w); txt(h, `🚗 ${d.name} · ${d.short}`, size || 11, C.sub, "s"); h.addSpacer(); txt(h, d.when, 9, C.sub);
}
function small(w, d) {
  header(w, d, 10); w.addSpacer(2);
  txt(w, dur(d.min), 24, C.ink, "rb", 0.5);
  const a = hstack(w); txt(a, `도착 ${d.arrive}`, 12, C.ink, "b"); if (!d.bestIsNow) { a.addSpacer(4); txt(a, `⏱${d.best}`, 12, C.go, "b"); }
  w.addSpacer(4); img(w, barsImage(d, 130, 22), 130, 22);
  w.addSpacer(4); img(w, trafficImage(d, 130, 6), 130, 6);
  w.addSpacer(3); txt(w, d.inc?.length ? `${incIcons(d)} 길 위 ${d.inc.length}건` : "길 위 사고·공사 없음", 10, C.sub, "m");
}
function medium(w, d) {
  header(w, d); w.addSpacer(2);
  const top = hstack(w);
  const l = vstack(top); txt(l, dur(d.min), 26, C.ink, "rb", 0.5); txt(l, `도착 ${d.arrive}`, 13, C.ink, "b");
  top.addSpacer(10);
  const r = vstack(top); img(r, barsImage(d, 165, 40), 165, 40);
  const ax = hstack(r); txt(ax, "지금", 8, C.sub); ax.addSpacer(); txt(ax, (d.times || []).slice(-1)[0] || "", 8, C.sub);
  w.addSpacer(3);
  txt(w, d.bestIsNow ? "⏱ 지금 떠나는 게 가장 빨라요" : `⏱ ${d.best} 출발이 가장 빨라요 · ${dur(d.bestMin)} (${d.gain}분 덜)`, 11, C.go, "b");
  w.addSpacer(4); img(w, trafficImage(d, 300, 7), 300, 7);
  w.addSpacer(3);
  const i0 = (d.inc || [])[0];
  txt(w, i0 ? `${i0.e} ${i0.at}${d.inc.length > 1 ? ` 외 ${d.inc.length - 1}건 ${d.inc.slice(1).map(x => x.e).join("")}` : ""}` : `${d.from} → ${d.to} · 길 위 사고·공사 없음`, 11, C.sub, "m");
}
function large(w, d) {
  medium(w, d); w.addSpacer(8);
  txt(w, "30분마다", 11, C.sub, "s"); w.addSpacer(2);
  const mn = Math.min(...(d.mins || []));
  (d.mins || []).forEach((v, i) => {
    const r = hstack(w), c = v === mn ? C.go : C.ink, wt = v === mn ? "b" : "m";
    txt(r, d.times[i], 13, c, wt); r.addSpacer(); txt(r, dur(v), 13, c, wt); w.addSpacer(2);
  });
  w.addSpacer();
}
function accessory(w, d, fam) {
  if (fam === "accessoryInline") { txt(w, `🚗 ${d.name} ${dur(d.min)} · 도착 ${d.arrive}${d.bestIsNow ? "" : " · ⏱" + d.best} ${incIcons(d)}`, 12, Color.white(), "s"); return; }
  if (fam === "accessoryCircular") { w.addSpacer(); const s = hstack(w); s.addSpacer(); const v = vstack(s); txt(v, d.name, 9, Color.white(), "s"); txt(v, `${d.min}분`, 15, Color.white(), "rb", 0.5); s.addSpacer(); w.addSpacer(); return; }
  txt(w, `🚗 ${d.name} ${dur(d.min)} · ${incIcons(d) || "도착 " + d.arrive}`, 11, Color.white(), "s");
  w.addSpacer(2); img(w, barsImage(d, 140, 18, true), 140, 18);
  w.addSpacer(3); img(w, trafficImage(d, 140, 5), 140, 5);
}

module.exports = async function (opts) {
  opts = opts || {};
  const fam = config.widgetFamily || String(args.widgetParameter || opts.preview || "medium");
  const w = new ListWidget();
  w.url = APP_URL + "?via=widget";                              // 누르면 앱 열기
  if (!fam.startsWith("accessory")) { w.backgroundColor = C.bg; w.setPadding(12, 13, 11, 13); }
  const d = await getData(opts);
  if (!d) {
    txt(w, "출발 도우미", 13, fam.startsWith("accessory") ? Color.white() : C.ink, "b");
    txt(w, opts.server && opts.pin ? "불러오지 못했어요" : "코드 맨 위에 서버 주소·암호를 넣어 주세요", 11, fam.startsWith("accessory") ? Color.white() : C.sub, "r", 0.5);
    w.refreshAfterDate = new Date(Date.now() + 10 * 60 * 1000);
  } else {
    if (fam.startsWith("accessory")) accessory(w, d, fam);
    else if (fam === "small") small(w, d); else if (fam === "large") large(w, d); else medium(w, d);
    w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);  // 실제 시각은 아이폰이 정한다 (보통 15~30분)
  }
  if (config.runsInWidget || config.runsInAccessoryWidget) Script.setWidget(w);
  else if (fam === "small") await w.presentSmall(); else if (fam === "large") await w.presentLarge(); else await w.presentMedium();
  Script.complete();
};
