# Voucher batch render benchmark (F22)

Date: 2026-07-30T11:11:44.905Z
Machine: local dev (darwin arm64, Node v20.19.5)

| Cards | PDF pages | Render ms | PDF bytes |
|---|---|---|---|
| 1 | 2 | 5420 | 260119 |
| 25 | 50 | 2904 | 1034781 |
| 50 | 100 | 3098 | 1799069 |
| 100 | 200 | 3565 | 3347090 |

Serverless note: local timings exclude cold-start Chromium launch (~2-4s on Vercel).
Cap of 100 cards per batch retained; route maxDuration is 300s.
