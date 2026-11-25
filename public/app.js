import { demoBoard, demoGames, demoWeek } from './demo.js';

const $ = id => document.getElementById(id);
const html = (id, value) => { const el = $(id); if (el._markup !== value) { el.innerHTML = value; el._markup = value; } };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const icon = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
html('settings-icon', icon('<circle cx="12" cy="12" r="3"/><path d="m10 3-.8 2.6-2 .9-2.5-.8-1.5 2.6 1.9 1.8v2.8l-1.9 1.8 1.5 2.6 2.5-.8 2 .9.8 2.6h3l.8-2.6 2-.9 2.5.8 1.5-2.6-1.9-1.8v-2.8l1.9-1.8-1.5-2.6-2.5.8-2-.9L13 3z"/>'));
html('bolt-icon', icon('<path d="m13 2-8 12h6l-1 8 9-12h-6z"/>'));
html('nfl-icon', icon('<path d="M20.4 3.6C13 2.5 7.9 4.3 5.4 7.1 2.9 9.9 2.7 15 3.6 20.4c7.4 1.1 12.5-.7 15-3.5 2.5-2.8 2.7-7.9 1.8-13.3Z"/><path d="m9 15 6-6m-6 2 4 4m-2-6 4 4"/>'));

const key = 'game-day-hq.teams.v2';
const legacyKey = 'game-day-hq.teams.v1';
const guessSeason = () => new Date().getFullYear() - (new Date().getMonth() < 3 ? 1 : 0);
const isScore = v => typeof v === 'number' && Number.isFinite(v);
const score = v => isScore(v) ? v.toFixed(2) : '—';
const statValue = v => Number.isInteger(v) ? String(v) : score(v);
const initials = text => (String(text ?? '').match(/[\p{L}\p{N}]+/gu) ?? []).slice(0,2).map(x=>[...x][0]).join('').toUpperCase() || '–';
const fmtTime = new Intl.DateTimeFormat(undefined, { hour:'numeric', minute:'2-digit' });
const fmtGame = new Intl.DateTimeFormat(undefined, { weekday:'short', hour:'numeric', minute:'2-digit' });
const safeDate = str => Number.isNaN(Date.parse(str)) ? null : new Date(str);
const tag = (text, tone = '', dot = false) => `<span class="tag ${tone}">${dot ? '<i class="dot"></i>' : ''}${esc(text)}</span>`;
const teamKey = t => t ? `${t.season}/${t.league}/${t.team}` : '';
let prefs = { active:'', teams:[] };
const activeTeam = () => prefs.teams.find(t => teamKey(t) === prefs.active);
const demo = () => !activeTeam();
let currentWeek = demoWeek, pinnedWeek = null, activeWeek = demoWeek;
let matchup = {}, nfl = { games:[], bye:[] }, nflError = '', sync = 0, side = 'roster';
let ticket = 0, busy = false, timer = 0, configNotice = '', rosterContext = '';
let netSignal, nflByTeam = new Map();
const weekCache = new Map();

async function api(path, params, signal) {
  const qs = params ? '?' + new URLSearchParams(params) : '';
  const res = await fetch(`/api/${path}${qs}`, { credentials:'omit', signal });
  const value = await res.json().catch(() => null);
  if (!res.ok || !value) throw new Error(value?.error ?? 'Couldn’t reach the scoreboard. Try again in a moment.');
  return value;
}

function loadLocal() {
  const valid = t => t && Number.isInteger(t.season) && t.season >= 2018 && t.season <= 2100
    && /^[1-9]\d{0,11}$/.test(t.league) && Number.isInteger(t.team) && t.team > 0 && t.team <= 99999;
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (Array.isArray(saved?.teams)) {
      const teams = saved.teams.filter(valid);
      return { teams, active:teams.some(t => teamKey(t) === saved.active) ? saved.active : '' };
    }
    const legacy = JSON.parse(localStorage.getItem(legacyKey));
    if (Array.isArray(legacy?.teams)) {
      const teams = legacy.teams.map(t => ({ ...t, season:legacy.season, name:t?.label })).filter(valid);
      const migrated = { teams, active:teamKey(teams[0]) };
      try { localStorage.setItem(key, JSON.stringify(migrated)); } catch { /* use migrated values for this visit */ }
      return migrated;
    }
  } catch { /* the board still works when storage is unavailable */ }
  return prefs;
}

