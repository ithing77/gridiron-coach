// 경기 규칙: 기회(다운)·전진 거리·점수·공격권 교대·경기 끝. 방장만 실행한다.
// 자리(seat) 0 = 방장, 1 = 손님. 공 위치(ballOn)는 공격팀 엔드존에서 잰 야드(0~100).

function createGame(names, seatTeam) {
  return {
    names, seatTeam, score: [0, 0], poss: 0, ballOn: RULES.startYard, down: 1, togo: 10,
    drives: [0, 0], phase: 'call', calls: [null, null], playNo: 0, seed: Math.floor(Math.random() * 1e9),
    last: null, log: [], tend: [{ run: 0, pass: 0 }, { run: 0, pass: 0 }], over: false,
  };
}
const teamOfSeat = (g, s) => TEAMS[g.seatTeam[s]];
const offSeat = g => g.poss, defSeat = g => 1 - g.poss;
const playById = id => OFF_PLAYS.find(p => p.id === id) || DEF_PLAYS.find(p => p.id === id) || (id === 'punt' ? PUNT_PLAY : null);

function legalCalls(g, seat) {
  if (seat === offSeat(g)) return OFF_PLAYS.map(p => p.id).concat(g.down === 4 ? ['punt'] : []);
  return DEF_PLAYS.map(p => p.id);
}
function submitCall(g, seat, id) {
  if (g.phase !== 'call' || g.calls[seat] || !legalCalls(g, seat).includes(id)) return false;
  g.calls[seat] = id;
  return true;
}
// 시간이 다 되면: 공격은 무작위 작전, 수비는 균형 수비
function autoCalls(g) {
  const o = offSeat(g), d = defSeat(g);
  if (!g.calls[o]) { const l = OFF_PLAYS; g.calls[o] = l[Math.floor(Math.random() * l.length)].id; g.autoed = (g.autoed || []).concat(o); }
  if (!g.calls[d]) { g.calls[d] = 'bal'; g.autoed = (g.autoed || []).concat(d); }
}
const bothCalled = g => !!(g.calls[0] && g.calls[1]);

// 작전 둘이 정해지면 플레이를 계산한다 (녹화를 돌려준다)
function runPlay(g) {
  const o = offSeat(g), d = defSeat(g);
  const op = playById(g.calls[o]), dp = playById(g.calls[d]);
  const seed = g.seed + g.playNo * 7919;
  const rec = op.kind === 'punt'
    ? simulatePunt({ los: g.ballOn, seed, dist: RULES.puntDist, spread: RULES.puntSpread })
    : simulatePlay({ offTeam: teamOfSeat(g, o), defTeam: teamOfSeat(g, d), offPlay: op, defPlay: dp, los: g.ballOn, seed });
  rec.playNo = g.playNo;
  rec.offSeat = o;
  rec.offCall = op.id; rec.defCall = dp.id;
  rec.offTeam = g.seatTeam[o]; rec.defTeam = g.seatTeam[d];
  g.phase = 'play';
  g.pending = rec.result;
  return rec;
}

