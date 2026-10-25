// 방 만들기 / 참가, 연결, 경기 진행.
// 방장 브라우저가 규칙(rules.js)과 시뮬레이션(sim.js)을 돌리고, 손님에게 상태와 플레이 녹화를 보낸다. 손님은 작전만 보낸다.
// 끊기면: 손님은 같은 방 코드로 자동 재접속, 방장은 새로고침해도 [이어하기]로 같은 방을 다시 연다.

const PREFIX = 'gridiron-coach-v1-';
const SAVE_KEY = 'gc-host-save';
const $ = id => document.getElementById(id);
const Net = { peer: null, isHost: false, guest: null, hostConn: null, code: '', retry: 0 };
let lobby = { names: ['', ''], seatTeam: [0, 1] };
let game = null, lastRec = null, seen = [false, false], commitAt = 0, pausedLeft = 0, deadline = 0, hostTimer = null;
const mySeat = () => (Net.isHost ? 0 : 1);

function makeCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from({ length: 4 }, () => abc[Math.floor(Math.random() * abc.length)]).join('');
}
function myName() { return ($('name').value || '').trim().slice(0, 8) || '감독'; }
function show(id) { for (const el of document.querySelectorAll('.screen')) el.style.display = el.id === id ? 'grid' : 'none'; }
function error(msg) { $('err').textContent = msg; $('status').textContent = ''; show('menu'); }

// ---------- 방장 ----------
function hostRoom(resume) {
  Net.isHost = true;
  Net.code = resume ? resume.code : makeCode();
  if (Net.peer) Net.peer.destroy();
  Net.peer = new Peer(PREFIX + Net.code);
  $('status').textContent = resume ? '방 다시 여는 중…' : '방 만드는 중…';
  Net.peer.on('open', () => {
    Net.retry = 0;
    if (resume) {
      game = resume.game; lobby = { names: game.names, seatTeam: game.seatTeam };
      if (game.phase === 'play') { commitPlay(game); }
      startHostLoop(); setDeadline(); pushState();
    } else {
      lobby = { names: [myName(), ''], seatTeam: [0, 1] };
      showLobby();
    }
  });
  Net.peer.on('connection', conn => {
    conn.on('data', d => onHostData(conn, d));
    conn.on('close', () => {
      if (Net.guest !== conn) return;
      Net.guest = null;
      if (!game) { lobby.names[1] = ''; showLobby(); }
      else { if (game.phase === 'call') { pausedLeft = Math.max(0, deadline - Date.now()); } pushState(); }
    });
  });
  Net.peer.on('error', e => {
    if (e.type === 'unavailable-id') {
      // 새로고침 직후엔 예전 연결이 아직 코드를 잡고 있다 — 잠깐 뒤 다시
      if (resume && Net.retry++ < 15) { setTimeout(() => hostRoom(resume), 2000); return; }
      if (!resume) { hostRoom(); return; }
      error('방을 다시 열지 못했어요. 잠시 뒤 다시 눌러 주세요.');
    } else if (e.type !== 'peer-unavailable') error('연결 문제가 생겼어요: ' + e.type);
  });
}
function onHostData(conn, d) {
  if (d.t === 'join') {
    if (Net.guest && Net.guest.open) return conn.send({ t: 'full' });
    Net.guest = conn;
    conn.send({ t: 'welcome' });
    if (!game) { lobby.names[1] = (d.name || '').slice(0, 8) || '친구'; showLobby(); broadcastLobby(); }
    else {
      if (game.phase === 'call' && pausedLeft) { deadline = Date.now() + pausedLeft; pausedLeft = 0; }
      if (game.phase === 'play' && lastRec) { conn.send({ t: 'rec', rec: lastRec }); }
      pushState();
    }
  }
  if (!game) return;
  if (d.t === 'call') { if (submitCall(game, 1, d.id)) pushState(); }
  if (d.t === 'seen' && d.playNo === game.playNo) seen[1] = true;
}
function sendGuest(msg) { if (Net.guest && Net.guest.open) Net.guest.send(msg); }
function broadcastLobby() { sendGuest({ t: 'lobby', lobby, code: Net.code }); }

