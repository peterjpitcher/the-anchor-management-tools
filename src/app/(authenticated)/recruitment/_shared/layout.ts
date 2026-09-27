/**
 * The Recruitment page header, shared by the server page (error state) and the dashboard
 * (loaded state) so the header never changes between them. Plain data, so the server page can
 * import it.
 */
export const RECRUITMENT_LAYOUT = {
  title: 'Recruitment',
  subtitle: 'Review applicants, manage roles, schedule interviews and keep candidate communications tidy',
} as const