function start(next) {
  prefs = next;
  weekCache.clear();
  currentWeek = demo() ? demoWeek : null; pinnedWeek = null; activeWeek = currentWeek;
  side = 'roster'; $('filter').value = 'all'; sync = 0; matchup = {}; nfl = {games:[],bye:[]}; nflError = '';
  refresh();
}

function savePrefs(next) {
  try { localStorage.setItem(key, JSON.stringify(next)); configNotice = ''; }
  catch { configNotice = 'Browser storage is unavailable. Your team choices may not survive a reload.'; }
  if ($('settings').open) $('settings').close();
  start(next);
}

function chooseWeek(value) {
  pinnedWeek = value === '' || Number(value) === currentWeek ? null : Number(value);
  refresh();
}

function setTimer() {
  clearTimeout(timer);
  if (!demo() && !document.hidden) timer = setTimeout(refresh, pinnedWeek !== null && pinnedWeek < currentWeek ? 120000 : 30000);
}

async function refresh() {
  const token = ++ticket;
  clearTimeout(timer);
  netSignal?.abort();
  netSignal = new AbortController();
  const { signal } = netSignal;
  activeWeek = pinnedWeek ?? currentWeek;
  const tracked = activeTeam();
  if (!tracked) {
    matchup = { data:demoBoard(activeWeek) };
    nfl = demoGames(activeWeek); nflError = ''; busy = false;
    render(); return;
  }

  const cachedAt = week => weekCache.get(week) ?? { matchup:{}, nfl:{games:[],bye:[]}, sync:0 };
  ({ matchup, nfl, sync } = cachedAt(activeWeek));
  nflError = ''; busy = true; render();
  const { season, league, team, name } = tracked;
  let leagueError, reportedWeek;
  try { reportedWeek = (await api('league', { league, season }, signal)).currentWeek; }
  catch (e) { leagueError = e.message; }
  if (token !== ticket) return;
  currentWeek = reportedWeek ?? currentWeek;
  activeWeek = pinnedWeek ?? currentWeek;
  const prev = cachedAt(activeWeek);
  const nflTask = activeWeek ? api('nfl', { season, week:activeWeek }, signal).then(value=>({ value }), e=>({ value:prev.nfl, error:e.message })) : Promise.resolve({ value:prev.nfl });
  const details = activeWeek ? api('matchup', { league, team, season, week:activeWeek }, signal).then(
    data=>({ data }), e=>({ data:prev.matchup.data, error:e.message }),
  ) : Promise.resolve({ error:leagueError ?? 'Waiting for ESPN to publish a scoring week.' });
  const [nextMatchup, nextNFL] = await Promise.all([details, nflTask]);
  if (token !== ticket) return;
  matchup = nextMatchup; nfl = nextNFL.value; nflError = nextNFL.error ?? '';
  sync = matchup.error ? prev.sync : Date.now();
  weekCache.set(activeWeek, { matchup, nfl, sync });
  if (matchup.data?.team && name !== matchup.data.team) {
    prefs = { ...prefs, teams:prefs.teams.map(t => t === tracked ? { ...t, name:matchup.data.team } : t) };
    try { localStorage.setItem(key, JSON.stringify(prefs)); } catch { /* no effect on viewing */ }
  }
  busy = false; render(); setTimer();
}

function renderWeek() {
  const list = [`<option value="">${currentWeek ? `Week ${currentWeek} · Now` : 'Current week'}</option>`];
  for (let i=1;i<=18;i++) if (i !== currentWeek || pinnedWeek === i) list.push(`<option value="${i}">Week ${i}</option>`);
  html('week', list.join('')); $('week').value = pinnedWeek ?? '';
  $('prev').disabled = !activeWeek || activeWeek <= 1; $('next').disabled = !activeWeek || activeWeek >= 18;
  $('refresh').disabled = demo() || busy;
}

