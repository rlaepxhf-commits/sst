// SST ↔ GBE-AI Lab(가이랩) 수파베이스 연결
// 회장님 안내(2026-10-22, 10-27 답변)대로: 학급·학생·로그인은 가이랩 공용, SST 자료는 스키마 app_sst.
// - 가이랩 주소(https://gbe.ai.kr/apps/sst/)에서는 진짜 서버에 붙고, 선생님은 가이랩 Google 로그인을 그대로 쓴다.
// - 컴퓨터(http://localhost:5793)에서도 진짜 서버의 학생 로그인·명단 함수는 불러진다(선생님 Google 로그인은 안 됨).
// - 주소 끝에 ?mock 을 붙이면 서버를 흉내 내는 시험용 연결(이 브라우저에만 저장)로 화면을 점검할 수 있다.

const URL = 'https://wiaciazdsnhzgwplwjpu.supabase.co';
const KEY = 'sb_publishable_uYeQYITkob0HiEHUCaUZPA_w_1GXN_Q';   // 공개용 키 (화면에 넣어도 됨)
const MOCK = new URLSearchParams(location.search).has('mock');
const ON_GAILAB = location.hostname === 'gbe.ai.kr';

/* 서버가 보내는 짧은 오류 코드 → 화면에 보일 말 */
const ERR = {
  sst_not_enough: '잔액이 모자라요.',
  sst_tool_not_installed: '이 반에 담기지 않은 메뉴예요.',
  sst_not_training_tool: '훈련장 종목이 아니에요.',
  sst_student_only: '학생만 할 수 있어요.',
  sst_teacher_only: '선생님만 할 수 있어요.',
  sst_amount: '금액을 확인해 주세요.',
  sst_no_account: '아직 지갑 계좌가 없어요. 선생님께 알려 주세요.',
  wrong_code_number_or_pin: '반 코드, 번호, 비밀번호를 다시 확인해 주세요.',
  locked: '여러 번 틀려서 10분 동안 잠겼어요. 잠시 뒤 다시 해 보세요.',
  login_not_ready: '아직 로그인 준비가 안 됐어요. 선생님께 명단을 한 번 더 저장해 달라고 하세요.',
  bad_input: '반 코드 6자리, 번호, 숫자 4자리를 확인해 주세요.',
  auth_rate_limited: '지금 한꺼번에 많이 들어오고 있어요. 잠시 뒤 다시 해 보세요.',
  origin_not_allowed: '이 주소에서는 로그인할 수 없어요. gbe.ai.kr/apps/sst 로 들어와 주세요.',
};
function errText(e){
  const m = String((e && (e.code || e.message)) || e || '');
  for (const k in ERR) if (m.includes(k)) return ERR[k];
  if (/fetch|network/i.test(m)) return '인터넷 연결을 확인해 주세요.';
  return '요청을 처리하지 못했어요. 잠시 뒤 다시 해 보세요.';
}

