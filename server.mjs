import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const fantasy = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';
const nfl = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
const root = new URL('./public/', import.meta.url);
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/demo.js', ['demo.js', 'text/javascript; charset=utf-8']],
  ['/field.svg', ['field.svg', 'image/svg+xml']],
  ['/mark.svg', ['mark.svg', 'image/svg+xml']],
]);

class FeedError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const cache = new Map();
const pending = new Map();
async function getJSON(url, ttl = 24000) {
  const hit = cache.get(url);
  if (hit && hit.expiry > Date.now()) return hit.value;
  if (pending.has(url)) return pending.get(url);
  const task = (async () => {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(8500) });
      if ([401, 403].includes(res.status)) throw new FeedError(403, 'ESPN didn’t allow public access. Ask the league manager whether the league can be made viewable without a login.');
      if (res.status === 404) throw new FeedError(404, 'ESPN couldn’t find this league for that season. Check the league link and year.');
      if (!res.ok) throw new Error(`ESPN HTTP ${res.status}`);
      const value = await res.json();
      if (cache.size >= 48) cache.delete(cache.keys().next().value);
      cache.set(url, { value, expiry: Date.now() + ttl });
      return value;
    } catch (error) {
      if (error instanceof FeedError) throw error;
      throw new FeedError(502, 'ESPN is temporarily unavailable. Try again in a moment.');
    }
  })();
  pending.set(url, task);
  try { return await task; } finally { pending.delete(url); }
}

const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const txt = (v, fallback = '') => typeof v === 'string' && v.trim() ? v.trim().slice(0, 160) : fallback;
const int = (v, min, max, name) => {
  if (!/^\d+$/.test(String(v)) || Number(v) < min || Number(v) > max) throw new FeedError(400, `Enter a valid ${name}.`);
  return Number(v);
};
const seasonParam = v => int(v, 2018, 2100, 'season (2018–2100)');
const leagueParam = v => String(int(v, 1, 999999999999, 'league ID'));
const weekParam = v => int(v, 1, 18, 'NFL week (1–18)');
const path = (season, league) => `${fantasy}/seasons/${season}/segments/0/leagues/${league}`;
const nameOf = t => txt(t?.name, [txt(t?.location), txt(t?.nickname)].filter(Boolean).join(' ') || txt(t?.abbrev, t?.id ? `Team ${t.id}` : 'TBD'));
const recordOf = t => {
  const o = t?.record?.overall;
  return o ? `${o.wins ?? 0}–${o.losses ?? 0}${o.ties ? `–${o.ties}` : ''}` : '';
};
const clampWeek = w => Math.max(1, Math.min(18, w));

