-- Prove unexpected existing-row changes, including effects of event triggers, abort migration.
CREATE FUNCTION fixture_mutate_existing_booking() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN UPDATE bookings SET notes='unexpected trigger effect' WHERE id='20000000-0000-0000-0000-000000000001'; RETURN NEW; END $$;
CREATE TRIGGER fixture_mutate_existing_booking AFTER UPDATE ON events FOR EACH ROW EXECUTE FUNCTION fixture_mutate_existing_booking();
