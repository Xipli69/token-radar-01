# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Sigx69/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Sigx69/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Sonar is a token launch radar. It reads a sealed DefiLlama snapshot of 758 protocols and ranks every protocol that records no token by a peer-calibrated implied value: each category is priced at the median market-cap-to-TVL of its own traded peers in the same snapshot, adjusted for seven-day momentum, maturity and chain breadth. Every ranked protocol carries a concrete seven-step farm plan with costs and times, and the static dashboard renders the board, a per-protocol detail view with the full model breakdown, filters, a live-token view of the calibration set, and the calibration table itself.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=8hegad60&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