function startGame() {
  if (!Net.guest) return;
  game = createGame(lobby.names.slice(), lobby.seatTeam.slice());
  sendGuest({ t: 'start' });
  startHostLoop();
  setDeadline();
  pushState();
}
function setDeadline() { deadline = Date.now() + RULES.callSeconds * 1000; pausedLeft = 0; }
function guestOnline() { return !!(Net.guest && Net.guest.open); }
function startHostLoop() {
  clearInterval(hostTimer);
  hostTimer = setInterval(() => {
    if (!game || game.over) return;
    if (game.phase === 'call') {
      if (!guestOnline()) return;   // 친구가 끊기면 기다린다
      if (!bothCalled(game) && Date.now() > deadline) autoCalls(game);
      if (bothCalled(game)) {
        lastRec = runPlay(game);
        seen = [false, !guestOnline()];
        commitAt = Date.now() + playbackLength(lastRec) * 1000 + 6000;
        sendGuest({ t: 'rec', rec: lastRec });
        View.playRec(lastRec, () => { seen[0] = true; });
        pushState();
      }
    } else if (game.phase === 'play') {
      if ((seen[0] && (seen[1] || !guestOnline())) || Date.now() > commitAt) {
        commitPlay(game);
        lastRec = null;
        setDeadline();
        save();
        pushState();
      }
    }
  }, 200);
}
// 상대가 고른 작전은 숨겨서 보낸다
function snapFor(seat) {
  const s = JSON.parse(JSON.stringify(game));
  s.calls = game.calls.map((c, i) => (i === seat ? c : !!c));
  s.pending = null; s.seed = 0;
  s.callLeft = game.phase === 'call' ? (guestOnline() ? Math.max(0, deadline - Date.now()) : pausedLeft || RULES.callSeconds * 1000) : 0;
  s.waitingGuest = !guestOnline();
  return s;
}
function pushState() {
  sendGuest({ t: 'state', s: snapFor(1) });
  onState(snapFor(0));
  save();
}
function save() {
  try {
    if (game && !game.over) localStorage.setItem(SAVE_KEY, JSON.stringify({ code: Net.code, game, at: Date.now() }));
    else localStorage.removeItem(SAVE_KEY);
  } catch {}
}

// ---------- 손님 ----------
function joinRoom(code, quiet) {
  code = code.trim().toUpperCase();
  if (code.length !== 4) return error('방 코드 4글자를 넣어 주세요');
  Net.isHost = false; Net.code = code;
  if (Net.peer) Net.peer.destroy();
  Net.peer = new Peer();
  if (!quiet) $('status').textContent = '방 찾는 중…';
  Net.peer.on('open', () => {
    const conn = Net.peer.connect(PREFIX + code, { reliable: true });
    Net.hostConn = conn;
    conn.on('open', () => { Net.retry = 0; conn.send({ t: 'join', name: myName() }); View.setBanner(''); });
    conn.on('data', onGuestData);
    conn.on('close', () => reconnect());
  });
  Net.peer.on('error', e => {
    if (e.type === 'peer-unavailable') { if (Net.started) reconnect(); else error('그 코드의 방을 찾을 수 없어요'); }
    else if (Net.started) reconnect();
    else error('연결 문제가 생겼어요: ' + e.type);
  });
}
function reconnect() {
  if (!Net.started || Net.isHost) { if (!Net.started) error('방장과 연결이 끊겼어요'); return; }
  if (Net.retrying) return;
  Net.retrying = true;
  View.setBanner('방장과 연결이 끊겼어요 — 다시 연결하는 중…');
  setTimeout(() => {
    Net.retrying = false;
    if (Net.retry++ > 40) { View.setBanner('다시 연결하지 못했어요. 방장에게 방을 다시 열어 달라고 해 주세요.'); return; }
    joinRoom(Net.code, true);
  }, 2500);
}
function onGuestData(d) {
  if (d.t === 'lobby') { lobby = d.lobby; showLobby(); }
  if (d.t === 'full') error('방이 꽉 찼어요');
  if (d.t === 'start') Net.started = true;
  if (d.t === 'state') { Net.started = true; onState(d.s); }
  if (d.t === 'rec') { Net.started = true; View.playRec(d.rec, () => { if (Net.hostConn && Net.hostConn.open) Net.hostConn.send({ t: 'seen', playNo: d.rec.playNo }); }); }
}

