"""Run only against the runner's isolated PostgreSQL fixture."""
import json
import os
import subprocess

psql = os.environ['EVENT_CAPACITY_PSQL']
def sql(query):
    return subprocess.check_output([psql, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', query], text=True).strip()

for first_mode, second_mode in [('communal', 'communal'), ('table', 'communal'), ('communal', 'table'), ('table', 'table')]:
    sql(f"""UPDATE tables SET is_bookable=(table_number='1'),capacity=4;
    INSERT INTO events(id,name,date,time,start_datetime,duration_minutes,booking_mode,payment_mode,booking_open,event_status)
    VALUES ('70000000-0000-0000-0000-000000000001','Concurrent A','2037-01-01','19:00','2037-01-01 19:00+00',180,'{first_mode}','free',true,'scheduled'),
    ('70000000-0000-0000-0000-000000000002','Concurrent B','2037-01-01','19:00','2037-01-01 19:00+00',180,'{second_mode}','free',true,'scheduled');""")
    # Real physical-table triggers acquire the locks. Hold the first transaction
    # open while the competing event reads a snapshot and tries to allocate.
    first = subprocess.Popen([psql, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', """BEGIN;
    SELECT create_event_booking_v05('70000000-0000-0000-0000-000000000001',gen_random_uuid(),3,'admin','seated');
    SELECT pg_sleep(1); COMMIT;"""], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    first_result = first.stdout.readline().strip()
    second = sql("SELECT create_event_booking_v05('70000000-0000-0000-0000-000000000002',gen_random_uuid(),3,'admin','seated')")
    out, err = first.communicate(timeout=10)
    assert first.returncode == 0, err
    one = json.loads(first_result); two = json.loads(second)
    assert one['state'] == 'confirmed', one
    assert two['state'] != 'confirmed', two
    assert sql("SELECT sum(seats) FROM bookings WHERE event_id IN ('70000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000002')") == '3'
    # Remove only this synthetic concurrency fixture, preserving the migration baseline.
    sql("""DELETE FROM booking_table_assignments WHERE table_booking_id IN (SELECT id FROM table_bookings WHERE event_id IN ('70000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000002'));
    DELETE FROM table_bookings WHERE event_id IN ('70000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000002');
    DELETE FROM event_communal_seat_allocations WHERE event_id IN ('70000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000002');
    DELETE FROM bookings WHERE event_id IN ('70000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000002');
    DELETE FROM events WHERE id IN ('70000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000002');
    UPDATE tables SET is_bookable=true,capacity=CASE table_number WHEN '3' THEN 9 ELSE 20 END;""")
    print(f'Concurrent {first_mode}/{second_mode}: one confirmed, one blocked, three guests on one four-seat table')
