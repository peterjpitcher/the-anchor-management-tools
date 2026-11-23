-- Switch on the morning-after no-show email (owner decision D, 22 November 2026: "Switch it on").
--
-- Sets messaging_flags.table_no_show_follow_up to true, merged into the existing object so no
-- other flag changes. Apply this one WITH or AFTER the code deploy: the app running before it
-- ignores the key, and the new code sends nothing until the key is true. Switching it off again
-- needs no deploy:
--   update public.system_settings
--      set value = value || '{"table_no_show_follow_up": false}'::jsonb
--    where key = 'messaging_flags';
-- The end-of-day no-show marking does not read this flag; only the email does.

insert into public.system_settings (key, value)
values ('messaging_flags', '{"table_no_show_follow_up": true}'::jsonb)
on conflict (key) do update
  set value = public.system_settings.value || excluded.value;