// 재생이 끝나면 결과를 반영한다
function commitPlay(g) {
  const r = g.pending, o = offSeat(g), d = defSeat(g), L = g.ballOn;
  const op = playById(g.calls[o]), dp = playById(g.calls[d]);
  if (op.kind === 'run') g.tend[o].run++; else if (op.kind === 'pass') g.tend[o].pass++;
  const oName = teamOfSeat(g, o).short, dName = teamOfSeat(g, d).short;
  let text, big = false;
  const change = (toSeat, at) => { g.drives[g.poss]++; g.poss = toSeat; g.ballOn = Math.max(1, Math.min(99, Math.round(at))); g.down = 1; g.togo = Math.min(10, 100 - g.ballOn); };

  if (r.punt) {
    text = r.touchback ? '차서 넘기기 — 엔드존까지 날아가서 상대는 20야드에서 시작' : `차서 넘기기 — ${r.spot - L}야드`;
    change(d, 100 - r.spot);
  } else if (r.score === 'td') {
    g.score[o] += RULES.tdPoints; text = `터치다운! ${oName} +${RULES.tdPoints}점`; big = true;
    change(d, RULES.startYard);
  } else if (r.score === 'def_td') {
    g.score[d] += RULES.tdPoints; text = `공을 뺏어서 그대로 터치다운! ${dName} +${RULES.tdPoints}점`; big = true;
    change(o, RULES.startYard);   // 득점한 수비팀이 차 주고, 원래 공격팀이 새로 공격한다
  } else if (r.score === 'safety') {
    g.score[d] += RULES.safetyPoints; text = `세이프티! 내 엔드존에서 잡혀서 ${dName} +${RULES.safetyPoints}점`; big = true;
    change(d, 35);
  } else if (r.possession === 'd') {
    text = r.int ? '가로채기! 공격권이 넘어가요' : '펌블로 공을 뺏겼어요! 공격권이 넘어가요'; big = true;
    change(d, r.spot >= 100 ? 20 : 100 - r.spot);
  } else {
    const spot = r.inc ? L : r.spot, gain = spot - L;
    text = r.inc ? '패스 실패 — 0야드' : r.sack ? `쿼터백이 잡혔어요(색) ${gain}야드` : gain >= 0 ? `+${gain}야드 전진` : `${gain}야드 밀렸어요`;
    if (gain >= 20) big = true;
    g.ballOn = spot;
    if (spot >= L + g.togo) { g.down = 1; g.togo = Math.min(10, 100 - spot); text += ' · 10야드 성공! 기회가 다시 4번'; }
    else {
      g.down++; g.togo -= gain;
      if (g.down > 4) { text += ' · 4번째 기회도 실패해서 공격권이 넘어가요'; big = true; change(d, 100 - spot); }
    }
  }
  g.last = { text, big, off: op.id, def: dp.id, offSeat: o, autoed: g.autoed || [] };
  g.log.unshift({ no: g.playNo + 1, offTeam: g.seatTeam[o], off: op.n, def: dp.n, text });
  if (g.log.length > 30) g.log.pop();
  g.autoed = [];
  g.calls = [null, null];
  g.pending = null;
  g.playNo++;
  if (g.drives[0] >= RULES.drivesPerTeam && g.drives[1] >= RULES.drivesPerTeam) { g.phase = 'over'; g.over = true; }
  else g.phase = 'call';
}

// 상황 힌트 (룰을 몰라도 고를 수 있게)
function hintFor(g, seat) {
  const off = seat === offSeat(g), t = g.togo, dn = g.down;
  const goal = g.ballOn + t >= 100;
  const opp = g.tend[offSeat(g)];
  let h;
  if (off) {
    if (dn === 4) h = t <= 2 ? '마지막 기회예요. 짧으니 도박해 볼 만해요. 실패하면 이 자리에서 공이 넘어가요.' : '마지막 기회예요. 멀면 "차서 넘기기"로 상대를 뒤로 보내는 게 안전해요.';
    else if (goal && 100 - g.ballOn <= 5) h = '엔드존이 코앞이에요! 수비가 잔뜩 몰려 있을 거예요.';
    else if (t <= 2) h = '짧게만 가면 돼요. 상대는 달리기를 예상할 거예요 — 허를 찔러도 좋아요.';
    else if (dn >= 3 && t >= 7) h = '멀리 가야 해요. 상대는 패스를 예상할 거예요.';
    else if (dn === 1) h = '첫 기회예요. 뭘 해도 상대가 헷갈려요.';
    else h = `${t}야드 남았어요. 달리기로 조금씩 갈지, 패스로 한 번에 갈지 골라요.`;
  } else {
    if (dn === 4 && t > 3) h = '상대의 마지막 기회예요. 차서 넘길 가능성이 커요.';
    else if (t <= 2) h = '상대는 짧게만 가면 돼요. 달리기가 올 가능성이 커요.';
    else if (dn >= 3 && t >= 7) h = '상대는 멀리 가야 해요. 패스가 올 가능성이 커요.';
    else h = '상대가 달리기를 할지 패스를 할지 읽어 보세요.';
    if (opp.run + opp.pass >= 3) h += ` (상대는 지금까지 달리기 ${opp.run}번, 패스 ${opp.pass}번)`;
  }
  return h;
}

if (typeof module !== 'undefined') module.exports = { createGame, legalCalls, submitCall, autoCalls, bothCalled, runPlay, commitPlay, hintFor, playById };
