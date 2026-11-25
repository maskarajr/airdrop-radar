# airdrop-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/maskarajr/airdrop-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/maskarajr/airdrop-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks protocols that record no token by implied value: the market cap a held-out log-log TVL fit gives if a token launches, times one more week of 7-day change net of the snapshot median, times launch odds. Odds are a smoothed rate by years with no token, 7-day growth band, TVL band and category, scored on a held-out half. The board opens on a $10k deposit at a 7% drop share and labels each row FARM, MARGINAL or SKIP from net after gas, fees and a 4% T-bill. Plan size, $1k and $10k stay as controls; the rank and implied value do not change with the deposit.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=9wr3p58r&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