function renderNotice() {
  const unavailable = !demo() && (matchup.error || nflError);
  html('feed-status', demo() ? '<i class="dot demo"></i> Demo mode' : busy ? '<i class="dot demo"></i> Updating…' : unavailable ? '<i class="dot warn"></i> Feed issue' : '<i class="dot"></i> Auto-refresh on');
  const demoNote = 'You’re viewing a sample matchup. Connect your ESPN team to make this board yours.';
  const banner = configNotice || (demo() ? demoNote : '');
  html('notice', banner ? `<span>${esc(banner)}</span>${demo() ? '<button type="button" id="connect">Connect my team →</button>' : ''}` : '');
  $('footer-note').textContent = demo() ? 'Sample data · Live mode uses ESPN’s public feeds' : `${activeTeam()?.season} season · ${sync ? `Checked ${fmtTime.format(sync)} · ` : ''}Unofficial ESPN data`;
}

function renderTeamSwitch() {
  const show = prefs.teams.length > 1 || (demo() && prefs.teams.length > 0);
  $('team-switch').hidden = !show;
  if (!show) return;
  html('team-switch', (demo() ? '<option value="">Demo · Select a team</option>' : '') + prefs.teams.map(t =>
    `<option value="${esc(teamKey(t))}">${esc(t.name || `Team ${t.team}`)} · ${t.season}</option>`).join(''));
  $('team-switch').value = prefs.active;
}

function teamRow(name, record, points, away) {
  return `<span class="team-row"><span class="team-badge ${away ? 'away' : ''}" aria-hidden="true">${esc(initials(name))}</span><span class="team-text">${esc(name)}${record ? `<small>${esc(record)} season record</small>` : ''}</span><span class="score ${away ? 'away' : ''}">${score(points)}</span></span>`;
}

function renderMatchup() {
  const d = matchup.data;
  if (!d) {
    html('matchup-card', `<article class="card missing"><header class="card-head"><span class="owner">${esc(activeTeam()?.name || 'ESPN Fantasy Football')}</span>${tag(matchup.error ? 'Unavailable' : 'Loading')}</header><p class="card-msg">${esc(matchup.error ?? 'Fetching the matchup from ESPN…')}</p></article>`);
    return;
  }
  const diff = isScore(d.teamScore) && isScore(d.opponentScore) ? Math.round((d.teamScore-d.opponentScore)*100)/100 : null;
  const during = d.state === 'In progress';
  const winning = d.state === 'Won' || (during && diff > 0);
  const losing = d.state === 'Lost' || (during && diff < 0);
  const status = during && diff !== null ? (winning ? 'Leading' : losing ? 'Trailing' : 'Tied so far') : d.state;
  const extra = matchup.error ? 'Last available scores' : d.multiweek ? 'Weekly points · multi-week round' : diff !== null && diff !== 0 ? `${score(Math.abs(diff))} pt difference` : isScore(d.projection) && !isScore(d.teamScore) ? `Projected ${score(d.projection)} pts` : `Week ${activeWeek}`;
  html('matchup-card', `<article class="card"><header class="card-head"><span class="owner">${esc(d.league)}</span>${tag(matchup.error ? 'Stale' : status, matchup.error ? '' : winning ? 'pos' : losing ? 'neg' : '', during && !matchup.error)}</header><div class="matchup-sides">${teamRow(d.team,d.record,d.teamScore,false)}<span class="matchup-vs" aria-hidden="true">VS</span>${teamRow(d.opponent || (d.state === 'Bye' ? 'Bye week' : 'No opponent listed'),d.opponentRecord,d.opponentScore,true)}</div><footer class="card-foot"><span>${esc(extra)}</span><a class="card-cta" href="#lineup">View lineup <b aria-hidden="true">›</b></a></footer></article>`);
}

