# Launch Radar

A dashboard that finds the protocols which record no token yet and ranks them by what a token
would be worth if the protocol's record stayed as it is.

## The model

The snapshot carries 128 protocols that already trade a token, each with a TVL and a market cap.
Fitting `log10(market cap)` on `log10(TVL)` by ordinary least squares over exactly those pairs gives
the market's own law of value:

```
mcap = 10^3.0247 × tvl^0.5223
```

TVL and market cap do not move one for one: a tenfold TVL predicts a 3.3-fold market cap. A
pre-token protocol's implied value is that fit, scaled by its category's median residual (measured
over the live protocols in the same category) and by a bounded correction for its seven-day TVL
change. No protocol name appears in the model, and the dashboard states the fitted constants beside
every row so the arithmetic can be checked.

The seven-day correction is reported as measured and it is small: the fitted slope is about
`-0.016`, so a 100% weekly move shifts the multiple by under 4% — inside the fit's own residual
spread. It is applied because it was measured, not because it is believed to be a strong signal.

## What it writes

`main.ts` reads `/input/snapshot.json` and writes `board.json` (200 ranked rows, each with a farm
plan), `data.js` (the page's data), a copy of `dashboard/` and `screenshots/`, and `dossier.json`.

## Running it

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

## Licence

MIT
