# csv-reader-speed-01-run-20261121

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/hajeesam/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/hajeesam/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast drop-in replacement for csv-reader 1.0.0: a from-scratch CSV parser that
returns exactly the same `{columns, rows, errors}` for every input — including
every broken row (stray CRs, unterminated quotes, quote junk, short/long rows)
— only faster. No dependencies, no WebAssembly, no native code: plain
JavaScript standard library.

How it is faster: the reference reads the text one character at a time and
builds each field with `+=`. This parser scans in bulk instead — a record
with no quote before its line break is sliced once and split natively, an
unquoted field is found with two `indexOf` calls, and a quoted field finds
its closing quote with `indexOf` and slices its body once. On the practice
set it parses about 3x faster than the reference (and about 2x faster
end-to-end including JSON I/O), while matching it on all 6 practice cases
and on 26,000+ hand-written and fuzzed edge cases with zero differences.

## Run it

```sh
MAKEFUN_INPUT_DIR=./input MAKEFUN_OUTPUT_DIR=./output node main.ts
```

`main.ts` reads `cases.json` from the input directory, answers every case
with `run()` from `solve.js`, and writes `answers.json` to the output
directory. It turns V8's incremental marking off before importing `solve.js`,
as the house driver does.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
