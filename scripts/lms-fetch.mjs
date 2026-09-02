// 경희대 e-campus(러닝X, Canvas 기반) → data/lms.json
// 1순위: Canvas REST API (LMS_BASE_URL + LMS_TOKEN)
// 폴백:  캘린더 .ics 피드 (LMS_ICS_URL) — 과제 마감만
// 토큰은 GitHub Secrets에서만 주입. 코드/커밋에 절대 넣지 않음.
import fs from 'node:fs';

const OUT = 'data/lms.json';
const BASE = (process.env.LMS_BASE_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.LMS_TOKEN || '';
const ICS = process.env.LMS_ICS_URL || '';

const prev = (() => { try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { return null; } })();
const write = (obj) => { fs.mkdirSync('data', { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(obj, null, 2) + '\n'); console.log('wrote', OUT, `assignments=${obj.assignments?.length ?? 0} notices=${obj.notices?.length ?? 0} source=${obj.source}`); };
const strip = (html) => String(html || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const summarize = (html, n = 240) => { const t = strip(html); return t.length > n ? t.slice(0, n) + '…' : t; };

async function canvasGet(path, params = {}) {
  // 페이지네이션(Link: rel="next") 자동 수집
  let url = new URL(BASE + '/api/v1' + path);
  for (const [k, v] of Object.entries(params)) Array.isArray(v) ? v.forEach(x => url.searchParams.append(k, x)) : url.searchParams.set(k, v);
  url.searchParams.set('per_page', '100');
  const all = [];
  for (let i = 0; i < 20 && url; i++) {
    let r;
    try { r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) }); }
    catch (e) { const c = e.cause || {}; throw new Error(`Canvas ${path} 연결 실패: ${e.message}${c.code ? ' [' + c.code + ']' : ''}${c.message ? ' ' + c.message : ''}`); }
    if (!r.ok) throw new Error(`Canvas ${path} → HTTP ${r.status}`);
    const j = await r.json();
    if (Array.isArray(j)) all.push(...j); else return j;
    const link = r.headers.get('link') || '';
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? new URL(m[1]) : null;
  }
  return all;
}

async function fromCanvas() {
  const me = await canvasGet('/users/self');           // Canvas 여부 + 토큰 검증
  const courses = (await canvasGet('/courses', { enrollment_state: 'active', 'include[]': ['term'] }))
    .filter(c => c && c.name && !c.access_restricted_by_date);
  const assignments = [], notices = [];
  for (const c of courses) {
    const cname = c.course_code || c.name;
    try {
      const as = await canvasGet(`/courses/${c.id}/assignments`, { 'include[]': ['submission'], order_by: 'due_at' });
      for (const a of as) {
        if (!a.published) continue;
        const s = a.submission || {};
        assignments.push({ id: `a${a.id}`, course: cname, title: a.name, due: a.due_at || null,
          submitted: !!(s.submitted_at || s.workflow_state === 'submitted' || s.workflow_state === 'graded'),
          url: a.html_url || `${BASE}/courses/${c.id}/assignments/${a.id}` });
      }
    } catch (e) { console.warn('assignments', cname, e.message); }
    try {
      const an = await canvasGet('/announcements', { 'context_codes[]': [`course_${c.id}`], active_only: 'true' });
      for (const n of an) notices.push({ id: `n${n.id}`, course: cname, title: n.title, date: n.posted_at || n.created_at || null, summary: summarize(n.message), url: n.html_url || '' });
    } catch (e) { console.warn('announcements', cname, e.message); }
  }
  return { generatedAt: new Date().toISOString(), source: 'canvas', user: me?.name || null, courses: courses.map(c => c.course_code || c.name), assignments, notices };
}

function parseIcs(text) {
  const events = []; let cur = null;
  const lines = text.replace(/\r\n[ \t]/g, '').split(/\r?\n/);
  for (const ln of lines) {
    if (ln === 'BEGIN:VEVENT') cur = {};
    else if (ln === 'END:VEVENT') { if (cur) events.push(cur); cur = null; }
    else if (cur) { const i = ln.indexOf(':'); if (i > 0) { const k = ln.slice(0, i).split(';')[0]; cur[k] = ln.slice(i + 1); } }
  }
  const toIso = (v) => { if (!v) return null; const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/); if (!m) return null;
    return m[7] ? new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))).toISOString() : new Date(+m[1], m[2] - 1, +m[3], +(m[4] || 23), +(m[5] || 59)).toISOString(); };
  return events.map(e => ({ id: 'i' + (e.UID || e.SUMMARY), course: (e.SUMMARY || '').match(/\[(.+?)\]/)?.[1] || '', title: (e.SUMMARY || '').replace(/\s*\[.+?\]\s*$/, ''),
    due: toIso(e.DTEND || e.DTSTART), submitted: false, url: e.URL || '' })).filter(a => a.due);
}
async function fromIcs() {
  let r; try { r = await fetch(ICS, { signal: AbortSignal.timeout(20000) }); } catch (e) { const c = e.cause || {}; throw new Error(`ICS 연결 실패: ${e.message}${c.code ? ' [' + c.code + ']' : ''}`); }
  if (!r.ok) throw new Error(`ICS HTTP ${r.status}`);
  const assignments = parseIcs(await r.text());
  return { generatedAt: new Date().toISOString(), source: 'ics', assignments, notices: [] };
}

async function diag() {
  if (!BASE) return null;
  try { const dns = await import('node:dns/promises'); const host = new URL(BASE).hostname; const a = await dns.lookup(host); return `dns ${host} → ${a.address}`; }
  catch (e) { return `dns 실패: ${e.code || e.message}`; }
}
(async () => {
  let err = null;
  const d = await diag(); if (d) console.log('[diag]', d);
  if (BASE && TOKEN) { try { return write(await fromCanvas()); } catch (e) { err = e.message; console.warn('Canvas 실패:', err); } }
  else console.warn('LMS_BASE_URL/LMS_TOKEN 미설정 → Canvas 건너뜀');
  if (ICS) { try { const d = await fromIcs(); d.error = err || undefined; return write(d); } catch (e) { err = (err ? err + ' / ' : '') + e.message; console.warn('ICS 실패:', e.message); } }
  // 둘 다 실패: 이전 데이터 보존 + 오류만 갱신
  write({ ...(prev || { assignments: [], notices: [] }), generatedAt: prev?.generatedAt || null, checkedAt: new Date().toISOString(), error: err || 'secrets not configured', diag: d || undefined });
  process.exitCode = 0; // 워크플로는 실패로 처리하지 않음 (데이터는 보존)
})();