// ---------- 공통 ----------
function sendCall(id) {
  if (Net.isHost) { if (game && submitCall(game, 0, id)) pushState(); }
  else if (Net.hostConn && Net.hostConn.open) Net.hostConn.send({ t: 'call', id });
}
function onState(s) {
  show('none');
  $('game').style.display = '';
  View.setGame(s, mySeat());
  if (s.over) endGame(s);
}
function showLobby() {
  show('lobbyScreen');
  $('roomCode').textContent = Net.code;
  $('roomLink').value = `${location.origin}${location.pathname}?room=${Net.code}`;
  $('lobbyList').innerHTML = [0, 1].map(i => {
    const t = TEAMS[lobby.seatTeam[i]], n = lobby.names[i];
    return `<li><span class="dot" style="background:${t.color}"></span><b>${n || '친구를 기다리는 중…'}</b>${i === mySeat() && n ? ' (나)' : ''}<br><small>${t.name} · ${t.style}</small></li>`;
  }).join('');
  $('swapBtn').style.display = Net.isHost ? '' : 'none';
  $('startBtn').style.display = Net.isHost ? '' : 'none';
  $('startBtn').disabled = !lobby.names[1];
  $('startBtn').textContent = lobby.names[1] ? '경기 시작' : '친구가 들어오면 시작할 수 있어요';
  $('waitHost').style.display = Net.isHost ? 'none' : '';
}
function endGame(s) {
  const t = s.seatTeam.map(i => TEAMS[i]);
  const w = s.score[0] === s.score[1] ? -1 : (s.score[0] > s.score[1] ? 0 : 1);
  $('result').innerHTML = `<div class="final"><span style="color:${t[0].color}">${t[0].name}</span> ${s.score[0]} : ${s.score[1]} <span style="color:${t[1].color}">${t[1].name}</span></div>
    <div class="sub">${w < 0 ? '무승부!' : `${s.names[w]} 감독(${t[w].name}) 승리!`}</div>`;
  $('againBtn').style.display = Net.isHost ? '' : 'none';
  $('againWait').style.display = Net.isHost ? 'none' : '';
  show('endScreen');
  try { if (Net.isHost) localStorage.removeItem(SAVE_KEY); } catch {}
}

View.init({ canvas: $('field'), onCall: sendCall });
$('hostBtn').onclick = () => hostRoom();
$('joinBtn').onclick = () => joinRoom($('code').value);
$('startBtn').onclick = startGame;
$('swapBtn').onclick = () => { lobby.seatTeam.reverse(); showLobby(); broadcastLobby(); };
$('againBtn').onclick = () => { game = null; lobby.seatTeam = lobby.seatTeam.slice(); startGame(); };
$('copyBtn').onclick = () => { $('roomLink').select(); navigator.clipboard?.writeText($('roomLink').value); $('copyBtn').textContent = '복사됨!'; };
const room = new URLSearchParams(location.search).get('room');
if (room) $('code').value = room;
try { $('name').value = localStorage.getItem('gc-name') || ''; } catch {}
$('name').oninput = () => { try { localStorage.setItem('gc-name', $('name').value); } catch {} };
try {
  const sv = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
  if (sv && sv.game && !sv.game.over && Date.now() - sv.at < 6 * 3600 * 1000) {
    $('resumeBtn').style.display = '';
    $('resumeBtn').textContent = `이어하기 (방 ${sv.code} · ${TEAMS[sv.game.seatTeam[0]].short} ${sv.game.score[0]} : ${sv.game.score[1]} ${TEAMS[sv.game.seatTeam[1]].short})`;
    $('resumeBtn').onclick = () => hostRoom(sv);
  }
} catch {}
show('menu');
