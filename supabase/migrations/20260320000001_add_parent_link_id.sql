-- Add parent_link_id to support UTM variant grouping
ALTER TABLE short_links
  ADD COLUMN parent_link_id UUID REFERENCES short_links(id) ON DELETE CASCADE;

-- Partial index — only variants have a parent
CREATE INDEX idx_short_links_parent
  ON short_links (parent_link_id)
  WHERE parent_link_id IS NOT NULL;

-- Comment
COMMENT ON COLUMN short_links.parent_link_id IS
  'If set, this link is a UTM variant of the parent link. NULL = standalone/parent link.';
