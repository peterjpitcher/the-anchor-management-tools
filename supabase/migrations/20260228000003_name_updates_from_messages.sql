-- Apply names identified from message history for Guest customers
-- Names sourced from booking confirmation messages the system sent to each customer
-- Split into first_name / last_name where full name was available

-- ── Full names ─────────────────────────────────────────────────────────────────
UPDATE customers SET first_name = 'Andrew', last_name = 'Marshall'  WHERE id = '04c8622d-f806-41f9-ad2f-87283abbde1a';
UPDATE customers SET first_name = 'Sonia',  last_name = 'Panesar'   WHERE id = '3d60b1bd-59bb-4240-945c-dd0e581c575b';
UPDATE customers SET first_name = 'Cliff',  last_name = 'King'      WHERE id = '503e24a2-6c83-4816-847a-4f7fe98319ff';
UPDATE customers SET first_name = 'Richie', last_name = 'Nixon'     WHERE id = '5e1024b8-0e7a-4a9a-977a-954b4c140f4a';
UPDATE customers SET first_name = 'Pauline',last_name = 'Green'     WHERE id = '5e603954-7595-4473-a17f-2453be0b3a89';
UPDATE customers SET first_name = 'Alan',   last_name = 'Gosling'   WHERE id = '81c942c6-f45a-4812-b36c-25ebfc9a5d43';
UPDATE customers SET first_name = 'Shane',  last_name = 'Palmer'    WHERE id = '83926e72-6811-4a52-9e9e-139fc3ef9693';
UPDATE customers SET first_name = 'Joseph', last_name = 'Davis'     WHERE id = '9c02b34c-b8ce-4f94-ba8f-45153ea03588';
UPDATE customers SET first_name = 'Geoff',  last_name = 'Ralph'     WHERE id = '9d8eb14d-78e1-4b10-90c2-c0623ba57723';
UPDATE customers SET first_name = 'Tim',    last_name = 'Yuan'      WHERE id = 'b33e5e67-5c12-42b5-b19b-cc87ffa5af59';
UPDATE customers SET first_name = 'Carol',  last_name = 'Bagnall'   WHERE id = 'c0ec24bc-98a0-4b43-8d49-9ceaf51b1844';
UPDATE customers SET first_name = 'Dean',   last_name = 'Mason'     WHERE id = 'c2cf9707-8db3-408f-9066-df3abb9d2e91';
UPDATE customers SET first_name = 'Sarah',  last_name = 'Hyde'      WHERE id = 'cb49c1c0-e98a-4e5c-a15a-256253a2c389';
UPDATE customers SET first_name = 'Jon',    last_name = 'Heather'   WHERE id = 'd590fcc7-ccee-434c-abae-a1d5456b26fa';
UPDATE customers SET first_name = 'Andrew', last_name = 'Coxhead'   WHERE id = 'f4398917-6633-4b87-acce-c932dd966418';

