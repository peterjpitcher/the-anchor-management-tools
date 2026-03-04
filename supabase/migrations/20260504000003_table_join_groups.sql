-- Table join groups
-- Groups define which tables can be combined for bookings.
-- Any combination of tables within the same group is valid.
-- The table_join_links pairs are auto-generated from groups.

CREATE TABLE table_join_groups (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL CHECK (char_length(trim(name)) > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE table_join_group_members (
  group_id  UUID NOT NULL REFERENCES table_join_groups(id) ON DELETE CASCADE,
  table_id  UUID NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, table_id)
);

ALTER TABLE table_join_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_join_group_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read join groups"
  ON table_join_groups FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can manage join groups"
  ON table_join_groups FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can read join group members"
  ON table_join_group_members FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can manage join group members"
  ON table_join_group_members FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Seed: migrate existing configuration into groups.
-- Dining Room: all tables in the Dining Room area
WITH g AS (
  INSERT INTO table_join_groups (name) VALUES ('Dining Room') RETURNING id
)
INSERT INTO table_join_group_members (group_id, table_id)
SELECT g.id, t.id FROM tables t, g WHERE t.area = 'Dining Room';

-- Low Tables: Low 4a + Low 4b only
WITH g AS (
  INSERT INTO table_join_groups (name) VALUES ('Low Tables') RETURNING id
)
INSERT INTO table_join_group_members (group_id, table_id)
SELECT g.id, t.id FROM tables t, g WHERE t.name IN ('Low 4a', 'Low 4b');
