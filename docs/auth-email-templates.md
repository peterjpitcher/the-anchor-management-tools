# Supabase Auth Email Templates

Copy/paste these into Supabase Dashboard → Authentication → Email Templates. They align with the current server-side flow (password resets go through `/auth/confirm`), include the correct `TokenHash`, and use neutral corporate-friendly language.

> ⚠️ Replace `{{ .SiteURL }}` only if your production domain differs from the Supabase Site URL setting.

---

## 1. Confirm Signup (Magic Link)

This is the standard signup confirmation. It mirrors Supabase’s defaults but improves the copy and provides a fallback button.

```
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0f172a; padding:32px; font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <tr>
    <td align="center">
      <table role="presentation" width="480" cellspacing="0" cellpadding="0" style="background:#ffffff; border-radius:16px; padding:40px; text-align:center; color:#0f172a;">
        <tr>
          <td>
            <h1 style="font-size:24px; margin:0 0 16px 0;">Confirm your email</h1>
            <p style="margin:0 0 24px 0; font-size:15px; color:#475569;">
              Thanks for creating an account. Click the button below to activate your login.
            </p>
            <a href="{{ .ConfirmationURL }}"
               style="display:inline-block; background:#0f766e; color:#ffffff; padding:14px 24px; border-radius:10px; font-weight:600; text-decoration:none;">
              Confirm email
            </a>
            <p style="margin:24px 0 0 0; font-size:13px; color:#64748b;">
              If the button doesn’t work, copy and paste this link into your browser:<br />
              <span style="word-break:break-word; color:#0f172a;">{{ .ConfirmationURL }}</span>
            </p>
            <p style="margin:32px 0 0 0; font-size:12px; color:#94a3b8;">
              Did you receive this in error? You can ignore it safely.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
```

---

## 2. Magic Link (Passwordless sign-in)

```
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0f172a; padding:32px; font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <tr>
    <td align="center">
      <table role="presentation" width="480" cellspacing="0" cellpadding="0" style="background:#ffffff; border-radius:16px; padding:40px; text-align:center; color:#0f172a;">
        <tr>
          <td>
            <h1 style="font-size:24px; margin:0 0 16px 0;">Here’s your magic link</h1>
            <p style="margin:0 0 24px 0; font-size:15px; color:#475569;">
              Use this link to sign in. It expires in one hour and can only be used once.
            </p>
            <a href="{{ .ConfirmationURL }}"
               style="display:inline-block; background:#0f766e; color:#ffffff; padding:14px 24px; border-radius:10px; font-weight:600; text-decoration:none;">
              Sign in now
            </a>
            <p style="margin:24px 0 0 0; font-size:13px; color:#64748b;">
              If the button doesn’t work, copy and paste this link into your browser:<br />
              <span style="word-break:break-word; color:#0f172a;">{{ .ConfirmationURL }}</span>
            </p>
            <p style="margin:32px 0 0 0; font-size:12px; color:#94a3b8;">
              Didn’t request this? You can safely ignore it.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
```

---

## 3. Password Reset (Recovery)

Uses our new confirm route and `TokenHash`, so SafeLinks can’t consume the OTP.

```
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0f172a; padding:32px; font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <tr>
    <td align="center">
      <table role="presentation" width="520" cellspacing="0" cellpadding="0" style="background:#ffffff; border-radius:16px; padding:42px; text-align:center; color:#0f172a;">
        <tr>
          <td>
            <h1 style="font-size:24px; margin:0 0 16px 0;">Reset your password</h1>
            <p style="margin:0 0 24px 0; font-size:15px; color:#475569;">
              To keep your account secure, click the button below to confirm it’s you. You’ll then be asked to choose a new password.
            </p>
            <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/auth/reset"
               style="display:inline-block; background:#0f766e; color:#ffffff; padding:14px 24px; border-radius:10px; font-weight:600; text-decoration:none;">
              Continue password reset
            </a>
            <p style="margin:24px 0 0 0; font-size:13px; color:#64748b;">
              If the button doesn’t work, copy and paste this link into your browser:<br />
              <span style="word-break:break-word; color:#0f172a;">{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/auth/reset</span>
            </p>
            <p style="margin:32px 0 0 0; font-size:12px; color:#94a3b8;">
              If you didn’t ask for a reset, you can safely ignore this email.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
```

---

## 4. Email Change (Optional)

If you allow email changes, Supabase sends a confirmation to the new address. This template pushes them back to the Supabase `ConfirmationURL` because email-change flows already land on your app once confirmed.

```
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0f172a; padding:32px; font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <tr>
    <td align="center">
      <table role="presentation" width="480" cellspacing="0" cellpadding="0" style="background:#ffffff; border-radius:16px; padding:40px; text-align:center; color:#0f172a;">
        <tr>
          <td>
            <h1 style="font-size:24px; margin:0 0 16px 0;">Confirm email change</h1>
            <p style="margin:0 0 24px 0; font-size:15px; color:#475569;">
              We received a request to update the email on your account. Click below to confirm.
            </p>
            <a href="{{ .ConfirmationURL }}"
               style="display:inline-block; background:#0f766e; color:#ffffff; padding:14px 24px; border-radius:10px; font-weight:600; text-decoration:none;">
              Confirm email change
            </a>
            <p style="margin:24px 0 0 0; font-size:13px; color:#64748b;">
              If this wasn’t you, you can safely ignore this email.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
```

---

## 5. Invite Team Member (Optional)

```
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0f172a; padding:32px; font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <tr>
    <td align="center">
      <table role="presentation" width="520" cellspacing="0" cellpadding="0" style="background:#ffffff; border-radius:16px; padding:42px; text-align:center; color:#0f172a;">
        <tr>
          <td>
            <h1 style="font-size:24px; margin:0 0 16px 0;">You’ve been invited</h1>
            <p style="margin:0 0 24px 0; font-size:15px; color:#475569;">
              A teammate invited you to Management Tools. Click below to accept and set up your account.
            </p>
            <a href="{{ .ConfirmationURL }}"
               style="display:inline-block; background:#0f766e; color:#ffffff; padding:14px 24px; border-radius:10px; font-weight:600; text-decoration:none;">
              Accept invitation
            </a>
            <p style="margin:24px 0 0 0; font-size:13px; color:#64748b;">
              If you don’t recognise this, you can ignore it.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
```

---

## Notes / Tips

- All templates use inline styles for maximum email-client compatibility.
- Background colour `#0f172a` matches your UI; adjust as needed.
- Buttons are accessible (high contrast, no reliance on images) and include copy-and-paste fallbacks.
- For the password reset template, `TokenHash` + `/auth/confirm` ensures SafeLinks can’t consume the OTP before the user does.
- If you support other flows (phone OTP, SMS, etc.), the same pattern applies: avoid exposing Supabase’s hosted `/verify`; funnel through your own handler.

Let me know if you want a plaintext fallback version for any template.