function avatar(p) {
  const useImage = Number.isInteger(p.id) && p.id > 0 && p.position !== 'TQB';
  return `<span class="athlete-img" aria-hidden="true">${esc(initials(p.name))}${useImage ? `<img src="https://a.espncdn.com/i/headshots/nfl/players/full/${p.id}.png" width="30" height="30" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</span>`;
}

function gameLabel(game) {
  const date = safeDate(game.date);
  return game.state === 'pre' && date ? fmtGame.format(date) : game.status || 'Scheduled';
}

function statRows(rows, signs = false) {
  return `<div class="stat-grid">${rows.map(r => `<span class="stat-item"><span>${esc(r.label)}</span><b>${signs && r.value>0 ? '+' : ''}${esc(statValue(r.value))}</b></span>`).join('')}</div>`;
}

function renderRoster() {
  const item = matchup;
  const data = item.data;
  if (data && !data.opponent) side = 'roster';
  const label = side === 'roster' ? data?.team : data?.opponent;
  $('lineup-team').textContent = data ? [label || 'No opponent', data.league, activeWeek ? `Week ${activeWeek}` : '', item.error ? 'Last available' : ''].filter(Boolean).join(' · ') : 'Waiting for matchup data.';
  $('filter').disabled = !data;
  for (const b of $('side').querySelectorAll('button')) {
    b.disabled = !data || (b.dataset.side === 'opponentRoster' && !data.opponent);
    b.setAttribute('aria-pressed', String(b.dataset.side === side));
  }
  const filter = $('filter').value;
  const players = (data?.[side] ?? []).filter(p => filter === 'all' || (filter === 'bench' ? p.bench : !p.bench));
  if (!players.length) {
    const reason = item?.error ?? (!data ? 'Waiting for matchup data.' : data[side]?.length ? 'No players in this filter.' : 'ESPN hasn’t provided a lineup for this team and week.');
    html('roster', `<p class="empty">${esc(reason)}</p>`); return;
  }
  const context = `${prefs.active}/${side}/${activeWeek}`;
  const sameRoster = context === rosterContext;
  const open = sameRoster ? new Set([...$('roster').querySelectorAll('details[open]')].map(e=>e.dataset.key)) : new Set();
  const focused = sameRoster && $('roster').contains(document.activeElement) ? document.activeElement.closest('details')?.dataset.key : null;
  rosterContext = context;
  const markup = `<div class="table-head" aria-hidden="true"><span>Slot</span><span>Player</span><span>NFL game</span><span class="numeric" title="Projected">Proj</span><span class="numeric">Points</span></div>` + players.map((p,i) => {
    const game = nflByTeam.get(p.proTeam);
    const other = game?.teams.find(t=>t.code!==p.proTeam)?.code;
    const time = game ? gameLabel(game) : nfl.bye.includes(p.proTeam) ? 'Bye week' : '—';
    const id = `${p.id ?? i}-${p.slot}`;
    const hurt = p.injury && !['ACTIVE','NORMAL','HEALTHY'].includes(p.injury);
    const statBlock = p.stats?.length ? statRows(p.stats) : '<p>No box score stats posted yet.</p>';
    const points = p.breakdown?.length ? `<strong class="points-title">How they scored fantasy points</strong>${statRows(p.breakdown,true)}` : '';
    return `<details class="player" data-key="${esc(id)}"${open.has(id) ? ' open' : ''}><summary><span class="slot${p.bench ? ' reserve' : ''}">${esc(p.slot)}</span><span class="athlete">${avatar(p)}<span class="athlete-copy"><strong>${esc(p.name)}</strong><span class="minor">${esc([p.position,p.proTeam].filter(Boolean).join(' · '))}${hurt ? ` <b class="injury">· ${esc(p.injury)}</b>` : ''}</span></span></span><span class="game-status ${game?.state==='in' ? 'live' : ''}">${esc(time)}${other ? `<span class="minor">${game.teams[0].code === p.proTeam ? '@' : 'vs'} ${esc(other)}</span>` : ''}</span><span class="projection numeric" aria-label="Projected: ${score(p.projected)}">${score(p.projected)}</span><span class="actual numeric" aria-label="Points: ${score(p.actual)}">${score(p.actual)}</span></summary><div class="detail-content"><strong>Week ${activeWeek} box score</strong>${statBlock}${points}</div></details>`;
  }).join('');
  html('roster', markup);
  if (focused) [...$('roster').querySelectorAll('details')].find(el=>el.dataset.key===focused)?.querySelector('summary')?.focus({preventScroll:true});
}

function renderLeaders() {
  const leaders = (matchup.data?.roster ?? []).filter(p => !p.bench && isScore(p.actual)).sort((a,b)=>b.actual-a.actual).slice(0,3);
  html('leaders', leaders.length ? `<div class="leader-list"><p class="leaders-caption">Top-scoring starters on your team</p>${leaders.map((p,i)=>`<div class="leader"><span class="rank">0${i+1}</span>${avatar(p)}<span class="athlete-copy"><strong>${esc(p.name)}</strong><span class="minor">${esc([p.position,p.proTeam].filter(Boolean).join(' · '))}</span></span><span class="leader-points">${score(p.actual)} <small>PTS</small></span></div>`).join('')}</div>` : '<p class="empty">The top scorers will show up once points come in.</p>');
}

function renderGames() {
  const draw = g => `<div class="nfl-game"><div class="game-name">${g.teams.map(t=>esc(t.code)).join('<span> vs </span>')}${g.state !== 'pre' ? ` <span>·</span> ${g.teams.map(t=>esc(t.score)).join('–')}` : ''}</div><div class="game-time ${g.state === 'in' ? 'live' : ''}">${esc(gameLabel(g))}</div></div>`;
  const open = $('games').querySelector('details')?.open;
  const note = nflError ? `<p class="feed-note">${esc(nfl.games.length ? 'Showing the last available NFL scores.' : nflError)}</p>` : '';
  html('games', nfl.games.length ? `<div class="game-list">${nfl.games.slice(0,4).map(draw).join('')}${nfl.games.length > 4 ? `<details class="all-games"${open ? ' open' : ''}><summary>${nfl.games.length - 4} more games</summary>${nfl.games.slice(4).map(draw).join('')}</details>` : ''}</div>${note}` : `<p class="empty">${busy ? 'Checking the NFL schedule…' : 'No NFL games to show for this week.'}</p>${note}`);
}

function render() {
  nflByTeam = new Map(nfl.games.flatMap(g => g.teams.map(t=>[t.code,g])));
  renderTeamSwitch(); renderWeek(); renderNotice(); renderMatchup(); renderRoster(); renderLeaders(); renderGames();
}

const dialog = $('settings');
let dialogEpoch = 0;
const teamInput = $('team-link'), picker = $('team-picker'), loadButton = $('load-teams');

function espnLink(team) {
  return team ? `https://fantasy.espn.com/football/team?leagueId=${team.league}&teamId=${team.team}&seasonId=${team.season}` : '';
}

