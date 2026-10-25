// 화면: 경기장 캔버스(녹화 재생), 점수판, 작전 카드, 힌트, 기록, 팀 능력치 표.

const View = (() => {
  const $ = id => document.getElementById(id);
  let cv, cx, onCall, g = null, seat = 0, deadlineLocal = 0;
  let rec = null, simT = 0, evIdx = 0, onDone = null, doneSent = false, caps = [], last = 0;
  let cam = { x: 25, y: 26.65 }, formCache = { key: '', frame: null };
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const C = {
    out: dark ? '#20231f' : '#e9e6dc', field: dark ? '#1f3d16' : '#cfe6b4', stripe: dark ? '#224419' : '#c6dfa9',
    line: dark ? '#3c6a2c' : '#ffffff', num: dark ? '#5d8f48' : '#ffffff', los: '#2f6fd6', fd: '#f2b51d',
    ballF: '#8a4b20', ballS: '#f4ead8', ring: dark ? '#f1efe8' : '#1f1f1d', capBg: dark ? '#f1efe8' : '#1f1f1d', capFg: dark ? '#1f1f1d' : '#ffffff',
  };

  function init(o) {
    cv = o.canvas; cx = cv.getContext('2d'); onCall = o.onCall;
    new ResizeObserver(resize).observe(cv); resize();
    $('teamBtnMe').onclick = () => showRoster(g.seatTeam[seat]);
    $('teamBtnOpp').onclick = () => showRoster(g.seatTeam[1 - seat]);
    $('rosterClose').onclick = () => { $('roster').style.display = 'none'; };
    requestAnimationFrame(loop);
    setInterval(tickTimer, 200);
  }
  function resize() {
    const r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    cv.width = Math.max(300, r.width * dpr); cv.height = Math.max(200, r.height * dpr);
  }

  // ---------- 상태 반영 ----------
  function setGame(s, mySeat) {
    const prevNo = g ? g.playNo : -1;
    g = s; seat = mySeat;
    deadlineLocal = performance.now() + (s.callLeft || 0);
    renderHud();
    renderCards();
    if (s.phase === 'call' && s.last && s.playNo !== prevNo) flashResult(s.last);
  }
  const T = i => TEAMS[i];
  function renderHud() {
    const t0 = T(g.seatTeam[0]), t1 = T(g.seatTeam[1]);
    const side = i => `<div class="sc-team ${g.poss === i ? 'has' : ''}" style="--tc:${T(g.seatTeam[i]).color}">
        <div class="sc-name">${g.poss === i ? '<span class="pill">공격</span>' : ''}${T(g.seatTeam[i]).name}</div>
        <div class="sc-coach">${g.names[i]}${i === seat ? ' (나)' : ''} · 공격 ${Math.min(g.drives[i] + (g.poss === i && !g.over ? 1 : 0), RULES.drivesPerTeam)}/${RULES.drivesPerTeam}</div>
      </div><div class="sc-num" style="color:${T(g.seatTeam[i]).color}">${g.score[i]}</div>`;
    const offT = T(g.seatTeam[g.poss]);
    const goal = g.ballOn + g.togo >= 100;
    const where = g.ballOn < 50 ? `${offT.short} 진영 ${g.ballOn}` : g.ballOn === 50 ? '한가운데 50' : `상대 진영 ${100 - g.ballOn}`;
    $('scoreboard').innerHTML = `<div class="sc-side">${side(0)}</div>
      <div class="sc-mid"><div class="sc-down">${g.down}번째 기회 · ${goal ? '골까지' : ''} ${g.togo}야드</div><div class="sc-where">공 위치: ${where}</div></div>
      <div class="sc-side right">${side(1)}</div>`;
    const lg = $('log');
    lg.innerHTML = g.log.map(l => `<div class="lg"><span class="dot" style="background:${T(l.offTeam).color}"></span><b>${l.off}</b> vs ${l.def}<br><small>${l.text}</small></div>`).join('') || '<div class="lg muted">아직 플레이가 없어요</div>';
    $('teamBtnMe').textContent = `우리 팀 (${T(g.seatTeam[seat]).short}) 능력치`;
    $('teamBtnOpp').textContent = `상대 팀 (${T(g.seatTeam[1 - seat]).short}) 능력치`;
  }
  function renderCards() {
    const off = seat === g.poss, panel = $('cards'), mine = g.calls[seat], oppDone = g.calls[1 - seat];
    const myT = T(g.seatTeam[seat]);
    $('role').innerHTML = g.phase === 'play' ? '플레이 진행 중…' : g.over ? '경기 끝' :
      `<span class="pill" style="background:${myT.light};color:${myT.color}">${off ? '공격' : '수비'}</span> ${off ? '공격 작전을 고르세요' : '수비 작전을 고르세요 — 상대가 뭘 할지 읽어 보세요'}`;
    $('hint').textContent = g.phase === 'call' ? hintFor(g, seat) : '';
    if (g.phase !== 'call') { panel.innerHTML = ''; $('waitMsg').textContent = ''; return; }
    const ids = legalCalls(g, seat);
    panel.innerHTML = ids.map(id => {
      const p = playById(id);
      return `<button class="card ${mine === id ? 'on' : ''} ${mine && mine !== id ? 'dim' : ''}" data-id="${id}">
        <div class="cn"><span class="ic">${p.icon}</span>${p.n}</div><div class="cd">${p.d}</div>
        ${p.good !== '-' ? `<div class="cg">강함: ${p.good}</div><div class="cb">약함: ${p.bad}</div>` : ''}</button>`;
    }).join('');
    for (const b of panel.querySelectorAll('.card')) b.onclick = () => { if (!g.calls[seat]) onCall(b.dataset.id); };
    $('waitMsg').textContent = g.waitingGuest ? '친구 연결이 끊겼어요 — 다시 들어올 때까지 기다려요' :
      mine ? (oppDone ? '둘 다 골랐어요! 곧 시작해요' : '골랐어요. 상대를 기다리는 중…') : (oppDone ? '상대는 벌써 골랐어요!' : '');
  }
  function tickTimer() {
    const bar = $('timer');
    if (!g || g.phase !== 'call' || g.waitingGuest) { bar.style.width = '0%'; $('timerTxt').textContent = ''; return; }
    const left = Math.max(0, deadlineLocal - performance.now()), tot = RULES.callSeconds * 1000;
    bar.style.width = (left / tot * 100) + '%';
    bar.style.background = left < 5000 ? '#e24b4a' : '#2f6fd6';
    $('timerTxt').textContent = g.calls[seat] ? '' : `${Math.ceil(left / 1000)}초 (안 고르면 자동으로 골라져요)`;
  }
  function setBanner(s) { const b = $('banner'); b.textContent = s; b.style.display = s ? '' : 'none'; }
  function flashResult(l) {
    const r = $('resultLine');
    const auto = l.autoed.includes(seat) ? ' (시간이 지나 자동으로 골라졌어요)' : '';
    r.innerHTML = `<b>지난 플레이</b> ${playById(l.off).n} vs ${playById(l.def).n} → ${l.text}${auto}`;
    r.classList.toggle('big', !!l.big);
  }
  function showRoster(ti) {
    const t = T(ti), $r = $('rosterBody');
    const row = p => { const [a, b] = POS_SPECIAL[p.pos]; return `<tr><td>${p.num}</td><td>${p.name}</td><td>${POS_NAMES[p.pos]}</td><td>${p.spd}</td><td>${p.str}</td><td>${p.agi}</td><td>${STAT_NAMES[a]} <b>${p[a]}</b></td><td>${STAT_NAMES[b]} <b>${p[b]}</b></td></tr>`; };
    $('rosterTitle').innerHTML = `<span style="color:${t.color}">${t.name}</span> <small>${t.style}</small>`;
    $r.innerHTML = `<tr class="grp"><td colspan="8">공격</td></tr>${t.off.map(row).join('')}<tr class="grp"><td colspan="8">수비</td></tr>${t.def.map(row).join('')}`;
    $('roster').style.display = 'grid';
  }

  // ---------- 재생 ----------
  function playRec(r, done) {
    rec = r; simT = 0; evIdx = 0; onDone = done; doneSent = false; caps = [];
    const o = playById(r.offCall), d = playById(r.defCall), ot = T(r.offTeam), dt = T(r.defTeam);
    $('reveal').innerHTML = `<span style="color:${ot.color}">${ot.short} 공격: <b>${o.n}</b></span> <span class="vs">vs</span> <span style="color:${dt.color}">${dt.short} 수비: <b>${d.n}</b></span>`;
    $('reveal').style.display = '';
    renderCards();
  }
  function frameAt(t) {
    const F = rec.frames, i = Math.min(F.length - 1, Math.floor(t / FRAME)), j = Math.min(F.length - 1, i + 1), u = Math.min(1, t / FRAME - i);
    const a = F[i], b = F[j], out = new Array(a.length);
    for (let k = 0; k < a.length - 1; k++) out[k] = (a[k] + (b[k] - a[k]) * u) / 10;
    out[a.length - 1] = a[a.length - 1];
    return out;
  }
  function formationFrame() {
    const key = g.ballOn + ':' + g.poss + ':' + g.seatTeam.join(',');
    if (formCache.key !== key) {
      const r = simulatePlay({ offTeam: T(g.seatTeam[g.poss]), defTeam: T(g.seatTeam[1 - g.poss]), offPlay: OFF_PLAYS[0], defPlay: DEF_PLAYS[3], los: g.ballOn, seed: 1 });
      formCache = { key, frame: r.frames[0].map((v, i, a) => (i === a.length - 1 ? -1 : v / 10)) };
    }
    return formCache.frame;
  }
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0); last = now;
    let f = null, los, togo, offTi, defTi;
    if (rec) {
      const len = rec.frames.length * FRAME;
      const slow = rec.events.some(e => e.slow && simT >= e.t && simT < e.t + SLOW_SIM);
      simT = Math.min(len, simT + dt * (slow ? SLOW_RATE : 1));
      while (evIdx < rec.events.length && rec.events[evIdx].t <= simT) { const e = rec.events[evIdx++]; caps.push({ s: e.s, x: e.x, y: e.y, life: 1.6 }); }
      f = frameAt(simT); los = rec.los; offTi = rec.offTeam; defTi = rec.defTeam;
      togo = g ? g.togo : 10;
      if (simT >= len && !doneSent) {
        doneSent = true;
        setTimeout(() => { const d = onDone; rec = null; $('reveal').style.display = 'none'; if (d) d(); }, 1200);
      }
    } else if (g) {
      f = formationFrame(); los = g.ballOn; togo = g.togo; offTi = g.seatTeam[g.poss]; defTi = g.seatTeam[1 - g.poss];
    }
    caps.forEach(k => { k.life -= dt; }); caps = caps.filter(k => k.life > 0);
    if (f) draw(f, los, togo, offTi, defTi);
    requestAnimationFrame(loop);
  }

  // ---------- 그리기 ----------
  function draw(f, los, togo, offTi, defTi) {
    const W = cv.width, H = cv.height, S = Math.min(W / Math.max(30, Math.min(54, cv.clientWidth / 11)), H / 36);   // 좁은 화면은 더 크게 확대
    const bx = f[44], by = f[45];
    const tx = Math.max(-8, Math.min(108, bx + 6)), ty = Math.max(H / S / 2 - 2, Math.min(FIELD_W - H / S / 2 + 2, by));
    cam.x += (tx - cam.x) * 0.08; cam.y += (ty - cam.y) * 0.08;
    if (Math.abs(tx - cam.x) > 40) { cam.x = tx; cam.y = ty; }
    const X = x => (x - cam.x) * S + W / 2, Y = y => (y - cam.y) * S + H / 2;
    const ot = T(offTi), dt = T(defTi);
    cx.fillStyle = C.out; cx.fillRect(0, 0, W, H);
    for (let x = 0; x < 100; x += 10) { cx.fillStyle = (x / 10) % 2 ? C.stripe : C.field; cx.fillRect(X(x), Y(0), 10 * S + 1, FIELD_W * S); }
    // 엔드존: 왼쪽은 공격팀 것, 오른쪽은 수비팀 것 (공격은 늘 오른쪽으로 간다)
    cx.globalAlpha = 0.85;
    cx.fillStyle = ot.color; cx.fillRect(X(-10), Y(0), 10 * S, FIELD_W * S);
    cx.fillStyle = dt.color; cx.fillRect(X(100), Y(0), 10 * S, FIELD_W * S);
    cx.globalAlpha = 1;
    cx.fillStyle = '#fff'; cx.font = `700 ${Math.round(S * 2.6)}px sans-serif`; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    const ez = (x, name, rot) => { cx.save(); cx.translate(X(x), Y(MIDY)); cx.rotate(rot); cx.fillText(name, 0, 0); cx.restore(); };
    ez(-5, ot.short, -Math.PI / 2); ez(105, dt.short, Math.PI / 2);
    cx.strokeStyle = C.line; cx.lineWidth = Math.max(1, S * 0.12);
    for (let x = 0; x <= 100; x += 5) { cx.beginPath(); cx.moveTo(X(x), Y(0)); cx.lineTo(X(x), Y(FIELD_W)); cx.stroke(); }
    cx.lineWidth = Math.max(2, S * 0.25); cx.strokeRect(X(-10), Y(0), 120 * S, FIELD_W * S);
    cx.fillStyle = C.num; cx.font = `700 ${Math.round(S * 1.8)}px sans-serif`;
    for (let x = 10; x < 100; x += 10) { const n = x <= 50 ? x : 100 - x; cx.fillText(n, X(x), Y(10)); cx.fillText(n, X(x), Y(FIELD_W - 10)); }
    // 출발선·목표선
    cx.lineWidth = Math.max(2, S * 0.3);
    cx.strokeStyle = C.los; cx.beginPath(); cx.moveTo(X(los), Y(0)); cx.lineTo(X(los), Y(FIELD_W)); cx.stroke();
    if (los + togo < 100) { cx.strokeStyle = C.fd; cx.beginPath(); cx.moveTo(X(los + togo), Y(0)); cx.lineTo(X(los + togo), Y(FIELD_W)); cx.stroke(); }
    // 선수
    const team = rec ? [rec.offTeam, rec.defTeam] : [offTi, defTi];
    const offRoster = T(team[0]).off, defRoster = T(team[1]).def, carrier = f[47];
    const R = Math.max(5, S * 0.62);
    cx.font = `700 ${Math.round(R * 0.95)}px sans-serif`;
    for (let i = 0; i < 22; i++) {
      const x = X(f[i * 2]), y = Y(f[i * 2 + 1]), o = i < 11, t = T(team[o ? 0 : 1]);
      cx.fillStyle = t.color; cx.beginPath(); cx.arc(x, y, R, 0, 7); cx.fill();
      cx.strokeStyle = o ? '#ffffff' : '#1f1f1d'; cx.lineWidth = Math.max(1, R * 0.16); cx.stroke();
      if (R >= 8) { cx.fillStyle = '#fff'; cx.fillText((o ? offRoster[i] : defRoster[i - 11]).num, x, y + 0.5); }
    }
    if (carrier >= 0) { cx.strokeStyle = C.ring; cx.lineWidth = Math.max(2, R * 0.25); cx.beginPath(); cx.arc(X(f[carrier * 2]), Y(f[carrier * 2 + 1]), R * 1.55, 0, 7); cx.stroke(); }
    // 공 (높이 h 만큼 떠 있고, 땅에 그림자)
    const h = f[46], gx = X(bx), gy = Y(by);
    if (h > 0.2) { cx.fillStyle = 'rgba(0,0,0,.25)'; cx.beginPath(); cx.ellipse(gx, gy, R * 0.6, R * 0.35, 0, 0, 7); cx.fill(); }
    const lift = h * S * 0.6;
    cx.fillStyle = C.ballF; cx.strokeStyle = C.ballS; cx.lineWidth = Math.max(1, R * 0.15);
    cx.beginPath(); cx.ellipse(gx, gy - lift, R * 0.8, R * 0.5, 0, 0, 7); cx.fill(); cx.stroke();
    // 사건 글자
    cx.font = `700 ${Math.max(14, Math.round(S * 1.5))}px sans-serif`;
    for (const k of caps) {
      cx.globalAlpha = Math.min(1, k.life * 2);
      const w = cx.measureText(k.s).width + 22, hh = Math.max(26, S * 2.4), px = X(k.x), py = Y(k.y) - R * 3 - (1.6 - k.life) * 16;
      cx.fillStyle = C.capBg; cx.beginPath(); cx.roundRect(px - w / 2, py - hh / 2, w, hh, 8); cx.fill();
      cx.fillStyle = C.capFg; cx.fillText(k.s, px, py + 1);
      cx.globalAlpha = 1;
    }
  }
  const MIDY = FIELD_W / 2;

  return { init, setGame, playRec, setBanner };
})();
