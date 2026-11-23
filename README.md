# airdrop-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/maskarajr/airdrop-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/maskarajr/airdrop-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks protocols that record no token by an implied value taken only from the sealed snapshot. The multiple is the median market-cap / TVL of protocols whose token already trades, after clipping the 5th to 95th percentile: the category median when it has at least five tokens, otherwise the playbook-family median, otherwise the global median. Growth, days listed with no token, chain breadth, size and the share of that category that already records a token scale the result. Traded tokens stay off the board, in a comparables tab, and every ranked row has a farm plan that names the action and the chain and states a dollar cost and a time.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=9wr3p58r&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
