-- Configure table join links:
-- • All Dining Room tables can be joined in any combination
-- • In the Main Bar, only Low 4a + Low 4b can be joined

DELETE FROM table_join_links;

INSERT INTO table_join_links (table_id, join_table_id)
-- All pairs within the Dining Room area
SELECT t1.id, t2.id
FROM tables t1
JOIN tables t2 ON t1.id < t2.id
WHERE t1.area = 'Dining Room' AND t2.area = 'Dining Room'

UNION ALL

-- Low 4a + Low 4b in the Main Bar
SELECT
  LEAST(low4a.id, low4b.id),
  GREATEST(low4a.id, low4b.id)
FROM tables low4a
JOIN tables low4b ON low4b.name = 'Low 4b'
WHERE low4a.name = 'Low 4a';
