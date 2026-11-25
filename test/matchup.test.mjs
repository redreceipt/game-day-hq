import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMatchup, server } from '../server.mjs';

const teams = [
  { id:1, location:'The', nickname:'Owls', record:{overall:{wins:4,losses:2,ties:1}} },
  { id:2, name:'The Falcons' },
];
const player = {
  playerId:42, lineupSlotId:0,
  playerPoolEntry:{ appliedStatTotal:87, player:{
    id:42, fullName:'Test Quarterback', defaultPositionId:1, proTeamId:12,
    stats:[
      {scoringPeriodId:6,statSplitTypeId:1,statSourceId:0,appliedTotal:12},
      {scoringPeriodId:7,statSplitTypeId:1,statSourceId:1,appliedTotal:21},
      {scoringPeriodId:7,statSplitTypeId:1,statSourceId:0,appliedTotal:0,stats:{3:250,4:1},appliedStats:{3:10,4:4,912:-14}},
    ],
  }},
};
const meta = {
  teams, status:{latestScoringPeriod:7,finalScoringPeriod:17},
  settings:{name:'Test League',scheduleSettings:{matchupPeriods:{7:[7],8:[8],9:[9,10]}}},
};
const fixture = (matchupPeriodId,winner,home,away) => ({teams,schedule:[{matchupPeriodId,winner,home:{teamId:1,...home},away:{teamId:2,...away}}]});

test('uses zero and live points as actuals, not season totals or projections', () => {
  const data = buildMatchup(meta,fixture(7,'UNDECIDED',{
    totalPoints:0,totalPointsLive:21.7,
    rosterForCurrentScoringPeriod:{entries:[player,{...player,lineupSlotId:21}]},
  },{pointsByScoringPeriod:{7:0},totalProjectedPoints:87}),7,1);
  assert.equal(data.team,'The Owls');
  assert.equal(data.record,'4–2–1');
  assert.equal(data.teamScore,21.7);
  assert.equal(data.opponentScore,0);
  assert.equal(data.state,'In progress');
  assert.deepEqual(data.roster.map(p=>[p.actual,p.projected,p.bench]),[[0,21,false],[0,21,true]]);
  assert.equal(data.roster[0].breakdown.find(s=>s.label==='ESPN stat 912')?.value,-14);
});

test('a future scheduled matchup does not show unplayed zeroes as scores', () => {
  const data=buildMatchup(meta,fixture(8,'UNDECIDED',{totalPoints:0,totalProjectedPoints:98},{totalPoints:0}),8,1);
  assert.equal(data.state,'Upcoming');
  assert.equal(data.teamScore,null);
  assert.equal(data.opponentScore,null);
  assert.equal(data.projection,98);
  assert.deepEqual(data.roster,[]);
});

test('two-week playoff rounds use the selected weekly score, not the combined total', () => {
  const postseason={...meta,status:{...meta.status,latestScoringPeriod:13}};
  const box=fixture(9,'AWAY',{pointsByScoringPeriod:{9:101,10:98},totalPoints:199},{pointsByScoringPeriod:{9:95,10:110},totalPoints:205});
  const data=buildMatchup(postseason,box,10,2);
  assert.equal(data.multiweek,true);
  assert.equal(data.teamScore,110);
  assert.equal(data.opponentScore,98);
  assert.equal(data.state,'Won');
});

test('never uses a current roster for an unavailable historical lineup', () => {
  const box=fixture(6,'HOME',{totalPoints:100},{totalPoints:90});
  box.teams=teams.map(t=>({...t,roster:{entries:[player]}}));
  assert.deepEqual(buildMatchup(meta,box,6,1).roster,[]);
  assert.equal(buildMatchup(meta,box,6,1).state,'Won');
});

test('HTTP serves a no-cookie dashboard and rejects invalid request parameters', async t => {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  const homepage=await fetch(base);
  assert.equal(homepage.status,200);
  assert.equal(homepage.headers.has('set-cookie'),false);
  assert.match(await homepage.text(),/Game Day HQ/);
  assert.equal((await fetch(base+'/api/league?season=2026&league=wrong')).status,400);
  assert.equal((await fetch(base+'/api/nfl?season=2026&week=19')).status,400);
  assert.equal((await fetch(base+'/api/league',{method:'POST'})).status,405);
});