function parseLink(value) {
  const s = value.trim();
  if (/^\d{1,12}$/.test(s) && Number(s) > 0) return { league:String(Number(s)) };
  try {
    const url = new URL(s);
    if (url.hostname !== 'fantasy.espn.com' || !['https:','http:'].includes(url.protocol) || !url.pathname.startsWith('/football/')) throw new Error();
    const league = url.searchParams.get('leagueId');
    const id = url.searchParams.get('teamId');
    if (!/^\d{1,12}$/.test(league) || Number(league) === 0) throw new Error();
    return { league:String(Number(league)), team:/^\d{1,5}$/.test(id) ? Number(id) : undefined, season:Number(url.searchParams.get('seasonId')) || undefined };
  } catch { throw new Error('Paste an ESPN Fantasy Football link with a leagueId, or enter the numeric league ID.'); }
}

function formSeason() {
  const season = Number($('season').value);
  if (!Number.isInteger(season) || season < 2018 || season > 2100) throw new Error('Choose a valid NFL season (2018–2100).');
  return season;
}

function markField(message, success = false) {
  $('lookup-msg').textContent = message;
  $('lookup-msg').classList.toggle('ok', success);
}

function resetField() {
  dialogEpoch++;
  delete picker.dataset.lookup;
  picker.innerHTML = '<option value="">Load public teams first</option>';
  picker.disabled = true; loadButton.disabled = false;
  $('setup-error').textContent = '';
  markField('');
}

