/**
 * The /users page header, shared by the server page (error state) and the client page (loaded
 * state) so the title never changes between states. Plain data, no 'use client', so the server
 * page can import it.
 */
export const USERS_LAYOUT = {
  title: 'Users',
  subtitle: 'Manage staff accounts and their roles',
} as const
