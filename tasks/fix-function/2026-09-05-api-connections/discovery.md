# API connection remediation

Four independently deployable changes cover Management, Website, CheersAI and Music Bingo. Quiz Night and Cash Bingo remain standalone by design. Complexity: L across repositories, M or smaller per repository.

Production proof: marketing conversion GET returned 500. The live table_booking_status enum rejects seated (22P02). Review lifecycle statuses represent completed visits and must remain conversion evidence. Booking identifiers must not enter shared caches. Malformed UUIDs must return 400 before database access.

Live API keys: CheersAI has unused payments:capture; Music Bingo feed needs only read:events. Three old development keys and a never-used Music Bingo key remain active. Verify current production consumers before reducing scopes or deactivating dormant credentials. No schema migration required for application fixes.

Original checkout and dirty paths are recorded in base-commit.txt. No original checkout files are edited.
