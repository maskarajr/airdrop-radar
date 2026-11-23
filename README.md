# airdrop-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/maskarajr/airdrop-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/maskarajr/airdrop-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks protocols that record no token by an implied value taken only from the sealed snapshot. For each category it uses the median market-cap / TVL of protocols whose token already trades, after dropping non-positive ratios and clipping the 5th to 95th percentile, and it falls back to the global median when a category has fewer than five of those tokens. Growth, days listed with no token, chain breadth and size scale that multiple, and the page shows the low–high band from the 25th and 75th percentiles. Traded tokens stay off the board, in a comparables tab, and every ranked row has a farm plan that states a dollar cost and a time.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=9wr3p58r&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
