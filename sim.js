// 한 번의 플레이를 시뮬레이션한다. 선수(바둑돌)마다 스스로 움직이고, 결과는 그 과정에서 정해진다.
// 방장만 계산하고, 결과는 "녹화"(프레임 목록 + 사건 목록)로 손님에게 보내 둘 다 똑같이 재생한다.
// 좌표: x = 공격팀 엔드존 쪽 0 → 상대 엔드존 100 (엔드존 안쪽은 0 밑, 100 위). y = 사이드라인 0 ~ 53.3.

const FIELD_W = 53.3, MID = FIELD_W / 2, DT = 1 / 60, FRAME = 0.05, MAX_T = 20;
const OFFK = ['qb', 'rb', 'wr1', 'wr2', 'wr3', 'te', 'ol0', 'ol1', 'ol2', 'ol3', 'ol4'];
const DEFK = ['dl0', 'dl1', 'dl2', 'dl3', 'lb0', 'lb1', 'lb2', 'cb0', 'cb1', 's0', 's1'];

function mulberry(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
let DBG = null;
const hyp = Math.hypot, clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function simulatePlay(o) {
  const R = mulberry(o.seed || 1), rnd = () => R();
  const gauss = () => (rnd() + rnd() + rnd() - 1.5) / 0.5;
  const L = o.los, op = o.offPlay, dp = o.defPlay, gamble = !!dp.gamble;
  const S = { t: 0, P: [], ball: null, carrier: null, over: false, result: null, events: [], frames: [], smT: 0, sm: 1, throwDone: false };
  const P = S.P, K = {};

  // ---------- 선수 만들기 ----------
  const mk = (team, key, st, x, y) => {
    const n = v => (v || 0) / 99;
    const e = {
      team, key, pos: st.pos, x, y, vx: 0, vy: 0,
      spd: 4.8 + st.spd * 0.05, str: n(st.str), agi: n(st.agi),
      acc: n(st.acc), poise: n(st.poise), sec: n(st.sec), vis: n(st.vis), hands: n(st.hands), route: n(st.route),
      blk: n(st.blk), anchor: n(st.anchor), rush: n(st.rush), tkl: n(st.tkl), react: n(st.react), ballsk: n(st.ballsk), cover: n(st.cover),
      mode: 'idle', tgt: null, eng: null, engT: 0, stun: 0, tcd: 0, jk: false, cd: 0, wait: 0,
    };
    if (!st.tkl) e.tkl = clamp(e.str * 0.45 + e.agi * 0.25 + 0.2, 0, 1);
    if (!st.hands) e.hands = st.pos === 'RB' ? 0.62 : 0.3;
    if (!st.react) e.react = st.cover ? e.cover * 0.8 : 0.55;
    P.push(e); K[key] = e; return e;
  };
  const maxX = 109.5;
  const off = o.offTeam.off, def = o.defTeam.def;
  const ofs = {
    qb: [L - 1, MID], rb: [L - 6, MID], wr1: [L - 0.8, 6], wr2: [L - 0.8, FIELD_W - 6], wr3: [L - 1.5, 13], te: [L - 0.8, MID + 5.5],
    ol0: [L - 0.8, MID - 4], ol1: [L - 0.8, MID - 2], ol2: [L - 0.8, MID], ol3: [L - 0.8, MID + 2], ol4: [L - 0.8, MID + 4],
  };
  OFFK.forEach((k, i) => mk('o', k, off[i], ofs[k][0], ofs[k][1]));
  DEFK.forEach((k, i) => {
    let x, y;
    if (k.startsWith('dl')) { x = L + 1; y = MID + [-3, -1, 1, 3][+k[2]]; }
    else if (k === 'cb0') { x = L + dp.at.cb0[0]; y = K.wr1.y; }
    else if (k === 'cb1') { x = L + dp.at.cb1[0]; y = K.wr2.y; }
    else { x = L + dp.at[k][0]; y = MID + dp.at[k][1]; }
    mk('d', k, def[i], Math.min(maxX, x), y);
  });
  const team = t => P.filter(e => e.team === t);
  const foes = e => P.filter(f => f.team !== e.team);

  // ---------- 역할 정하기 ----------
  const isRun = op.kind === 'run';
  const ev = (s, e, slow) => S.events.push({ t: +S.t.toFixed(2), s, x: e.x, y: e.y, slow: !!slow });
  S.ball = { mode: 'held', holder: K.qb };
  S.carrier = K.qb;
  const laneY = MID + (op.lane || 0);

  if (isRun) {
    K.qb.mode = 'handoff';
    K.rb.mode = 'mesh';
    [['ol0', 'dl0'], ['ol1', 'dl1'], ['ol2', 'lb1'], ['ol3', 'dl2'], ['ol4', 'dl3'], ['te', 'lb2'], ['wr1', 'cb0'], ['wr2', 'cb1'], ['wr3', 's0']]
      .forEach(([a, b]) => { K[a].mode = 'block'; K[a].tgt = K[b]; });
  } else {
    K.qb.mode = 'drop';
    [['ol0', 'dl0'], ['ol1', 'dl1'], ['ol3', 'dl2'], ['ol4', 'dl3']].forEach(([a, b]) => { K[a].mode = 'pblock'; K[a].tgt = K[b]; });
    K.ol2.mode = 'pblock';
    for (const k of ['wr1', 'wr2', 'wr3', 'te', 'rb']) {
      const r = op.routes[k], e = K[k];
      if (r === 'block') e.mode = 'pblock';
      else if (r === 'fake') { e.mode = 'fake'; }
      else if (r) { e.mode = 'route'; e.way = r.map(([dx, dy]) => [Math.min(maxX - 0.5, e.x + dx), clamp(e.y + dy, 1.5, FIELD_W - 1.5)]); e.wi = 0; }
    }
  }
  // 수비
  const rushers = new Set(['dl0', 'dl1', 'dl2', 'dl3', ...(dp.rush || [])]);
  for (const k of DEFK) {
    const e = K[k];
    if (rushers.has(k)) { e.mode = 'rush'; continue; }
    if (dp.man && dp.man[k]) { e.mode = 'man'; e.man = K[dp.man[k]]; }
    else if (dp.zone && dp.zone[k]) { e.mode = 'zone'; e.zp = [L + dp.zone[k][0], clamp(MID + dp.zone[k][1], 2, FIELD_W - 2)]; }
    else { e.mode = 'zone'; e.zp = [e.x + 4, e.y]; }
    e.zp && (e.zp[0] = Math.min(maxX, e.zp[0]));
    // 달리기를 알아채는 시간: 작전(runRead)이 느릴수록, 반응이 낮을수록 늦다
    e.read = dp.runRead * (1.25 - e.react * 0.5) + (k.startsWith('cb') ? 0.4 : 0);
    if (op.fake && dp.id !== 'zone' && (k.startsWith('lb') || k === 's0')) e.bite = (dp.id === 'run_d' ? 1.3 : 0.9) * (1.3 - e.react * 0.5);
  }

  if (!isRun) for (const [dk, rk] of Object.entries(dp.man || {})) {
    const d = K[dk], r = K[rk];
    if (dp.cushion < 1.6 && r.mode === 'route' && hyp(d.x - r.x, d.y - r.y) < 3) r.wait = clamp(0.15 + (d.cover - r.route) * 0.8 + rnd() * 0.25, 0.05, 0.6);
  }

  // ---------- 움직임 도우미 ----------
  function mv(e, tx, ty, spd, acc) {
    const dx = tx - e.x, dy = ty - e.y, d = hyp(dx, dy);
    let sx = 0, sy = 0;
    if (d > 0.05) { const s = Math.min(spd, d * 4); sx = dx / d * s; sy = dy / d * s; }
    const k = Math.min(1, acc * DT);
    e.vx += (sx - e.vx) * k; e.vy += (sy - e.vy) * k;
  }
  const near = (e, list, maxD) => { let b = null, bd = maxD; for (const f of list) { const d = hyp(f.x - e.x, f.y - e.y); if (d < bd) { bd = d; b = f; } } return b; };
  const ramp = () => Math.min(1, 0.55 + S.t * 0.6);

  // 공을 든 선수: 주변 위협을 보고 가장 좋은 방향을 고른다
  function carrierAI(c) {
    const dir = c.team === 'o' ? 1 : -1;
    const la = 2.5 + c.vis * 1.5, v = hyp(c.vx, c.vy) || 1;
    let best = -1e9, bx = dir, by = 0;
    const threats = foes(c);
    for (let a = -80; a <= 80; a += 10) {
      const r = a * Math.PI / 180, dx = Math.cos(r) * dir, dy = Math.sin(r), px = c.x + dx * la, py = c.y + dy * la;
      let s = dx * dir * 1.2 + 0.3 * (dx * c.vx + dy * c.vy) / v;
      for (const d of threats) {
        const w = d.eng ? 0.25 : (d.stun > 0 ? 0.3 : 1), q = Math.max(0, 1 - hyp(px - d.x, py - d.y) / (3.5 + c.vis * 2));
        s -= w * q * q * 2.5;
      }
      if (py < 2.5) s -= (2.5 - py) * 0.9;
      if (py > FIELD_W - 2.5) s -= (py - FIELD_W + 2.5) * 0.9;
      if (c.key === 'rb' && c.team === 'o' && S.t < 1.3 && isRun) s -= Math.abs(py - laneY) * 0.07;
      if (s > best) { best = s; bx = dx; by = dy; }
    }
    const spd = c.spd * 0.92 * ramp() * (S.smT > 0 ? S.sm : 1);   // 공을 들면 조금 느려진다
    mv(c, c.x + bx * 3, c.y + by * 3, spd, 3 + c.agi * 7);
  }
  function pursue(d, tgt, mul = 1) {
    const dist = hyp(tgt.x - d.x, tgt.y - d.y), ld = Math.min(1.2, dist / d.spd);
    mv(d, tgt.x + tgt.vx * ld, tgt.y + tgt.vy * ld, d.spd * ramp() * mul, 6);
  }
  // 블로킹: 맡은 상대(없으면 공 든 선수에게 가까운 상대)와 공 든 선수 사이로 끼어든다
  function blockAI(b, pass) {
    if (b.eng) {
      const d = b.eng, aim = pass ? K.qb : (S.carrier || K.qb), dx = aim.x - d.x, dy = aim.y - d.y, l = hyp(dx, dy) || 1;
      b.x += (d.x + dx / l * 0.9 - b.x) * 0.3; b.y += (d.y + dy / l * 0.9 - b.y) * 0.3; b.vx = d.vx; b.vy = d.vy; return;
    }
    b.cd -= DT;
    if (b.tgt && (b.tgt.eng && b.tgt.eng !== b || b.tgt === S.carrier)) b.tgt = null;
    if (!b.tgt && b.cd <= 0) {
      const pool = foes(b).filter(f => !f.eng && f !== S.carrier && (!pass || f.mode === 'rush'));
      b.tgt = near(b, pool, pass ? 7 : 8);
    }
    const d = b.tgt, aim = pass ? K.qb : (S.carrier || K.qb);
    if (d) {
      const dx = aim.x - d.x, dy = aim.y - d.y, l = hyp(dx, dy) || 1;
      mv(b, d.x + dx / l * 0.8, d.y + dy / l * 0.8, b.spd, 8);
      if (hyp(b.x - d.x, b.y - d.y) < 1.1 && !d.eng && d.stun <= 0) {
        const power = 0.6 + (b.blk || b.str * 0.6) * 0.6 + (b.anchor || 0) * 0.3;
        const beat = 0.6 + (d.pos === 'DL' ? d.rush * 0.6 + d.anchor * 0.3 : d.str * 0.7);
        d.eng = b; b.eng = d; d.engT = (0.4 + rnd() * 1.5) * power / beat * (d.pos === 'DL' ? 1.15 : 0.75);
      }
    } else if (pass) { mv(b, K.qb.x + 1.5, b.y + (K.qb.y - b.y) * 0.1, 3, 5); }
    else { b.vx *= 0.95; b.vy *= 0.95; }
  }
  function shed(d) {
    if (!d.eng) return false;
    d.engT -= DT;
    if (d.engT > 0) { const aim = S.ball.mode === 'held' ? S.ball.holder : (S.ball.mode === 'air' ? { x: S.ball.tx, y: S.ball.ty } : K.qb); mv(d, aim.x, aim.y, d.spd * 0.12, 6); return true; }
    const b = d.eng; d.eng = null; b.eng = null; b.tgt = null; b.cd = 0.7; d.stun = 0.15; return false;
  }

  // ---------- 태클·제치기·펌블 ----------
  function contact(c) {
    for (const d of foes(c)) {
      if (d.eng || d.stun > 0) continue;
      const q = hyp(c.x - d.x, c.y - d.y);
      if (q > 4) d.jk = false;
      const closing = (d.vx - c.vx) * (c.x - d.x) + (d.vy - c.vy) * (c.y - d.y) > 0;
      if (!d.jk && q < 2.2 && q > 0.9 && closing && S.t > 0.5) {
        d.jk = true;
        if (rnd() < 0.08 + c.agi * 0.35 - d.agi * 0.2) {
          let nx = -(c.y - d.y) / q, ny = (c.x - d.x) / q;
          if (c.y + ny * 3 < 1 || c.y + ny * 3 > FIELD_W - 1 || (rnd() < 0.5)) { nx = -nx; ny = -ny; }
          if (c.y + ny * 3 < 1 || c.y + ny * 3 > FIELD_W - 1) { nx = -nx; ny = -ny; }
          c.vx = c.vx * 0.5 + nx * c.spd * 0.9; c.vy = c.vy * 0.3 + ny * c.spd * 0.9;
          d.stun = 1; d.vx += (c.x - d.x) / q * 3; d.vy += (c.y - d.y) / q * 3;
          ev('제쳤다!', c, true);
        }
      }
      if (q > 2.5) d.dv = false;
      if (!d.dv && q < 1.7 && q > 0.85 && d.tcd <= 0 && S.t > 0.5) {   // 몸을 날려 잡기
        d.dv = true;
        if (rnd() < 0.15 + d.tkl * 0.45) { tackle(c, d, 0.15); if (S.over || S.ball.mode === 'loose') return; continue; }
      }
      if (q < 0.85 && d.tcd <= 0) { tackle(c, d, 0); if (S.over || S.ball.mode === 'loose') return; }
    }
  }
  function tackle(c, d, harder) {
    d.tcd = 1;
    const help = foes(c).filter(f => f !== d && !f.eng && f.stun <= 0 && hyp(f.x - c.x, f.y - c.y) < 1.8).length;
    const pF = (gamble ? 0.09 : 0.022) * (1.5 - c.sec * (c.pos === 'RB' ? 1 : 0.6)) * (help ? 1.4 : 1);
    if (rnd() < pF) { fumble(c); return; }
    let pB = 0.05 + c.str * 0.45 - d.tkl * 0.35 + (gamble ? 0.12 : 0) + harder;
    if (c.pos === 'QB') pB *= 0.5;
    if (help) pB *= 0.35;
    pB = clamp(pB, 0.03, 0.8);
    if (rnd() < pB) {
      d.stun = harder ? 1.6 : 1.3; d.vx *= -0.3; d.vy *= -0.3; S.sm = 0.6; S.smT = 0.45;
      ev('태클 뿌리치기!', c, true);
    } else {
      const dir = c.team === 'o' ? 1 : -1;
      if (c.str > 0.8) c.x += dir * 1.2;
      ev(help ? '덮쳤다!' : (harder ? '몸 날려 잡았다!' : '태클!'), c, !!harder && c.x - L > 8);
      endPlay('down');
    }
  }
  function fumble(c) {
    const a = rnd() * Math.PI * 2, s = 5 + rnd() * 3;
    S.ball = { mode: 'loose', x: c.x, y: c.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, bt: 0, lt: 0, last: c.team };
    S.carrier = null;
    for (const e of P) { e.eng = null; e.tgt = null; e.stun = rnd() * 0.35; e.mode = 'loose'; }
    ev('펌블!', c, true);
  }
  function giveBall(e, why) {
    S.ball = { mode: 'held', holder: e };
    S.carrier = e;
    e.mode = 'carry';
    for (const f of P) {
      if (f === e) continue;
      f.eng = null; f.tgt = null;
      if (f.team === e.team) { f.mode = 'block'; f.cd = 0.2; }
      else { f.mode = 'pursue'; f.wait = why === 'catch' ? 0.15 + (1 - f.react) * 0.3 : 0.2; }
      f.tcd = Math.max(f.tcd, 0.4);
    }
  }

  // ---------- 패스 ----------
  function sep(r) { let m = 9; for (const d of team('d')) if (!d.eng) m = Math.min(m, hyp(d.x - r.x, d.y - r.y)); return m; }
  function pressured() { const r = near(K.qb, team('d').filter(d => !d.eng && d.stun <= 0), 3.2); return !!r; }
  function chooseTarget() {
    let best = null, bs = -1e9;
    op.targets.forEach((k, i) => {
      const r = K[k];
      if (r.mode !== 'route') return;
      const s = Math.min(sep(r), 5) * 1.3 + [1.0, 0.6, 0.3][i] + (r.x - L) * 0.03 + rnd() * (1.6 - K.qb.poise);
      if (s > bs) { bs = s; best = r; }
    });
    return { r: best, sep: best ? sep(best) : 0 };
  }
  function throwBall(r, press) {
    const qb = K.qb, bs = 17 + qb.acc * 6;
    let px = r.x, py = r.y, T = 0.5;
    for (let i = 0; i < 3; i++) { T = Math.max(0.35, hyp(px - qb.x, py - qb.y) / bs); px = r.x + r.vx * T; py = r.y + r.vy * T; }
    const sig = (0.35 + (1 - qb.acc) * 1.8 + (press ? (1 - qb.poise) * 1.6 : 0)) * (0.5 + hyp(px - qb.x, py - qb.y) / 18);
    px = Math.min(maxX, px + gauss() * sig); py = clamp(py + gauss() * sig, 0.3, FIELD_W - 0.3);
    if (DBG) DBG.push(r.key + (press ? '!' : ''));
    S.ball = { mode: 'air', fx: qb.x, fy: qb.y, tx: px, ty: py, t0: S.t, T, h: Math.min(9, hyp(px - qb.x, py - qb.y) * 0.18), r };
    S.carrier = null; S.throwDone = true;
    r.mode = 'catch';
    for (const d of team('d')) {
      if (d.mode === 'rush' || d.eng) continue;
      const reach = hyp(d.x - px, d.y - py) / d.spd;
      d.mode = reach < T + 0.25 ? 'ballhawk' : 'pursueBall';
      d.wait = 0.4 - d.ballsk * 0.25;
    }
  }
  function resolveCatch() {
    const b = S.ball, r = b.r, P2 = { x: b.tx, y: b.ty };
    const dr = hyp(r.x - P2.x, r.y - P2.y);
    let dd = null, dD = 9;
    for (const d of team('d')) { const q = hyp(d.x - P2.x, d.y - P2.y); if (q < dD) { dD = q; dd = d; } }
    const intMul = gamble ? 1.9 : 1;
    const deep = P2.x - L > 15;
    if (P2.x > 110 || P2.y < 0 || P2.y > FIELD_W) { ev('밖으로 날아갔어요', P2, false); return endPlay('inc'); }
    if (dr > 1.6) {
      if (dd && dD < 1.2 && rnd() < dd.ballsk * 0.15 * intMul) { ev('가로채기!', dd, true); dd.x = P2.x; dd.y = P2.y; giveBall(dd, 'int'); S.int = true; return; }
      ev(dr > 4 ? '빗나갔어요' : '못 닿았어요', P2, false); return endPlay('inc');
    }
    const contested = dD < 1.1;
    if (contested && rnd() < dd.ballsk * 0.08 * intMul) { ev('가로채기!', dd, true); dd.x = P2.x; dd.y = P2.y; giveBall(dd, 'int'); S.int = true; return; }
    const pC = clamp(0.62 + r.hands * 0.33 - (contested ? 0.15 + dd.cover * 0.2 : 0) - dr * 0.08 - Math.max(0, P2.x - L - 20) * 0.015, 0.15, 0.97);
    if (rnd() < pC) {
      r.x = P2.x; r.y = P2.y;
      ev(contested ? '어렵게 잡았다!' : (deep ? '잡았다!' : '패스 성공'), r, contested || deep);
      giveBall(r, 'catch');
      if (contested && dD < 1.1) { dd.wait = 0; dd.tcd = 0; tackle(r, dd, 0.05); }
    } else { ev(contested ? '쳐냈다!' : '놓쳤어요', r, contested); endPlay('inc'); }
  }

  // ---------- 끝내기 ----------
  function endPlay(why) {
    if (S.over) return;
    S.over = true;
    const c = S.carrier;
    if (!c && S.ball.mode === 'air') why = 'inc';
    const res = { inc: why === 'inc', int: !!S.int, fumbleLost: !!S.fumLost, sack: false, score: null, possession: 'o', spot: L };
    if (why === 'inc') { res.spot = L; }
    else {
      const holder = c || { x: S.ball.x, y: S.ball.y, team: S.ball.last };
      res.possession = holder.team;
      res.spot = holder.x;
      if (holder.team === 'o') {
        if (holder.x >= 100) res.score = 'td';
        else if (holder.x <= 0) res.score = 'safety';
        else if (!S.throwDone && holder === K.qb && !isRun && holder.x < L) res.sack = true;
      } else if (holder.x <= 0) res.score = 'def_td';
    }
    res.spot = Math.round(clamp(res.spot, -10, 110)) + 0;
    S.result = res;
  }

  // ---------- 한 칸 진행 ----------
  function step() {
    S.t += DT; S.smT -= DT;
    const b = S.ball;
    for (const e of P) { e.tcd -= DT; }

    if (b.mode === 'loose') { stepLoose(); return integrate(); }

    for (const e of P) {
      if (e === S.carrier && e.mode !== 'handoff' && e.mode !== 'drop' && e.mode !== 'set') { carrierAI(e); continue; }
      if (e.stun > 0) { e.stun -= DT; e.vx *= Math.pow(0.25, DT); e.vy *= Math.pow(0.25, DT); continue; }
      if (e.wait > 0) { e.wait -= DT; e.vx *= 0.9; e.vy *= 0.9; continue; }
      switch (e.mode) {
        case 'handoff': {   // 쿼터백이 뒤로 돌아 공을 건넨다
          mv(e, L - 3, MID - 0.8, 4, 8);
          if (S.t > 0.42 && S.carrier === e) { S.ball = { mode: 'held', holder: K.rb }; S.carrier = K.rb; K.rb.mode = 'carry'; e.mode = 'idle'; for (const d of team('d')) if (d.mode !== 'rush') d.mode = 'readRun'; }
          break;
        }
        case 'mesh': mv(e, L - 3, MID + (op.lane ? 1.5 : 0), e.spd, 8); break;
        case 'drop': {
          const tx = L - 1 - op.drop;
          mv(e, tx, MID, 5.5, 8);
          if (e.x <= tx + 0.3 || S.t > op.drop / 5 + 0.3) e.mode = 'set';
          qbThink(e); break;
        }
        case 'set': {
          const r = near(e, team('d').filter(d => !d.eng && d.mode === 'rush'), 3.5);
          if (r) mv(e, e.x - 0.3, e.y + (e.y > r.y ? 1.5 : -1.5), 3, 4); else { e.vx *= 0.85; e.vy *= 0.85; }
          qbThink(e); break;
        }
        case 'fake': {
          if (S.t < 0.75) mv(e, L + 0.5, MID + 1, e.spd * 0.8, 8);
          else { e.mode = 'pblock'; }
          break;
        }
        case 'route': {
          const w = e.way[e.wi];
          if (w) {
            mv(e, w[0], w[1], e.spd * ramp(), 4 + e.route * 8);
            if (hyp(w[0] - e.x, w[1] - e.y) < 1) e.wi++;
          } else {
            const last = e.way[e.way.length - 1], prev = e.way[e.way.length - 2] || [e.x - 1, e.y];
            const dx = last[0] - prev[0], dy = last[1] - prev[1], l = hyp(dx, dy) || 1;
            let ty = e.y + dy / l * 3; ty = clamp(ty, 1.5, FIELD_W - 1.5);
            mv(e, Math.min(maxX, e.x + dx / l * 3), ty, e.spd * ramp(), 6);
          }
          break;
        }
        case 'catch': mv(e, b.tx, b.ty, e.spd, 8); break;
        case 'pblock': blockAI(e, true); break;
        case 'block': blockAI(e, false); break;
        case 'rush': {
          if (shed(e)) break;
          if (b.mode === 'held' && b.holder === K.qb) pursue(e, K.qb, 0.95);
          else if (b.mode === 'held') pursue(e, S.carrier);
          else if (b.mode === 'air') mv(e, b.tx, b.ty, e.spd * 0.6, 4);
          break;
        }
        case 'man': {
          if (shed(e)) break;
          if (e.bite > 0) { e.bite -= DT; mv(e, L + 1, MID + (e.y - MID) * 0.6, e.spd * 0.8, 6); break; }
          const r = e.man;
          if (r.mode === 'pblock' || r.mode === 'fake' || r.mode === 'block') { mv(e, Math.max(L + 2, e.x), K.qb.y + (e.y - K.qb.y) * 0.8, 3, 4); break; }
          const cush = dp.cushion * Math.max(0, 1 - S.t / 2.5);
          mv(e, r.x + r.vx * 0.3 + cush, r.y + r.vy * 0.2, e.spd * ramp(), 3 + e.cover * 6);
          break;
        }
        case 'zone': {
          if (shed(e)) break;
          if (e.bite > 0) { e.bite -= DT; mv(e, L + 1, MID + (e.y - MID) * 0.6, e.spd * 0.8, 6); break; }
          let tx = e.zp[0], ty = e.zp[1];
          const deep = e.zp[0] - L >= 14;   // 깊은 지역은 지나가는 리시버보다 늘 뒤(더 깊이)에 선다
          const rad = deep ? 13 + e.cover * 5 : 7 + e.cover * 3, inZone = team('o').filter(f => f.mode === 'route' && hyp(f.x - tx, f.y - ty) < rad);
          const r = deep ? inZone.sort((a, b2) => b2.x - a.x)[0] : near({ x: tx, y: ty }, inZone, rad);   // 깊은 수비는 가장 깊이 들어온 리시버를 본다
          if (r && deep) { tx = Math.max(tx, r.x + 2.5); ty += (r.y - ty) * 0.7; }
          else if (r) { tx += (r.x - tx) * 0.65; ty += (r.y - ty) * 0.65; }
          mv(e, tx, ty, e.spd * ramp(), 4 + e.cover * 4);
          break;
        }
        case 'readRun': {  // 달리기를 알아챌 때까지는 원래 자리, 그다음 공 든 선수를 쫓는다
          if (shed(e)) break;
          e.read -= DT;
          if (e.read > 0) {
            if (e.man && e.man.mode !== 'carry') mv(e, e.man.x + 1.5, e.man.y, e.spd * 0.7, 5);
            else if (e.zp) mv(e, e.zp[0], e.zp[1], e.spd * 0.6, 4);
            break;
          }
          pursue(e, S.carrier); break;
        }
        case 'ballhawk': if (b.mode === 'air') mv(e, b.tx, b.ty, e.spd, 7); else e.mode = 'pursue'; break;
        case 'pursueBall': if (b.mode === 'air') mv(e, Math.min(maxX, b.tx + 5), b.ty, e.spd * 0.9, 5); else e.mode = 'pursue'; break;   // 공 떨어질 곳 앞을 막는다
        case 'pursue': if (S.carrier) { if (!shed(e)) pursue(e, S.carrier); } break;
        default: e.vx *= 0.92; e.vy *= 0.92;
      }
    }
    integrate();
    if (b.mode === 'air' && S.t - b.t0 >= b.T) resolveCatch();
    const c = S.carrier;
    if (!S.over && c && S.ball.mode === 'held') {
      if (!(isRun && S.t < 0.45) || c !== K.qb) contact(c);
      if (S.over || S.ball.mode !== 'held') return;
      if (c.team === 'o' && c.x >= 100) { ev('터치다운!', c, true); endPlay('td'); }
      else if (c.team === 'd' && c.x <= 0) { ev('가로채서 터치다운!', c, true); endPlay('td'); }
      else if (c.y < 0 || c.y > FIELD_W) { ev('밖으로 나갔어요', c, false); endPlay('out'); }
    }
    if (!S.over && S.t > MAX_T) endPlay('time');
  }
  function qbThink(qb) {
    if (S.ball.mode !== 'held' || S.ball.holder !== qb || S.t < 0.45) return;
    const press = pressured();
    const late = S.t >= op.throwT;
    const panic = press && rnd() < ((1 - qb.poise) * 0.2 + 0.08);
    if (!late && !panic) return;
    const { r, sep: sp } = chooseTarget();
    if (!r) return;
    if (late && !press && sp < 1.3 && S.t < op.throwT + 0.9 && rnd() < qb.poise * 0.08) return;  // 침착하면 빈 사람이 생길 때까지 기다린다
    throwBall(r, press);
  }
  function stepLoose() {
    const b = S.ball;
    b.lt += DT; b.x += b.vx * DT; b.y += b.vy * DT; b.vx *= Math.pow(0.35, DT); b.vy *= Math.pow(0.35, DT); b.bt += DT;
    const sp = hyp(b.vx, b.vy);
    if (b.bt > 0.35 && sp > 1) { b.bt = 0; const r = (rnd() - 0.5) * Math.PI, cs = Math.cos(r), sn = Math.sin(r); const nx = b.vx * cs - b.vy * sn, ny = b.vx * sn + b.vy * cs; b.vx = nx * 0.85; b.vy = ny * 0.85; }
    if (b.y < 0 || b.y > FIELD_W || b.x > 110 || b.x < -10) { ev('공이 밖으로 굴러 나갔어요', { x: b.x, y: clamp(b.y, 1, FIELD_W - 1) }, false); S.carrier = null; endPlay('out'); return; }
    for (const e of P) { if (e.stun > 0) { e.stun -= DT; continue; } mv(e, b.x, b.y, e.spd, 7); }
    if (b.lt > 0.3) {
      let pk = null, pd = 0.7;
      for (const e of P) { const q = hyp(e.x - b.x, e.y - b.y); if (q < pd && e.stun <= 0) { pd = q; pk = e; } }
      if (pk && (sp < 4 || rnd() < 0.3)) {
        if (pk.team !== b.last) { if (pk.team === 'd') S.fumLost = true; else S.fumLost = false; }
        ev(pk.team === 'd' ? '수비가 잡았다!' : '공격이 다시 잡았다!', pk, true);
        giveBall(pk, 'fumble');
        S.smT = 0;
      }
    }
  }
  function integrate() {
    for (const e of P) {
      if (e.eng && e.team === 'o' && e.mode !== 'carry') continue;  // 블로커는 상대에 붙어서 같이 움직인다
      e.x += e.vx * DT; e.y += e.vy * DT;
    }
  }

  // ---------- 녹화 ----------
  function record() {
    const f = [];
    for (const e of P) f.push(Math.round(e.x * 10), Math.round(e.y * 10));
    const b = S.ball;
    let bx, by, bh = 0;
    if (b.mode === 'held') { bx = b.holder.x + (b.holder.team === 'o' ? 0.4 : -0.4); by = b.holder.y; }
    else if (b.mode === 'air') { const u = clamp((S.t - b.t0) / b.T, 0, 1); bx = b.fx + (b.tx - b.fx) * u; by = b.fy + (b.ty - b.fy) * u; bh = 4 * b.h * u * (1 - u); }
    else { bx = b.x; by = b.y; }
    f.push(Math.round(bx * 10), Math.round(by * 10), Math.round(bh * 10), S.carrier ? P.indexOf(S.carrier) : -1);
    S.frames.push(f);
  }

  let nextRec = 0;
  while (!S.over) {
    if (S.t >= nextRec) { record(); nextRec += FRAME; }
    step();
  }
  // 끝나고 0.6초 동안 다들 멈춰 선다
  for (let i = 0; i < 12; i++) {
    for (let j = 0; j < 3; j++) { for (const e of P) { e.vx *= 0.8; e.vy *= 0.8; e.x += e.vx * DT; e.y += e.vy * DT; } }
    S.t += FRAME; record();
  }
  return { frames: S.frames, events: S.events, result: S.result, los: L };
}

// 차서 넘기기: 공이 날아가고 받는 쪽은 그 자리에서 잡는다 (돌려 뛰기는 다음 버전)
function simulatePunt(o) {
  const R = mulberry(o.seed || 1), L = o.los;
  const dist = (o.dist || 38) + (R() * 2 - 1) * (o.spread || 8);
  const land = Math.min(L + dist, 112), T = 3.6;
  const fr = [], P = [];
  const base = [[L - 13, MID], [L - 6, MID - 3], [L - 0.8, 3], [L - 0.8, FIELD_W - 3], [L - 1, MID - 6], [L - 1, MID + 6], [L - 0.8, MID - 4], [L - 0.8, MID - 2], [L - 0.8, MID], [L - 0.8, MID + 2], [L - 0.8, MID + 4],
    [L + 1, MID - 3], [L + 1, MID - 1], [L + 1, MID + 1], [L + 1, MID + 3], [L + 5, MID - 6], [L + 5, MID], [L + 5, MID + 6], [L + 3, 3], [L + 3, FIELD_W - 3], [L + 20, MID - 8], [Math.min(land, 109), MID]];
  for (const b of base) P.push({ x: b[0], y: b[1] });
  const ex = Math.min(land, 109);
  for (let t = 0; t <= T + 0.6; t += FRAME) {
    const f = [];
    P.forEach((e, i) => {
      let x = e.x, y = e.y;
      if (i === 21) { x = ex; y = MID; }
      else if (i < 11 && i > 1) { const u = Math.min(1, t / T); x = e.x + (ex - 2 - e.x) * u * 0.85; y = e.y + (MID - e.y) * u * 0.5; }
      else if (i >= 11) { const u = Math.min(1, t / T); x = e.x + (ex - 6 - e.x) * u * 0.6; y = e.y + (MID - e.y) * u * 0.3; }
      f.push(Math.round(x * 10), Math.round(y * 10));
    });
    const u = Math.min(1, Math.max(0, (t - 0.5) / (T - 0.5)));
    const bx = t < 0.5 ? L - 0.8 + (L - 13 - (L - 0.8)) * (t / 0.5) : L - 13 + (land - (L - 13)) * u;
    const bh = t < 0.5 ? 0 : 4 * 14 * u * (1 - u);
    f.push(Math.round(bx * 10), Math.round(MID * 10), Math.round(bh * 10), u >= 1 ? 21 : -1);
    fr.push(f);
  }
  const touchback = land >= 100;
  const ev = [{ t: 0.5, s: '뻥!', x: L - 13, y: MID, slow: false }, { t: T, s: touchback ? '엔드존까지 날아갔어요' : `${Math.round(dist)}야드 날아갔어요`, x: ex, y: MID, slow: false }];
  return { frames: fr, events: ev, los: L, result: { punt: true, possession: 'd', spot: touchback ? 80 : Math.round(land), touchback, inc: false, int: false, fumbleLost: false, sack: false, score: null } };
}

// 재생 시간표: 슬로모션 사건 뒤 0.3초(경기 시간)는 1/4 속도로 보여 준다
const SLOW_SIM = 0.3, SLOW_RATE = 0.25;
function playbackLength(rec) {
  const simLen = rec.frames.length * FRAME;
  const slows = rec.events.filter(e => e.slow).length;
  return simLen + slows * SLOW_SIM * (1 / SLOW_RATE - 1);
}

if (typeof module !== 'undefined') module.exports = { setDbg: a => { DBG = a; }, simulatePlay, simulatePunt, playbackLength, FIELD_W, FRAME, SLOW_SIM, SLOW_RATE };
