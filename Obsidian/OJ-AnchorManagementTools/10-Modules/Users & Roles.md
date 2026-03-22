---
title: Users & Roles
aliases:
  - User Management
  - Role Management
  - Access Control
tags:
  - type/reference
  - module/users
  - module/roles
  - status/active
module: users-roles
route: /users
created: 2026-03-14
updated: 2026-03-14
---

← [[Modules MOC]]

# Users & Roles

The Users & Roles module provides user account management and RBAC role configuration. It covers the full user lifecycle — from invite to deactivation — and allows super-admins to define custom roles with fine-grained module-level permissions.

---

## Permissions

| Permission | Description |
|---|---|
| `users.view` | View the user list |
| `users.manage` | Invite users, deactivate accounts, change roles |
| `roles.view` | View role definitions and membership |
| `roles.manage` | Create and edit roles, assign module permissions |
| `roles.manage_roles` | Assign roles to users |

---

## Routes

| Route | Description |
|---|---|
| `/users` | User account list and management |
| `/roles` | Role definitions and permission assignment |

---

## Users (`/users`)

### Viewing Accounts

All active and deactivated user accounts are listed with their assigned role and last-seen timestamp.

### Inviting Users

> [!DANGER]
> There is no public registration. New users can only be added by an admin via the invite flow. Any route resembling `/register`, `/signup`, or `/create-account` returns `404`.

The invite flow:

1. Admin enters the invitee's email address and selects a role.
2. The system calls `supabaseAdmin.auth.admin.inviteUserByEmail()` and immediately sets `app_metadata.role` via the Admin API.
3. If step 2 fails, the newly created user record is deleted. No half-created users are permitted.
4. Supabase sends an invite email with a link valid for 7 days.
5. The invitee clicks the link, lands on `/auth/confirm`, and is redirected to `/auth/update-password` to set their password.

> [!NOTE]
> Resending an invite is only permitted if `email_confirmed_at` is `null` — i.e. the user has never completed sign-in. Once confirmed, use the password reset flow instead.

### Deactivating Accounts

Deactivating a user prevents sign-in without deleting their data. All audit records and historical associations are preserved.

### Changing Roles

Role changes take effect immediately. When a user's role is **demoted**, all of their active sessions are destroyed at the point of change so the old permissions cannot be used until they re-authenticate.

> [!WARNING]
> Role demotion (e.g. `manager` → `staff`) triggers `destroyAllSessionsForUser()` immediately. The demoted user will be signed out on their next request. This is intentional security behaviour — do not attempt to suppress it.

Role promotions do not require session destruction but follow the same pattern for consistency.

---

## Roles (`/roles`)

### Role Structure

Roles are the primary mechanism for controlling access across the platform. Each role is a named set of module + action permission pairs.

| Built-in role | Access level |
|---|---|
| `super_admin` | Full platform access including system settings |
| `manager` | Operational access across most modules |
| `staff` | Limited access — typically own shifts, timeclock, messages |

Custom roles can be created to fit specific operational needs (e.g. a "Bar Manager" role with access to rota and events but not payroll).

### Permission Assignment

Each role defines a permission matrix across all modules. For each module, the following actions can be independently granted or denied: `view`, `create`, `edit`, `delete`, and any module-specific actions (e.g. `publish`, `request`, `clock`, `manage`).

> [!NOTE]
> The full permission model is documented in [[RBAC & Permissions]]. Role hierarchy means `super_admin` always passes any permission check regardless of the explicit permission matrix.

### Role Membership

The role detail view lists all users currently assigned to that role, with a direct link to each user account.

---

## Auth Detail

For the full authentication implementation — sessions, CSRF, lockout, invite token exchange — see [[Auth & Security]].

---

## Related

- [[Modules MOC]]
- [[RBAC & Permissions]]
- [[Auth & Security]]
- [[Employees]]
