# Defects

| ID | Type / severity / confidence | Evidence and impact | Root cause / sibling check | Fix / approval | Acceptance / status |
|---|---|---|---|---|---|
| FF-001 | Bug / High / High | Live conversion GET 500, SQL 22P02 | Invalid seated enum; review statuses also excluded. Checked marketing callers and event engagement transitions. | Typed valid conversion statuses, approved | 11 route regressions passed; deploy GET pending |
| FF-002 | Data risk / Medium / High | Booking IDs emitted with public cache policy | Generic public response default; checked guarded error responses | Private no-store response and guard, approved | Real response/guard cache-header regressions passed |
| FF-003 | Validation / Medium / High | Arbitrary event IDs passed to UUID database filter | Only non-empty string validation | UUID list/date validation, approved | Malformed UUID/list/date regressions passed |
| FF-004 | Security / Medium / High | Production api_keys inventory | Broad and dormant credentials; match deployed consumers | Least scopes and revoke confirmed dormant credentials, approved | Applied six settings updates and six audit records; scoped Music Bingo events and Cheers events/specials/artwork return 200 |

## Verification

- Lint and non-incremental typecheck passed.
- Full coverage suite passed: 720 files, 6,185 tests passed, 2 skipped. Coverage: lines 51.35%, branches 42.44%, functions 60.8%, statements 52.84%, above required floors.
- Clean Next.js production build passed, using non-production placeholder credentials and communication suspension flags.
- API key script dry-run inspected all six expected identities and scopes before application. Conditional updates prevented overwriting concurrent changes, including renewed use of dormant credentials. Post-change reads verified every state and all six audit entries. Repeated dry-run detects all six as already applied.
- Deployed Music Bingo token matched the configured local token without printing either. Both brands' live overrides were checked; neither uses the dormant duplicate. Cheers required read scopes remain intact.
- Deliberately left unchanged: active website key, separate Website integration key used in August, already revoked test keys, booking/payment writes, database schema and Quiz/Cash apps. No migration required.
- One focused sibling review covered event status transitions, invalid input, response caching and conversion consumer validation. Final production verification is recorded separately after deployment.