-- ── First names only ──────────────────────────────────────────────────────────
UPDATE customers SET first_name = 'Marika'   WHERE id = '136f2752-ec81-43ba-b819-92d4dd8cce7d';
UPDATE customers SET first_name = 'Kate'     WHERE id = '15f61c31-eeaf-4c77-b0fe-ee4f42bcb41e';
UPDATE customers SET first_name = 'Paul'     WHERE id = '2d3e3685-431d-4df4-8857-9caeebfbe690';
UPDATE customers SET first_name = 'Jo'       WHERE id = '31456628-0cc6-40b7-879b-ba536cf3e7d5';
UPDATE customers SET first_name = 'Marty'    WHERE id = '38bc8cf9-b348-4ecf-b125-bd69fc748c3e';
UPDATE customers SET first_name = 'Sadie'    WHERE id = '48852f5c-952a-4336-8dba-38d87b553cd1';
UPDATE customers SET first_name = 'Margaret' WHERE id = '48a2a6f9-f515-4138-8472-a83c47ed43f1';
UPDATE customers SET first_name = 'Huda'     WHERE id = '5cf343ff-4978-470a-8ce7-29e9db39be3d';
UPDATE customers SET first_name = 'Sid'      WHERE id = '60cdc610-3c34-4a14-b0f4-92dc318d4381';
UPDATE customers SET first_name = 'Claire'   WHERE id = '67deee84-27bd-44dc-a36c-4b3c4d48d390';
UPDATE customers SET first_name = 'Richard'  WHERE id = '73cfb0cd-722a-44b4-bc71-6e8a287c56c5';
UPDATE customers SET first_name = 'Simon'    WHERE id = '7582e123-4f74-4e8c-8943-6aa24144f130';
UPDATE customers SET first_name = 'Tom'      WHERE id = '7e69945a-bc73-47a7-a5d4-7108b813461d';
UPDATE customers SET first_name = 'Tom'      WHERE id = '88758bdf-b030-4734-b378-751ec91d9681';
UPDATE customers SET first_name = 'Lauren'   WHERE id = '94c7983c-bb98-46dd-97bf-3ee2400a6c7d';
UPDATE customers SET first_name = 'Ryadh'    WHERE id = 'a83d5519-c957-4150-a357-3bf3f9ce47d4';
UPDATE customers SET first_name = 'Jazz'     WHERE id = 'a871fb25-7a64-4fd1-ae7a-bc8e84666476';
UPDATE customers SET first_name = 'Lindi'    WHERE id = 'c94f1f52-7110-4344-bdaa-ba4d21c997ad';
UPDATE customers SET first_name = 'Mark'     WHERE id = 'd1c5309b-3031-4c96-9b48-758948304529';
UPDATE customers SET first_name = 'Charlie'  WHERE id = 'e85eb594-6e19-4f87-9ba5-f2b76897c6f5';
UPDATE customers SET first_name = 'Holly'    WHERE id = 'f1a48f3e-f5e9-4f94-8e4a-7da63767a3f1';
UPDATE customers SET first_name = 'Lou'      WHERE id = 'fb8730f8-9b75-4a07-bece-e459f0a95da4';

-- ── User-specified: Wendy (+447481948048) ────────────────────────────────────
UPDATE customers SET first_name = 'Wendy'
WHERE id = 'defac810-da49-4d3f-a9a3-02ff4613f5e5';

-- ── Shared family number: note but leave as-is pending decision ───────────────
-- bd70fae0 (+447873284453): alternates between "Rob & Denise" and "Julie & Brian"
-- No crossover with existing named customers. Awaiting instruction on what name to use.
UPDATE customers
SET internal_notes = 'Shared family/household number. Booking messages sent to "Rob & Denise" and "Julie & Brian" (and later "Rob" and "Julie" solo). No existing customer records found for these names with this number. Awaiting decision on whose name to register.'
WHERE id = 'bd70fae0-b023-40a8-b31b-cf33dfd6c1a2';

-- ── Deactivate 617b96e1: inbound "Wrong number" reply received ────────────────
UPDATE customers
SET sms_opt_in = false,
    sms_deactivated_at = NOW(),
    sms_deactivation_reason = 'wrong_number',
    internal_notes = 'Booking messages sent addressed to "Leanne" but recipient replied "Wrong number". SMS deactivated.'
WHERE id = '617b96e1-5470-451e-b5ca-5c9483f89fd0';

-- ── Delete test/system/debug entries ─────────────────────────────────────────
-- +15163820734: US number, all outbound only, no real responses
DELETE FROM customers WHERE id = 'f0815d08-d513-4b65-abdb-d3067a998e31';
-- +441753682707: The Anchor's own landline number, inbound was a WhatsApp group join link
DELETE FROM customers WHERE id = 'fbfd452e-7210-48e5-9d73-8ac428ea9a7f';
-- +447700900888: Ofcom reserved test number, messages included "Hey Debug"
DELETE FROM customers WHERE id = '0b6b38a2-3d0c-4fae-8f74-f2771dbdcb78';