function leagueInfo(raw) {
  if (!Array.isArray(raw?.teams)) throw new FeedError(502, 'ESPN didn’t return a usable league or team list.');
  const periods = raw.settings?.scheduleSettings?.matchupPeriods ?? {};
  const status = raw.status ?? {};
  const current = clampWeek(number(status.latestScoringPeriod) || number(raw.scoringPeriodId) || 1);
  const lastWeek = clampWeek(number(status.finalScoringPeriod) || Math.max(0, ...Object.values(periods).flat().filter(Number.isInteger)) || 18);
  return {
    name: txt(raw.settings?.name, 'ESPN Fantasy Football'),
    currentWeek: Math.min(current, lastWeek), lastWeek,
    teams: raw.teams.map(t => ({ id: t.id, name: nameOf(t) })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

const slots = ['QB','TQB','RB','RB/WR','WR','WR/TE','TE','SUPERFLEX','DT','DE','LB','DL','CB','S','DB','DP','D/ST','K','P','HC','BN','IR','','FLEX','RES','Rookie'];
const positions = ['', 'QB', 'RB', 'WR', 'TE', 'K', '', 'P', '', 'DT', 'DE', 'LB', 'CB', 'S', 'HC', 'TQB', 'D/ST'];
const nflTeams = 'FA ATL BUF CHI CIN CLE DAL DEN DET GB TEN IND KC LV LAR MIA MIN NE NO NYG NYJ PHI ARI PIT LAC SF SEA TB WSH CAR JAX -- -- BAL HOU'.split(' ');
const statLabels = {
  0:'Pass attempts', 1:'Completions', 3:'Pass yards', 4:'Pass TD', 19:'Pass 2-pt', 20:'Interceptions thrown',
  23:'Carries', 24:'Rush yards', 25:'Rush TD', 26:'Rush 2-pt', 39:'Yards per carry',
  41:'Receptions', 42:'Receiving yards', 43:'Receiving TD', 44:'Receiving 2-pt', 58:'Targets', 59:'Yards after catch', 60:'Yards per catch',
  63:'Fumble recovery TD', 64:'Times sacked', 68:'Fumbles', 72:'Fumbles lost', 74:'FG made (50+)', 77:'FG made (40–49)',
  79:'FG missed (40–49)', 80:'FG made (0–39)', 82:'FG missed (0–39)', 83:'FG made', 84:'FG attempted', 85:'FG missed',
  86:'Extra points made', 88:'Extra points missed', 93:'Blocked-kick return TD', 94:'Defensive TD',
  95:'Defensive interceptions', 96:'Fumble recoveries', 97:'Blocked kicks', 98:'Safeties', 99:'Sacks',
  101:'Kickoff return TD', 102:'Punt return TD', 106:'Forced fumbles', 107:'Assisted tackles', 108:'Solo tackles', 109:'Tackles',
  120:'Points allowed', 127:'Yards allowed', 206:'Defensive 2-pt return', 214:'Made FG yards',
};

function rosterPlayer(entry, week) {
  const p = entry.playerPoolEntry?.player ?? {};
  const id = number(p.id) ?? number(entry.playerId);
  const slotId = entry.lineupSlotId;
  const stats = Array.isArray(p.stats) ? p.stats : [];
  const forWeek = stats.filter(s => s.scoringPeriodId === week && s.statSplitTypeId === 1);
  const actual = forWeek.find(s => s.statSourceId === 0);
  const projected = forWeek.find(s => s.statSourceId === 1);
  const lines = Object.entries(statLabels).flatMap(([key, label]) => {
    const v = number(actual?.stats?.[key]);
    return v === null ? [] : [{ label, value: v }];
  });
  // Keep every scoring contribution, including custom league stat categories.
  const breakdown = Object.entries(actual?.appliedStats ?? {}).flatMap(([key, v]) =>
    number(v) !== null && v !== 0 ? [{ label: statLabels[key] ?? `ESPN stat ${key}`, value: v }] : []);
  return {
    id, name: txt(p.fullName, txt(`${p.firstName ?? ''} ${p.lastName ?? ''}`, id ? `Player ${id}` : 'Open slot')),
    position: positions[p.defaultPositionId] || slots[slotId] || '', slot: slots[slotId] || '—', slotId,
    bench: [20, 21, 24, 25].includes(slotId), proTeam: nflTeams[actual?.proTeamId || p.proTeamId] || 'FA',
    injury: txt(entry.injuryStatus ?? p.injuryStatus).replaceAll('_', ' '),
    actual: number(actual?.appliedTotal), projected: number(projected?.appliedTotal), stats: lines, breakdown,
  };
}

export function buildMatchup(meta, raw, week, teamId) {
  const info = leagueInfo(meta);
  const teams = new Map((raw.teams ?? []).map(t => [t.id, t]));
  const team = teams.get(teamId) ?? meta.teams.find(t => t.id === teamId);
  if (!team) throw new FeedError(404, 'This team ID isn’t in that league for the selected season.');
  const periods = meta.settings?.scheduleSettings?.matchupPeriods ?? {};
  const period = Number(Object.keys(periods).find(id => Array.isArray(periods[id]) && periods[id].includes(week))) || week;
  const match = (raw.schedule ?? []).find(m => m.matchupPeriodId === period && (m.home?.teamId === teamId || m.away?.teamId === teamId));
  const isHome = match?.home?.teamId === teamId;
  const mine = isHome ? match?.home : match?.away;
  const theirs = isHome ? match?.away : match?.home;
  const opponent = theirs && (teams.get(theirs.teamId) ?? meta.teams.find(t => t.id === theirs.teamId) ?? { id: theirs.teamId });
  const isFinal = ['HOME', 'AWAY', 'TIE'].includes(match?.winner);
  const multiweek = (periods[period]?.length ?? 1) > 1;
  const total = side => {
    if (!side) return null;
    const posted = number(side.pointsByScoringPeriod?.[String(week)]);
    if (posted !== null) return posted;
    if (week > info.currentWeek) return null;
    if (!multiweek) return number(side.totalPointsLive) ?? (isFinal ? number(side.totalPoints) : null);
    return null; // Matchup totals aren't individual week scores in a two-week round.
  };
  const projected = side => !multiweek && side ? number(side.totalProjectedPointsLive) ?? number(side.totalProjectedPoints) : null;
  const getRoster = (side, t) => {
    const entries = side?.rosterForCurrentScoringPeriod?.entries ?? (week === info.currentWeek ? t?.roster?.entries : null);
    return (Array.isArray(entries) ? entries : []).map(e => rosterPlayer(e, week)).sort((a, b) => a.slotId - b.slotId);
  };
  let state;
  if (!match) state = 'No matchup';
  else if (!theirs) state = 'Bye';
  else if (isFinal) state = match.winner === 'TIE' ? 'Tied' : (isHome ? match.winner === 'HOME' : match.winner === 'AWAY') ? 'Won' : 'Lost';
  else state = week > info.currentWeek ? 'Upcoming' : week < info.currentWeek ? 'Week ended' : (total(mine) !== null || total(theirs) !== null) ? 'In progress' : 'Upcoming';
  return {
    league: info.name, team: nameOf(team), record: recordOf(team), opponent: opponent ? nameOf(opponent) : '',
    opponentRecord: opponent ? recordOf(opponent) : '', teamScore: total(mine), opponentScore: total(theirs),
    projection: projected(mine), opponentProjection: projected(theirs), state, multiweek,
    roster: getRoster(mine, team), opponentRoster: getRoster(theirs, opponent),
  };
}

function nflBoard(raw) {
  return {
    bye: (raw.week?.teamsOnBye ?? []).map(t => txt(t.abbreviation)),
    games: (raw.events ?? []).flatMap(e => {
      const c = e.competitions?.[0];
      const state = c?.status?.type?.state;
      const sides = c?.competitors?.slice().sort((a,b) => (a.homeAway === 'home') - (b.homeAway === 'home')) ?? [];
      if (sides.length !== 2) return [];
      return [{
        id: String(e.id), date: txt(c.date ?? e.date), state, status: txt(c.status?.type?.shortDetail),
        teams: sides.map(s => ({ code: txt(s.team?.abbreviation), name: txt(s.team?.shortDisplayName), score: state !== 'pre' ? txt(String(s.score ?? ''), '–') : '', winner: s.winner === true })),
      }];
    }).sort((a,b) => ({in:0, pre:1, post:2}[a.state] ?? 3) - ({in:0, pre:1, post:2}[b.state] ?? 3) || a.date.localeCompare(b.date)),
  };
}

const security = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' https://a.espncdn.com; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
};
function json(res, status, body, edge = false) {
  res.writeHead(status, { ...security, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    ...(edge ? { 'Vercel-CDN-Cache-Control': 'public, s-maxage=20' } : {}),
  });
  res.end(JSON.stringify(body));
}

export async function handleRequest(req, res, route) {
  try {
    if (req.method !== 'GET') throw new FeedError(405, 'This dashboard is read-only.');
    const url = new URL(req.url, 'http://localhost');
    const pathname = route ?? url.pathname, q = url.searchParams;
    if (files.has(pathname)) {
      const [name, type] = files.get(pathname);
      const body = await readFile(new URL(name, root));
      res.writeHead(200, { ...security, 'Content-Type': type, 'Cache-Control': 'no-cache' });
      res.end(body);
      return;
    }
    if (pathname === '/api/nfl') {
      const season = seasonParam(q.get('season')), week = weekParam(q.get('week'));
      const feed = await getJSON(`${nfl}?dates=${season}&seasontype=2&week=${week}`);
      return json(res, 200, nflBoard(feed), true);
    }
    if (pathname === '/api/league' || pathname === '/api/matchup') {
      const league = leagueParam(q.get('league')), season = seasonParam(q.get('season'));
      const base = path(season, league);
      const meta = await getJSON(`${base}?view=mSettings&view=mTeam`);
      const info = leagueInfo(meta);
      if (pathname === '/api/league') return json(res, 200, info, true);
      const team = int(q.get('team'), 1, 99999, 'team ID'), week = weekParam(q.get('week'));
      if (!info.teams.some(t => t.id === team)) throw new FeedError(404, 'This team ID isn’t in that league for the selected season.');
      const periods = meta.settings?.scheduleSettings?.matchupPeriods ?? {};
      const period = Number(Object.keys(periods).find(id => Array.isArray(periods[id]) && periods[id].includes(week))) || week;
      const box = await getJSON(`${base}?view=mTeam&view=mRoster&view=mMatchupScore&view=mBoxscore&scoringPeriodId=${week}&matchupPeriodId=${period}`);
      return json(res, 200, buildMatchup(meta, box, week, team), true);
    }
    throw new FeedError(404, 'That page doesn’t exist.');
  } catch (error) {
    if (!(error instanceof FeedError)) console.error(error);
    json(res, error.status || 500, { error: error.status ? error.message : 'Something went wrong on the dashboard server.' });
  }
}

export const server = createServer(handleRequest);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? 8787);
  server.listen(port, host, () => console.log(`Fantasy HQ listening on http://${host}:${server.address().port}`));
}
