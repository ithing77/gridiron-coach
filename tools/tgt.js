const D = require('../data.js'), S = require('../sim.js');
const [op, dp] = process.argv.slice(2); const a = []; S.setDbg(a); const res = {};
for (let i = 0; i < 150; i++) { const n = a.length; const r = S.simulatePlay({ offTeam: D.TEAMS[0], defTeam: D.TEAMS[1], offPlay: D.OFF_PLAYS.find(p => p.id === op), defPlay: D.DEF_PLAYS.find(p => p.id === dp), los: 30, seed: i * 7919 + 13 }).result; const k = (a[n] || 'none') + ':' + (r.inc ? 'inc' : r.possession === 'd' ? 'TO' : 'ok'); res[k] = (res[k] || 0) + 1; }
console.log(op, dp, res);
