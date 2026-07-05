# Website handoff — kitchen pacing in the table-booking picker

**Repo:** `the-anchor.pub` (separate; **manual** production deploy).
**Depends on:** AMS branch `feat/table-booking-kitchen-pacing` deployed, and a manager enabling the cap in AMS settings.
**Status:** AMS side is built. This is the website-side change (Phase 3) — not implemented from AMS.

## What AMS now provides

`GET /api/table-bookings/load?date=YYYY-MM-DD` (API-key auth, scope `read:table_bookings`) returns its existing fields **plus** two additive fields — safe to ignore until you consume them:

```jsonc
{
  "success": true,
  "data": {
    "date": "2026-07-05",
    "window_minutes": 60,                 // existing (cosmetic busy/filling labels)
    "busy_threshold_covers": 30,          // existing
    "filling_threshold_covers": 20,       // existing
    "bookings": [{ "time": "13:00", "covers": 25 }],  // existing

    "capacity": {                          // NEW
      "enabled": false,                    // master switch — false today
      "window_minutes": 30,                // rolling window the cap uses
      "ceiling_covers": 19,                // max online food covers per window (pace − walk-in reserve), resolved for this date
      "walk_in_reserve": 6                 // covers/window held back for walk-ins (informational)
    },
    "slots": [                             // NEW — 15-min grid across the kitchen window; [] if kitchen closed that day
      { "time": "12:00", "covers": 0,  "remaining": 19 },
      { "time": "12:15", "covers": 4,  "remaining": 15 },
      { "time": "12:30", "covers": 19, "remaining": 0  }
    ]
  }
}
```

- `covers` = food covers already arriving in the rolling window centred on that slot time.
- `remaining` = `max(0, ceiling_covers − covers)` — how many more covers can still be booked around that time.
- Times are local `HH:MM` (Europe/London).

## What the website must do

1. **Respect the switch.** If `capacity.enabled` is `false`, behave exactly as today — show every time the picker already offers. Do nothing else. (The cap ships off; this is the default.)
2. **When `capacity.enabled` is `true`,** for each time your picker would offer at party size `P`:
   - Find the nearest `slots[]` entry (the grid is 15-min steps; snap to the closest, or the one whose window contains the offered time).
   - If `slot.remaining < P`, **grey out / disable** that time (with a short "fully booked — please choose another time" hint). Otherwise show it as normal.
   - This is the real demand-smoother: it pushes customers to quieter times before they submit.
3. **Handle the submit-time fallback.** A slot can fill between load and submit. `POST /api/table-bookings` may now return a block reason **`slot_full`** (same envelope as the existing `no_table`). Show friendly copy ("That time has just filled up — please pick another") and re-fetch `load` so the picker greys the now-full slot. Do **not** treat `slot_full` as a hard error/500.

## Notes & guardrails

- **Additive only** — every existing field is unchanged; you can ship the consumption change independently and roll it back safely.
- **AMS is authoritative.** Even if the website doesn't grey a slot, AMS blocks over-cap online bookings at submit with `slot_full`, so the kitchen is protected regardless. Greying is purely better UX/steering.
- **Party size matters** — compare `remaining` to the customer's party size, not to zero. A slot with `remaining: 3` is bookable for a 2 but not a 4.
- **Walk-ins & staff** don't flow through this API; the reserve already accounts for walk-ins in `ceiling_covers`.
- **Deploy is manual** — coordinate the website deploy with the venue; there's no auto-deploy on `the-anchor.pub`.
