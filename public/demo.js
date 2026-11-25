export const demoWeek = 11;
const sample = [[3918298,'Josh Allen','BUF','QB',26.84,24.31],[4427366,'Jahmyr Gibbs','DET','RB',21.70,21.02],[4241457,'James Cook','BUF','RB',12.60,15.26],[4372016,'Justin Jefferson','MIN','WR',19.30,18.12],[4426502,'Puka Nacua','LAR','WR',17.50,19.48],[4430027,'Trey McBride','ARI','TE',14.50,14.14],[4366031,'DeVonta Smith','PHI','WR',6.00,12.59],[3055899,'Brandon Aubrey','DAL','K',null,10.20],[-16033,'Ravens D/ST','BAL','D/ST',null,7.10],[4429160,'Kenneth Walker III','SEA','RB',8.90,13.75],[4360939,'Jaylen Waddle','MIA','WR',9.40,12.34]];

export function demoBoard(week) {
  const future = week > demoWeek;
  const final = week < demoWeek;
  const roster = sample.map(([id,name,proTeam,position,actual,projected], j) => {
    const points = future ? null : week === demoWeek ? actual : Math.max(0, (actual ?? projected) + ((week * 3 + j * 2) % 11 - 5));
    const yards = position === 'QB' ? { label: 'Pass yards', value: Math.round((points ?? 0) * 9) } : position === 'RB' ? { label: 'Rush yards', value: Math.round((points ?? 0) * 3.7) } : ['WR','TE'].includes(position) ? { label: 'Receiving yards', value: Math.round((points ?? 0) * 4.2) } : null;
    return {
      id,name,position,proTeam, actual:points, projected, bench:j > 8, slot:j > 8 ? 'BN' : j === 6 ? 'FLEX' : position,
      stats:points !== null && yards ? [yards,...(position === 'QB' ? [{label:'Pass TD',value:points > 20 ? 3 : 1}] : ['WR','TE'].includes(position) ? [{label:'Receptions',value:Math.round(points / 2.6)}] : [])] : [], breakdown:[],
    };
  });
  const teamScore = future ? null : roster.filter(p => !p.bench).reduce((n,p) => n + (p.actual ?? 0),0);
  const opponentScore = future ? null : week === demoWeek ? 103.28 : teamScore + ((week * 2) % 23 - 12);
  const state = future ? 'Upcoming' : final ? (teamScore > opponentScore ? 'Won' : teamScore < opponentScore ? 'Lost' : 'Tied') : 'In progress';
  const opponentRoster = [
    [4432577,'Jayden Daniels','WSH','QB',18.28,22.11],[3117251,'Christian McCaffrey','SF','RB',24.60,21.56],
    [4429795,'Kyren Williams','LAR','RB',12.10,16.12],[4429615,'Garrett Wilson','NYJ','WR',10.70,14.13],
    [4595348,'Malik Nabers','NYG','WR',13.80,16.27],[4360569,'Jake Ferguson','DAL','TE',null,8.12],
    [4372414,'Jaylen Warren','PIT','RB',7.90,10.56],[3124679,'Jake Elliott','PHI','K',7.00,7.22],
    [-16017,'Patriots D/ST','NE','D/ST',8.90,8.12],
  ].map(([id,name,proTeam,position,points,projected],j) => ({
    id,name,proTeam,position,projected,actual:future ? null : week === demoWeek ? points : Number((opponentScore/9).toFixed(2)),
    slot:j === 6 ? 'FLEX' : position,bench:false,stats:[],breakdown:[],
  }));
  return { team:'Sunday Scaries', league:'Sunday Showdown', opponent:'Gridiron Ghosts', record:'7–3', opponentRecord:'5–5', teamScore, opponentScore, projection:roster.filter(p=>!p.bench).reduce((n,p)=>n+p.projected,0), opponentProjection:125.17, state, roster, opponentRoster };
}

export function demoGames(week) {
  return { bye: ['ATL','CLE'], games: [
    ['BUF','MIA',24,17,'in','Q3 · 5:42'], ['DET','MIN',21,14,'in','Q3 · 9:18'], ['LAR','SEA',17,20,'in','Q4 · 11:06'], ['PHI','NYG',27,13,'post','Final'], ['SF','ARI',28,24,'post','Final'], ['KC','DEN',23,16,'post','Final'], ['DAL','WSH',0,0,'pre',''], ['BAL','PIT',0,0,'pre',''],
  ].map(([away,home,a,h,state,status],i) => ({
    id:String(i), date:new Date(Date.UTC(2025,8,7 + (week - 1)*7, i < 7 ? 21 : 23,25)).toISOString(),
    state:week > demoWeek ? 'pre' : week < demoWeek ? 'post' : state, status:week < demoWeek ? 'Final' : status,
    teams:[{code:away,score:String(a || 17)},{code:home,score:String(h || 20)}],
  })) };
}
