-- Migration: set minimum guests to 30 for pizza catering package

BEGIN;

UPDATE catering_packages
SET minimum_guests = 30
WHERE name = 'Pizza (Ordered from our Menu)';

COMMIT;
