# airdrop-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/maskarajr/airdrop-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/maskarajr/airdrop-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks protocols that record no token by implied value: the market cap a held-out log-log TVL fit gives if a token launches, times one more week of 7-day change net of the snapshot median, times launch odds. The board opens in rank order at a $10k deposit and 7% drop share, with held-out fit and odds evidence above the table. Each row is FARM, MARGINAL or SKIP from net after gas, fees and a 4% T-bill. Farm steps on the page size the deposit to the selected control; rank and implied value do not change with that control.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=9wr3p58r&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
