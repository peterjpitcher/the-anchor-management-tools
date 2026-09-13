# Defects and improvements
- FF-001 High confirmed live pricing mismatch. Unify first ticket and event mirrors; test both editors and payment.
- FF-002 Medium confirmed missing expiry. Add separate London deadline and SQL/application parity.
- FF-003 Medium confirmed explicit null discount retained. Preserve omitted values but clear explicit null.
- FF-004 High required paid guest details absent. Add atomic structured answers with stable identities; test required/count/retry.
- FF-005 Medium names duplicated. Canonical guest records and mirrored legacy names; test staff edit and operational rendering.
- FF-006 High pricing fallbacks can reprice purchases. Use stored line totals, fail closed on read failures; test payment paths.
- FF-007 Medium blank price coerces to free. Require explicit free ticket choice.
All FF items implemented and locally verified. FF-005 covers new structured guests; legacy records are preserved. Seat/transfer shortcuts are guarded rather than expanded. Full details and verification evidence are in verification.md. Production approval outstanding.
