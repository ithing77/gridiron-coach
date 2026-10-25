// 작전 궁합 요약: 공격 작전마다 수비 작전별 평균 야드(두 팀 평균) — 카드의 "강함/약함" 글귀 정할 때 본다
const D = require('../data.js'), S = require('../sim.js');
const N = +process.argv[2] || 100;
for (const op of D.OFF_PLAYS) {
  const row = D.DEF_PLAYS.map(dp => {
    let v = 0, to = 0, td = 0;
    for (const [a, b] of [[0, 1], [1, 0]]) for (let i = 0; i < N; i++) {
      const r = S.simulatePlay({ offTeam: D.TEAMS[a], defTeam: D.TEAMS[b], offPlay: op, defPlay: dp, los: 30, seed: i * 104729 + 7 }).result;
      if (r.possession === 'd') { to++; v -= 25; } else { v += Math.min(r.spot - 30, 40); if (r.score === 'td') td++; }
    }
    return `${dp.n} ${(v / N / 2).toFixed(1)}(뺏김${(to * 50 / N).toFixed(0)}% TD${(td * 50 / N).toFixed(0)}%)`;
  });
  console.log(op.n.padEnd(8), row.join(' | '));
}
