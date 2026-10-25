const D = require('../data.js'), S = require('../sim.js');
const [op, dp] = process.argv.slice(2); const c = {};
for (let i = 0; i < 150; i++) { const r = S.simulatePlay({ offTeam: D.TEAMS[0], defTeam: D.TEAMS[1], offPlay: D.OFF_PLAYS.find(p => p.id === op), defPlay: D.DEF_PLAYS.find(p => p.id === dp), los: 30, seed: i * 7919 + 13 }); for (const e of r.events) c[e.s] = (c[e.s] || 0) + 1; }
console.log(op, dp, c);
