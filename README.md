# airdrop-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/maskarajr/airdrop-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/maskarajr/airdrop-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks protocols that record no token by implied value: the market cap a held-out log-log TVL fit gives if a token launches, times one more week of 7-day change net of the snapshot median, times launch odds. Odds are a smoothed rate by years with no token, 7-day growth band, TVL band and category, scored on a held-out half. A farm row's modelled drop is that implied value times a drop share times the deposit's slice of TVL. Net subtracts gas, fees and a 4% T-bill over the hold. FARM means net above zero and at least $25 an hour of the plan's stated work. The board opens on a $10,000 deposit, and Farm next lists the three FARM rows with the highest net per hour at that size.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=9wr3p58r&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
