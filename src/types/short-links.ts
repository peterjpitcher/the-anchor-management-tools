/** Short link as returned by getShortLinks — a subset of the full row */
export interface ShortLink {
  id: string
  name?: string | null
  short_code: string
  destination_url: string
  link_type: string
  click_count: number
  created_at: string
  expires_at: string | null
  last_clicked_at: string | null
  parent_link_id: string | null
}