async function lookup() {
  const input = teamInput.value;
  resetField();
  const epoch = dialogEpoch;
  loadButton.disabled = true;
  markField('Checking public access…', true);
  const same = () => dialog.open && epoch === dialogEpoch;
  try {
    const { league, team, season:inLink } = parseLink(input);
    if (inLink) $('season').value = inLink;
    const season = formSeason();
    const data = await api('league', { league, season });
    if (!same()) return;
    if (!data.teams.length) throw new Error('There are no teams listed in this league yet.');
    picker.innerHTML = '<option value="">Choose a team</option>' + data.teams.map(t => `<option value="${Number(t.id)}">${esc(t.name)}</option>`).join('');
    picker.disabled = false;
    picker.dataset.lookup = `${season}/${league}`;
    if (team && data.teams.some(t=>t.id === team)) picker.value = String(team);
    markField(`${data.name} · ${data.teams.length} teams · Public`, true);
  } catch (e) {
    if (same()) markField(e.message);
  } finally { if (same()) loadButton.disabled = false; }
}

function openSetup() {
  if (dialog.open) return;
  resetField();
  const team = activeTeam();
  $('season').value = team?.season ?? guessSeason();
  $('setup-error').textContent = '';
  $('copy-team').hidden = !team;
  teamInput.value = '';
  dialog.showModal();
  teamInput.focus();
}

$('next').addEventListener('click',()=>chooseWeek(activeWeek+1));
$('prev').addEventListener('click',()=>chooseWeek(activeWeek-1));
$('week').addEventListener('change',e=>chooseWeek(e.target.value));
$('refresh').addEventListener('click',refresh);
$('setup-open').addEventListener('click',openSetup);
$('notice').addEventListener('click',e=>{ if (e.target.id==='connect') openSetup(); });
$('setup-close').addEventListener('click',()=>dialog.close());
$('use-demo').addEventListener('click',()=>savePrefs({ ...prefs, active:'' }));
$('copy-team').addEventListener('click', async () => {
  const link = espnLink(activeTeam());
  if (!link) return;
  try { await navigator.clipboard.writeText(link); markField('Current ESPN team link copied.', true); }
  catch { teamInput.value = link; resetField(); teamInput.select(); markField('Copy the selected ESPN link to use it in another browser.', true); }
});
$('season').addEventListener('input',resetField);
teamInput.addEventListener('input',resetField);
loadButton.addEventListener('click',lookup);
$('team-switch').addEventListener('change',e=>{
  if (prefs.teams.some(t => teamKey(t) === e.target.value)) savePrefs({ ...prefs, active:e.target.value });
});
$('team-form').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const { league } = parseLink(teamInput.value);
    if (picker.disabled && !loadButton.disabled) { await lookup(); return; }
    const season = formSeason();
    if (picker.dataset.lookup !== `${season}/${league}` || !/^[1-9]\d*$/.test(picker.value)) throw new Error('Load the teams and choose a fantasy team.');
    const picked = { season, league, team:Number(picker.value), name:picker.selectedOptions[0].text };
    const active = teamKey(picked);
    const exists = prefs.teams.some(t => teamKey(t) === active);
    const teams = exists ? prefs.teams.map(t => teamKey(t) === active ? picked : t) : [...prefs.teams,picked];
    savePrefs({ teams, active });
  } catch (e) { $('setup-error').textContent = e.message; }
});
$('side').addEventListener('click', e => { if (e.target.dataset.side) { side = e.target.dataset.side; renderRoster(); } });
$('filter').addEventListener('change',renderRoster);
$('roster').addEventListener('error', hideImage, true);
$('leaders').addEventListener('error', hideImage, true);
function hideImage(e) { if (e.target instanceof HTMLImageElement) e.target.hidden = true; }
document.addEventListener('visibilitychange',()=>{ if (!demo() && !document.hidden && !busy) refresh(); else clearTimeout(timer); });
window.addEventListener('online',()=>{ if (!demo()) refresh(); });

start(loadLocal());
