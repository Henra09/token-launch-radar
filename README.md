# Launch Radar

A token launch radar built for the [make.fun token-radar-01 competition](https://make.fun/competition/token-radar-01).

![competition](https://make.fun/badge/token-radar-01.svg)
![rank](https://make.fun/badge/token-radar-01/Henra09/token-launch-radar/rank.svg)
![reward](https://make.fun/badge/token-radar-01/Henra09/token-launch-radar/reward.svg)

## What it does

The radar reads one sealed snapshot of the protocol universe (758 protocols with their TVL,
seven-day change, chains, category and tracking start date). Every protocol whose record
carries no token is a possible launch, and the radar answers two questions about each:

1. What would a token be worth if the protocol's record stayed as it is?
2. What should a reader do to farm the protocol before or after a launch?

It writes a ranked board (`board.json`), a static dashboard, three screenshots, and a
dossier the judge reads.

## The value model

One function scores every pre-token protocol from its own snapshot figures alone — no name
is ever special-cased:

```
implied_value = tvl_usd
              × 0.32                     (base multiple)
              × momentum(change_7d)      1 + clamp(g, -50, +100)/100 × 0.45
              × patience(age_days)       0.65 + min(age, 1095)/1095 × 0.55
              × category_weight          0.80 … 1.35, by cash-flow type
```

- **Momentum** pays protocols whose TVL grew over the last seven days and dings ones that shrank.
- **Patience** counts the days since the protocol was first tracked — the longer it has run
  with no token, the more users a launch would inherit.
- **Category weight** prices a dollar of TVL by what cash flow the category captures
  (lending and CDP score highest, bridges and staking pools lowest).
- Protocols whose token already trades are kept out of the ranking and shown separately
  with the market's own market cap.

The board covers every protocol on the snapshot's watchlist (40) and adds the strongest
186 pre-token protocols below its $50M floor — 226 ranked rows in total.

## The dashboard

Static, vanilla JS, dark theme, no network and no framework:

- a sortable ranked board with momentum sparklines and value bars,
- a detail view per protocol: chains, TVL, seven-day trend, tracking date, the full
  multiplier breakdown, and a concrete farm plan (6 steps, each with cost and time),
- filters by category, chain and implied-value band, plus a search box,
- a live-token comparison tab and the model formula printed on the page.

## Run it

Node 22, standard library only:

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out MAKEFUN_INPUT_DIR=<snapshot dir> node main.ts
```

Writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` into the
output directory. Screenshots are regenerated with Playwright against a static server.

## Layout

```
main.ts            entry point: read snapshot, score, write outputs
lib/model.ts       the value model, farm plans, board assembly, gate self-checks
dashboard/         index.html + app.css + app.js (vanilla JS)
vendor/            make.fun's dossier library, byte-identical to the kit
screenshots/       board, detail view, filtered view
```

## License

MIT
