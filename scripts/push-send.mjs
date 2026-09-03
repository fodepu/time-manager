// 새 과제·공지 → 웹 푸시 (GitHub Actions에서 lms-fetch 다음에 실행)
// env: FIREBASE_SA (서비스 계정 JSON), VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, OLD_LMS (이전 lms.json 경로, 기본 /tmp/old-lms.json)
import fs from 'node:fs';
import webpush from 'web-push';
import admin from 'firebase-admin';

const NEW = 'data/lms.json';
const OLD = process.env.OLD_LMS || '/tmp/old-lms.json';
const load = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const cur = load(NEW); if (!cur) { console.log('no lms.json'); process.exit(0); }
const prev = load(OLD);
if (!prev) { console.log('no previous lms.json → 기준만 잡고 발송 안 함'); process.exit(0); }

const ids = a => new Set((a || []).map(x => x.id));
const pa = ids(prev.assignments), pn = ids(prev.notices);
const newA = (cur.assignments || []).filter(x => !pa.has(x.id));
const newN = (cur.notices || []).filter(x => !pn.has(x.id));
// 이전 파일이 비정상(전부 새로움)이면 오발송 방지
if (!prev.assignments?.length && !prev.notices?.length) { console.log('prev empty → skip'); process.exit(0); }
if (!newA.length && !newN.length) { console.log('새 항목 없음'); process.exit(0); }

const fmtDue = d => { if (!d) return ''; const t = new Date(d); const k = new Date(t.getTime() + 9 * 3600e3); return ` (마감 ${k.getUTCMonth() + 1}/${k.getUTCDate()} ${String(k.getUTCHours()).padStart(2, '0')}:${String(k.getUTCMinutes()).padStart(2, '0')})`; };
const msgs = [];
for (const a of newA) msgs.push({ title: `📝 새 과제 · ${a.course}`, body: `${a.title}${fmtDue(a.due)}`, url: './index.html#lms', tag: 'a-' + a.id });
for (const n of newN) msgs.push({ title: `📢 공지 · ${n.course}`, body: `${n.title}${n.summary ? ' — ' + n.summary.slice(0, 80) : ''}`, url: './index.html#lms', tag: 'n-' + n.id });
console.log('보낼 알림', msgs.length, msgs.map(m => m.title));

const sa = JSON.parse(process.env.FIREBASE_SA || 'null');
if (!sa) { console.log('FIREBASE_SA 없음 → 발송 생략'); process.exit(0); }
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
webpush.setVapidDetails('mailto:kimjuham1120@gmail.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

const devs = await db.collectionGroup('devices').get();
console.log('기기', devs.size);
let ok = 0, fail = 0;
for (const d of devs.docs) {
  const dd = d.data(); if (dd.enabled === false) continue; const sub = dd.sub; if (!sub?.endpoint) continue;
  for (const m of msgs) {
    try { await webpush.sendNotification(sub, JSON.stringify(m), { TTL: 6 * 3600, urgency: 'high' }); ok++; }
    catch (e) {
      fail++; console.warn('push fail', d.ref.path, e.statusCode, e.body?.slice?.(0, 100));
      if (e.statusCode === 404 || e.statusCode === 410) { await d.ref.set({ enabled: false, gone: true, updatedAt: Date.now() }, { merge: true }); break; }
    }
  }
}
console.log(`발송 완료 ok=${ok} fail=${fail}`);
