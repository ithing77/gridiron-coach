// 작전 조합별로 플레이를 여러 번 돌려 평균 결과를 본다: node tools/balance.js [반복 수]
const D = require('../data.js'), S = require('../sim.js');
const N = +process.argv[2] || 200;
const tot = {};
for (const [ti, tj] of [[0, 1], [1, 0]]) {
  console.log(`\n=== 공격 ${D.TEAMS[ti].name} vs 수비 ${D.TEAMS[tj].name}  (평균야드 / 실패% / 가로채기% / 색% / 펌블잃음% / 터치다운%) ===`);
  for (const op of D.OFF_PLAYS) {
    const row = [];
    for (const dp of D.DEF_PLAYS) {
      let g = 0, inc = 0, it = 0, sk = 0, fl = 0, td = 0, err = 0;
      for (let i = 0; i < N; i++) {
        try {
          const r = S.simulatePlay({ offTeam: D.TEAMS[ti], defTeam: D.TEAMS[tj], offPlay: op, defPlay: dp, los: 30, seed: i * 7919 + 13 }).result;
          if (r.possession === 'd') { if (r.int) it++; else fl++; }
          else { g += r.spot - 30; if (r.inc) inc++; if (r.sack) sk++; if (r.score === 'td') td++; }
        } catch (e) { err++; if (err === 1) console.log(op.id, dp.id, e.stack.split('\n').slice(0, 3).join(' | ')); }
      }
      const k = op.id + '/' + dp.id; tot[k] = (tot[k] || 0) + g / N;
      row.push(`${dp.id.padEnd(6)} ${(g / N).toFixed(1).padStart(5)} ${(inc * 100 / N).toFixed(0).padStart(3)} ${(it * 100 / N).toFixed(0).padStart(2)} ${(sk * 100 / N).toFixed(0).padStart(2)} ${(fl * 100 / N).toFixed(0).padStart(2)} ${(td * 100 / N).toFixed(0).padStart(2)}${err ? ' 오류' + err : ''}`);
    }
    console.log(op.id.padEnd(12), row.join(' | '));
  }
}
