const D = require('../data.js'), S = require('../sim.js');
const [op, dp, seed] = process.argv.slice(2);
const r = S.simulatePlay({ offTeam: D.TEAMS[0], defTeam: D.TEAMS[1], offPlay: D.OFF_PLAYS.find(p => p.id === op), defPlay: D.DEF_PLAYS.find(p => p.id === dp), los: 30, seed: +seed || 13 });
const K = ['qb','rb','wr1','wr2','wr3','te','ol0','ol1','ol2','ol3','ol4','dl0','dl1','dl2','dl3','lb0','lb1','lb2','cb0','cb1','s0','s1'];
for (let i = 0; i < r.frames.length; i += 10) { const f = r.frames[i]; console.log((i*0.05).toFixed(1), 'ball', f[44]/10, f[45]/10, 'car', K[f[47]], '|', K.slice(11).map((k, j) => k + ':' + f[(11+j)*2]/10 + ',' + f[(11+j)*2+1]/10).join(' ')); }
console.log(r.events, r.result);
