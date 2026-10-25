const D = require('../data.js'), S = require('../sim.js');
const [op, dp] = process.argv.slice(2);
const g = [];
for (let i = 0; i < 60; i++) { const r = S.simulatePlay({ offTeam: D.TEAMS[0], defTeam: D.TEAMS[1], offPlay: D.OFF_PLAYS.find(p => p.id === op), defPlay: D.DEF_PLAYS.find(p => p.id === dp), los: 30, seed: i * 7919 + 13 }); g.push((r.result.inc ? 'x' : r.result.spot - 30) + (r.result.possession === 'd' ? 'T' : '')); }
console.log(g.join(' '));