const pad = n => String(n).padStart(2, '0');
function kstToday(){ const d = new Date(Date.now() + 9 * 3600e3); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`; }
const CTX = 'sst-student-ctx';
const getCtx = () => { try { return JSON.parse(localStorage.getItem(CTX)); } catch { return null; } };
const setCtx = v => { try { v ? localStorage.setItem(CTX, JSON.stringify(v)) : localStorage.removeItem(CTX); } catch {} };

/* ================= 진짜 서버 ================= */
async function liveApi(){
  let mod;
  try { mod = await import('/vendor/supabase.js'); }                    // 가이랩이 쓰는 것과 같은 파일 (회장님 요청)
  catch (e) {
    if (ON_GAILAB) throw e;                                              // 가이랩에서는 바깥 주소를 쓰지 않는다
    mod = await import('https://esm.sh/@supabase/supabase-js@2.45.4');  // 컴퓨터에서 시험할 때만
  }
  const auth = { flowType:'pkce', detectSessionInUrl:false, persistSession:true, autoRefreshToken:true };
  const teacherDb = mod.createClient(URL, KEY, { auth });                                   // 가이랩 로그인을 그대로 씀
  const studentDb = mod.createClient(URL, KEY, { auth:{ ...auth, storageKey:'gailab-app-student' } });   // 교사 로그인을 덮어쓰지 않게
  const sst = db => db.schema('app_sst');
  const ok = async p => { const { data, error } = await p; if (error) throw error; return data; };
  const call = async (body, token) => {
    const r = await fetch(URL + '/functions/v1/gailab-school', { method:'POST',
      headers:{ 'Content-Type':'application/json', apikey:KEY, ...(token ? { Authorization:'Bearer ' + token } : {}) },
      body: JSON.stringify(body) });
    let data = {}; try { data = await r.json(); } catch {}
    if (!r.ok) throw Object.assign(new Error(data.error || ('http_' + r.status)), { code:data.error });
    return data;
  };
  const dbOf = role => role === 'student' ? studentDb : teacherDb;
  let channel = null;

  return {
    mode:'live', errText, canTeacherLogin: ON_GAILAB,
    async whoami(){
      const ctx = getCtx();
      const ss = ctx ? (await studentDb.auth.getSession()).data.session : null;
      if (ss && ctx) return { role:'student', ctx };
      const s = (await teacherDb.auth.getSession()).data.session;
      if (s){ const u = s.user, md = u.user_metadata || {}; return { role:'teacher', user:{ id:u.id, name: md.display_name || md.full_name || (u.email || '').split('@')[0] || '선생님' } }; }
      return { role:null };
    },
    /* 가이랩 로그인 화면으로 보내고, 로그인을 마치면 SST 로 돌아온다 (회장님 v0.144.5) */
    teacherLogin(){ location.href = '/#/account?next=' + encodeURIComponent(location.pathname); },
    async listClasses(){
      const classes = await ok(teacherDb.from('gailab_school_classes').select('*'));
      const ids = classes.map(c => c.id);
      const apps = ids.length ? await ok(teacherDb.from('gailab_school_class_apps').select('*').in('class_id', ids)) : [];
      return classes.map(c => ({ id:c.id, name:c.name, year:c.school_year ?? c.year, code:c.join_code ?? c.code,
        sst: apps.some(a => a.class_id === c.id && a.app_id === 'sst') }));
    },
    async createClass(name, year, defaults){
      let row = await ok(teacherDb.rpc('gailab_school_create_class', { p_name:name, p_year:year }));
      if (Array.isArray(row)) row = row[0];
      const id = (row && typeof row === 'object') ? row.id : row;
      await this.enableSst(id, defaults);
      return id;
    },
    async enableSst(classId, defaults){
      const { error } = await teacherDb.from('gailab_school_class_apps').insert({ class_id:classId, app_id:'sst' });
      if (error && error.code !== '23505') throw error;                       // 이미 켜져 있으면 괜찮음
      // sync_accounts 가 설정 행(기본값)과 학생 계좌를 알아서 만든다. 여러 번 불러도 한 번만.
      await ok(sst(teacherDb).rpc('sync_accounts', { p_class:classId }));
    },
    async loadClass(classId, role){
      const db = dbOf(role), today = kstToday();
      const [cls, studs, pins, set, tools, accts, ledger, recs, rank] = await Promise.all([
        ok(db.from('gailab_school_classes').select('*').eq('id', classId).maybeSingle()),
        ok(db.from('gailab_school_students').select('*').eq('class_id', classId).order('number')),
        role === 'teacher' ? ok(db.from('gailab_school_pins').select('*').eq('class_id', classId)) : Promise.resolve([]),
        ok(sst(db).from('class_settings').select('*').eq('class_id', classId).maybeSingle()),
        ok(sst(db).from('class_tools').select('*').eq('class_id', classId)),
        ok(sst(db).from('wallet_accounts').select('*').eq('class_id', classId)),
        ok(sst(db).from('wallet_ledger').select('*').eq('class_id', classId).order('created_at', { ascending:false }).limit(60)),
        ok(sst(db).from('train_records').select('*').eq('class_id', classId).eq('day', today)),
        ok(sst(db).rpc('train_ranking', { p_class:classId })),
      ]);
      return { cls, studs, pins, settings: set ? set.settings : null, tools, accts, ledger, recs, rank: rank || [] };
    },
    async saveRoster(classId, rows){
      const s = (await teacherDb.auth.getSession()).data.session;
      await call({ action:'roster', class_id:classId, students:rows }, s && s.access_token);
      await ok(sst(teacherDb).rpc('sync_accounts', { p_class:classId }));
    },
    saveSettings: (classId, settings) => ok(sst(teacherDb).from('class_settings').upsert({ class_id:classId, settings }, { onConflict:'class_id' })),
    installTool: (classId, toolId, sort) => ok(sst(teacherDb).from('class_tools').insert({ class_id:classId, tool_id:toolId, sort })),
    removeTool:  (classId, toolId) => ok(sst(teacherDb).from('class_tools').delete().eq('class_id', classId).eq('tool_id', toolId)),
    setSize:     (classId, toolId, size) => ok(sst(teacherDb).from('class_tools').update({ size }).eq('class_id', classId).eq('tool_id', toolId)),
    teacherMove: (classId, ids, amount, memo, source) => ok(sst(teacherDb).rpc('wallet_teacher_move', { p_class:classId, p_students:ids, p_amount:amount, p_memo:memo, p_source:source })),
    studentSpend:(classId, amount, memo, source) => ok(sst(studentDb).rpc('wallet_student_spend', { p_class:classId, p_amount:amount, p_memo:memo, p_source:source })),
    trainComplete:(classId, tool, result) => ok(sst(studentDb).rpc('train_complete', { p_class:classId, p_tool:tool, p_result:result || {} })),
    async studentLogin(code, number, pin){
      code = String(code || '').trim().toUpperCase();                    // 소문자는 서버가 bad_input 으로 거절
      const s = await call({ action:'login', code, number:Number(number), pin:String(pin || '').trim() });
      await studentDb.auth.setSession({ access_token:s.access_token, refresh_token:s.refresh_token });
      // 응답에 class_id·student_id 가 들어 있다 (회장님 10-27 답변)
      setCtx({ class_id:s.class_id, student_id:s.student_id, number:Number(number), code });
      return getCtx();
    },
    async studentLogout(){ try { await studentDb.auth.signOut(); } catch {} setCtx(null); },
    /* 같은 반의 지갑·훈련장·담은 메뉴가 바뀌면 알려 준다 */
    subscribe(classId, role, onChange){
      if (channel){ channel.unsubscribe(); channel = null; }
      const db = dbOf(role), f = `class_id=eq.${classId}`;
      channel = db.channel('sst-' + classId);
      ['wallet_accounts', 'train_records', 'class_tools'].forEach(table =>
        channel.on('postgres_changes', { event:'*', schema:'app_sst', table, filter:f }, onChange));
      channel.subscribe();
    },
  };
}

/* ================= 시험용 흉내 서버 (?mock) =================
   진짜 서버의 규칙(돈은 함수로만·잔액 부족·담긴 도구만·훈련장 하루 한 번·하루 최대)을 흉내 낸다. */
function mockApi(){
  const KEYDB = 'sst-mock-db', KEYME = 'sst-mock-me';
  const read = () => { try { return JSON.parse(localStorage.getItem(KEYDB)) || null; } catch { return null; } };
  let db = read() || { classes:[], apps:[], students:[], pins:[], settings:{}, tools:[], accts:[], ledger:[], recs:[] };
  const save = () => { try { localStorage.setItem(KEYDB, JSON.stringify(db)); } catch {} };
  const me = () => { try { return JSON.parse(localStorage.getItem(KEYME)) || null; } catch { return null; } };
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  const wait = v => new Promise(r => setTimeout(() => r(v), 120));
  const apply = (sid, amt, memo, source) => {
    const a = db.accts.find(x => x.student_id === sid); if (!a) fail('sst_no_account');
    a.cash += amt; db.ledger.unshift({ id:uid(), class_id:a.class_id, student_id:sid, amount:amt, balance_after:a.cash, memo, source, created_at:new Date().toISOString() });
  };
  const sync = cid => { const set = db.settings[cid] || {}; const start = (set.wallet && set.wallet.start) || 0;
    db.students.filter(s => s.class_id === cid && !db.accts.some(a => a.student_id === s.id)).forEach(s => {
      db.accts.push({ student_id:s.id, class_id:cid, cash:0, saving:0 }); if (start) apply(s.id, start, '처음 나눠 준 ' + ((set.wallet && set.wallet.unit) || '코인'), 'wallet'); }); };
  const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return {
    mode:'mock', errText, canTeacherLogin:true,
    async whoami(){ const m = me(); if (m && m.role === 'student' && getCtx()) return wait({ role:'student', ctx:getCtx() });
      if (m && m.role === 'teacher') return wait({ role:'teacher', user:{ id:'mock-teacher', name:'시험' } }); return wait({ role:null }); },
    teacherLogin(){ localStorage.setItem(KEYME, JSON.stringify({ role:'teacher' })); location.reload(); },
    async listClasses(){ return wait(db.classes.map(c => ({ id:c.id, name:c.name, year:c.school_year, code:c.join_code, sst: db.apps.some(a => a.class_id === c.id && a.app_id === 'sst') }))); },
    async createClass(name, year, defaults){ let code; do { code = Array.from({ length:6 }, () => ABC[Math.floor(Math.random() * ABC.length)]).join(''); } while (db.classes.some(c => c.join_code === code));
      const id = uid(); db.classes.push({ id, name, school_year:year, join_code:code }); save(); await this.enableSst(id, defaults); return id; },
    async enableSst(cid, defaults){ if (!db.apps.some(a => a.class_id === cid && a.app_id === 'sst')) db.apps.push({ class_id:cid, app_id:'sst' }); if (!db.settings[cid]) db.settings[cid] = defaults; sync(cid); save(); return wait(); },
    async loadClass(cid, role){ const today = kstToday(), mine = role === 'student' ? (db.students.find(s => s.class_id === cid && s.number === (getCtx() || {}).number) || {}).id : null;
      const own = r => role !== 'student' || r.student_id === mine;
      const rankMap = {}; db.recs.filter(r => r.class_id === cid).forEach(r => { rankMap[r.student_id] = (rankMap[r.student_id] || 0) + 1; });
      return wait(JSON.parse(JSON.stringify({ cls: db.classes.find(c => c.id === cid), studs: db.students.filter(s => s.class_id === cid).sort((a, b) => a.number - b.number),
        pins: role === 'teacher' ? db.pins.filter(p => p.class_id === cid) : [], settings: db.settings[cid] || null,
        tools: db.tools.filter(t => t.class_id === cid), accts: db.accts.filter(a => a.class_id === cid && own(a)),
        ledger: db.ledger.filter(l => l.class_id === cid && own(l)).slice(0, 60), recs: db.recs.filter(r => r.class_id === cid && r.day === today && own(r)),
        rank: Object.entries(rankMap).map(([sid, n]) => { const s = db.students.find(x => x.id === sid); return { student_id:sid, number:s.number, nickname:s.nickname, done_count:n }; }) }))); },
    async saveRoster(cid, rows){ rows.forEach(r => { let s = db.students.find(x => x.class_id === cid && x.number === r.number);
        if (!s){ s = { id:uid(), class_id:cid, number:r.number, nickname:r.nickname || null, active:r.active !== false }; db.students.push(s); }
        else { s.nickname = r.nickname || null; s.active = r.active !== false; }
        const p = db.pins.find(x => x.student_id === s.id); if (p) p.pin = r.pin; else db.pins.push({ student_id:s.id, class_id:cid, pin:r.pin }); });
      sync(cid); save(); return wait(); },
    async saveSettings(cid, settings){ db.settings[cid] = settings; save(); return wait(); },
    async installTool(cid, tid, sort){ if (!db.tools.some(t => t.class_id === cid && t.tool_id === tid)) db.tools.push({ class_id:cid, tool_id:tid, size:1, sort, installed_at:new Date().toISOString() }); save(); return wait(); },
    async removeTool(cid, tid){ db.tools = db.tools.filter(t => !(t.class_id === cid && t.tool_id === tid)); save(); return wait(); },
    async setSize(cid, tid, size){ const t = db.tools.find(x => x.class_id === cid && x.tool_id === tid); if (t) t.size = size; save(); return wait(); },
    async teacherMove(cid, ids, amt, memo, source){ if ((me() || {}).role !== 'teacher') fail('sst_teacher_only'); if (!amt) fail('sst_amount'); ids.forEach(id => apply(id, amt, memo, source)); save(); return wait(ids.length); },
    async studentSpend(cid, amt, memo, source){ const ctx = getCtx(); if ((me() || {}).role !== 'student' || !ctx) fail('sst_student_only'); if (!(amt > 0)) fail('sst_amount');
      if (!db.tools.some(t => t.class_id === cid && t.tool_id === source)) fail('sst_tool_not_installed');
      const s = db.students.find(x => x.class_id === cid && x.number === ctx.number), a = db.accts.find(x => x.student_id === s.id); if (a.cash < amt) fail('sst_not_enough');
      apply(s.id, -amt, memo, source); save(); return wait(a.cash); },
    async trainComplete(cid, tool){ const ctx = getCtx(); if ((me() || {}).role !== 'student' || !ctx) fail('sst_student_only');
      if (!db.tools.some(t => t.class_id === cid && t.tool_id === tool)) fail('sst_not_training_tool');
      const s = db.students.find(x => x.class_id === cid && x.number === ctx.number), d = kstToday();
      if (db.recs.some(r => r.student_id === s.id && r.tool_id === tool && r.day === d)) return wait({ ok:true, already:true, reward:0 });
      const t = (db.settings[cid] || {}).train || {}, paid = db.recs.filter(r => r.student_id === s.id && r.day === d).reduce((x, r) => x + r.reward_paid, 0);
      const give = Math.max(0, Math.min(t.reward ?? 10, (t.dailyMax ?? 50) - paid));
      db.recs.push({ class_id:cid, student_id:s.id, tool_id:tool, day:d, reward_paid:give });
      if (give) apply(s.id, give, '훈련장 · ' + tool, 'hub'); save(); return wait({ ok:true, already:false, reward:give }); },
    async studentLogin(code, number, pin){ const c = db.classes.find(x => x.join_code === code); const s = c && db.students.find(x => x.class_id === c.id && x.number === number && x.active !== false);
      const p = s && db.pins.find(x => x.student_id === s.id); if (!p || p.pin !== pin) fail('wrong_code_number_or_pin');
      localStorage.setItem(KEYME, JSON.stringify({ role:'student' })); setCtx({ class_id:c.id, number, code }); return wait(getCtx()); },
    async studentLogout(){ localStorage.setItem(KEYME, JSON.stringify({ role:'teacher' })); setCtx(null); return wait(); },
    subscribe(){},
  };
}

let api = null;
try { api = MOCK ? mockApi() : await liveApi(); }
catch (e) { console.error('SST 서버 연결 준비 실패', e); }
window.SST.boot(api);
