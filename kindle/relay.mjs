import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { loadMatchup } from '../server.mjs';
import { demoBoard, demoWeek } from '../public/demo.js';

const ascii = (value, max) => String(value ?? '').normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[’‘]/g, "'").replace(/[–—]/g, '-')
  .replace(/[^\x20-\x7e]|\|/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const score = n => Number.isFinite(n) ? n.toFixed(2) : '--';

export function packet(board, week, { demo = false, now = new Date() } = {}) {
  const stamp = now.toISOString();
  return [
    'GDHQ1', demo ? 'DEMO' : 'LIVE', `Week ${week} / ${ascii(board.state, 24)}`,
    ascii(board.team, 60) || 'Your team', score(board.teamScore),
    ascii(board.opponent, 60) || 'No opponent', score(board.opponentScore),
    demo ? 'Sample data - no team linked' : `Updated ${stamp.slice(5, 10)} ${stamp.slice(11, 16)} UTC`,
    ...board.roster.filter(p => !p.bench).slice(0, 20)
      .map(p => [ascii(p.slot, 9), ascii(p.name, 42), score(p.actual)].join('|')),
  ].join('\n') + '\n';
}

export function relay({ season, league, team } = {}) {
  const demo = !league;
  return createServer(async (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, {
        'Content-Type': 'text/plain; charset=us-ascii', 'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      });
      res.end(body);
    };
    if (req.method !== 'GET' || req.url !== '/score') return reply(404, 'Not found\n');
    try {
      const { week, board } = demo ? { week: demoWeek, board: demoBoard(demoWeek) } : await loadMatchup(season, league, team);
      return reply(200, packet(board, week, { demo }));
    } catch (error) {
      console.error('Score feed:', error.message);
      return reply(503, 'Score feed unavailable\n');
    }
  });
}

function isPrivate(host) {
  const privateAddress = /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;
  return privateAddress.test(host) && host.split('.').length === 4 &&
    host.split('.').every(octet => /^\d{1,3}$/.test(octet) && Number(octet) <= 255);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values: opt } = parseArgs({ options: {
    host: { type: 'string', default: '127.0.0.1' }, port: { type: 'string', default: '8799' },
    season: { type: 'string' }, league: { type: 'string' }, team: { type: 'string' },
    'demo-packet': { type: 'boolean' },
  } });
  if (opt['demo-packet']) {
    process.stdout.write(packet(demoBoard(demoWeek), demoWeek, { demo: true }));
  } else {
    if (opt.host !== '127.0.0.1' && !isPrivate(opt.host)) throw new Error('Bind to a specific private IPv4 address, not the Internet.');
    if (!/^\d+$/.test(opt.port) || Number(opt.port) < 1 || Number(opt.port) > 65535) throw new Error('Invalid port.');
    if ([opt.season, opt.league, opt.team].some(Boolean) &&
      ![opt.season, opt.league, opt.team].every(x => /^\d+$/.test(x ?? ''))) {
      throw new Error('Provide --season, --league and --team as numeric values, or omit all three for demo mode.');
    }
    relay(opt).listen(Number(opt.port), opt.host, () => {
      console.log(`Game Day HQ Kindle relay: http://${opt.host}:${opt.port}/score (${opt.league ? 'live' : 'demo'})`);
    });
  }
}
