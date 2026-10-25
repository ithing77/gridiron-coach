// 무작위 작전으로 경기를 여러 판 끝까지 돌려 본다: node tools/fullgame.js [판 수]
Object.assign(global, require('../data.js'), require('../sim.js'));
Object.assign(global, require('../rules.js'));
const N = +process.argv[2] || 20; let plays = 0, secs = 0;
for (let k = 0; k < N; k++) {
  const g = createGame(['가', '나'], [0, 1]);
  while (!g.over) {
    for (const s of [0, 1]) { const l = legalCalls(g, s); submitCall(g, s, l[Math.floor(Math.random() * l.length)]); }
    const rec = runPlay(g); secs += playbackLength(rec) + 2 + 6; commitPlay(g); plays++;
    if (plays > 1e5) throw new Error('끝나지 않음');
  }
  console.log(`${k + 1}판: 여우 ${g.score[0]} : ${g.score[1]} 곰  (플레이 ${g.playNo})  마지막: ${g.log[0].text}`);
}
console.log(`평균 플레이 ${(plays / N).toFixed(0)}개, 예상 한 판 ${(secs / N / 60).toFixed(0)}분 (작전 고르기 6초로 잡음)`);
