# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/thelebrc/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/thelebrc/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token launch radar (model radar-2): 200 pre-token protocols ranked by implied value from the snapshot's own figures — dampened TVL, asymmetric 7-day growth, an overdue factor for age with no token, and chain breadth — with a concrete farm plan (cost and time per step) for each. The 40-protocol watchlist is fully covered, plus 160 early pre-token protocols below the $50M floor. Live-token protocols are set aside with their market caps, never mixed into the ranking. The dashboard is searchable, filterable by category and chain, sortable, has a per-protocol detail view with a full model breakdown, and a live model sandbox that re-ranks the board in the page.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Requires Node.js 22.18 or later. The program reads the sealed snapshot, writes the ranked board to `out/board.json`, the dashboard data to `out/data.js`, and copies `dashboard/` and `screenshots/` plus `out/dossier.json` into `out/`.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
