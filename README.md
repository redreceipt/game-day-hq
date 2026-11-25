# Game Day HQ

A read-only ESPN Fantasy Football scoreboard that displays **one team at a time**. It opens with a sample matchup until you choose a team.

- Weekly matchup scores, season records, and previews of upcoming matchups.
- Your starters, bench and IR, the opponent’s lineup, and expandable player stats and fantasy-point breakdowns when ESPN provides them.
- Top-scoring starters, NFL kickoff times and scores, and automatic updates about every 30 seconds while the page is visible (every two minutes for older weeks). The default week follows ESPN.

## Set up a team

1. Click **Change team** and paste a public ESPN Fantasy Football team or league link. If it has no season in the URL, use the season field.
2. Click **Load teams**, then confirm the team and choose **Show team**.
3. When you’ve picked more than one team, use the drop-down at the top to switch between them. It still shows only one matchup at a time.

Team choices and the active team live in the current browser’s `localStorage`. There are no cookies, user accounts, or server-side saved team lists. The Vercel functions receive the public league and team IDs to fetch ESPN scores, not the saved list. A new browser or website address starts with demo data; use **Change team → Copy current ESPN link** on the original address if you want to quickly add that team at a new address. Local settings from the older three-card dashboard are migrated on the same address.

If ESPN denies access, check the link and season, then ask the league manager whether they want to allow public viewing. The app never asks for an ESPN login, password, or session cookie. Scores depend on ESPN's unofficial public feeds, and available weeks and stats may vary by league.

## Kindle Keyboard

[Game Day HQ for Kindle](kindle/README.md) is a separate native e-ink app with physical-key controls and a home Wi-Fi relay. It does not use a browser.

## Run and deploy

Use Node.js 22 or newer; there are no npm dependencies.

```sh
npm start                 # http://localhost:8787
npm test
npx vercel dev --local     # optional local Vercel preview
```

The static files are in `public/`; the small functions in `api/` use the same ESPN feed logic as the local server. Deploy to Vercel as an **Other** framework project. No environment variables are needed. Keep the production URL publicly accessible if you want viewers to open it without a login.
