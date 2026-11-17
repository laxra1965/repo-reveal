# Move this app to a new Supabase account

The current Supabase project reference is `zupbliefzhnohsoguwuk`. Do not pause, delete, or overwrite it until the destination is verified. The app now requires its connected project's URL and publishable key at build time; it no longer silently falls back to the current project's URL/key.

## Pick the migration path

### A. Transfer the existing project to the new account/organization (preferred)

If you only need the project owned and billed under another Supabase account, transfer the existing project instead of making a new database. Supabase's project-transfer flow preserves the project and reference, so there is no database copy or user re-registration. The source organization owner initiates it after the receiving account is in the target organization. Supabase lists prerequisites including no active GitHub integration, project-scoped roles, or log drains; review plan and billing changes before accepting. See [Project Transfers](https://supabase.com/docs/guides/platform/project-transfer).

After transfer, verify the Lovable connection and VPS configuration. Since the project reference is unchanged, Supabase URL and API keys do not change.

### B. Create a different Supabase project

Choose this only when you need a new project reference/URL. If available on the source plan, use **Restore to a new project**. Supabase says this path carries database schema/data, Auth users/password hashes, and the encryption root key, while Storage objects/settings, Edge Functions, Auth provider settings/API keys, Realtime configuration, extensions, and other project settings need manual setup. See [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project).

If that managed restore is unavailable, the CLI backup/restore steps below copy database schema/data, **not a complete project**. Do not use this path if users must retain existing Auth accounts and IDs: Auth users/passwords are not copied by the logical dump, and public profile/settings rows may refer to old user IDs. Users and their associated data need a planned secure re-provisioning/mapping process. Never copy or edit Supabase-managed `auth` or `storage` tables directly.

## Manual database backup and restore (advanced)

Run these commands from a trusted computer with Docker, `psql`, and the Supabase CLI installed. Get each database connection string from that project's **Connect** panel. The following uses Bash; it prompts without echoing the connection strings, so they are not placed in command history. Keep the resulting files private and outside the repository: they contain production user and trading data.

```bash
umask 077
mkdir -p "$HOME/supabase-account-move"
cd "$HOME/supabase-account-move"

read -s -p 'Source database connection string: ' SOURCE_DB_URL; printf '\n'
npx supabase db dump --db-url "$SOURCE_DB_URL" --file roles.sql --role-only
npx supabase db dump --db-url "$SOURCE_DB_URL" --file schema.sql
npx supabase db dump --db-url "$SOURCE_DB_URL" --file data.sql --use-copy --data-only -x storage.buckets_vectors -x storage.vector_indexes
unset SOURCE_DB_URL
```

Create the destination project first and enable its non-default extensions/webhooks as needed. Then restore the dump using the destination connection string. Supabase's documented logical restore loads roles and schema, disables triggers during data restoration, and stops on errors:

```bash
read -s -p 'Destination database connection string: ' TARGET_DB_URL; printf '\n'
psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file roles.sql \
  --file schema.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql \
  --dbname "$TARGET_DB_URL"
unset TARGET_DB_URL
```

If the restore reports managed-role/owner permissions or any other error, stop and resolve that specific issue; do not retry destructive steps blindly. Connection strings contain database credentials, so never paste them into chat or commit them. The commands follow [Supabase's CLI backup and restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

If the local migration history must also be preserved, export and restore `supabase_migrations` separately only after checking that the destination does not already contain it. Do not run `supabase db push` against a restored database until `supabase migration list` and a dry run show exactly what will happen.

## Required setup before cutover

1. **Pause writes safely:** let active exchange orders reach a known state and reconcile uncertain fills; disable auto/live execution and stop the scanner/worker before the final backup. Never stop an order that may already have reached an exchange.
2. **Auth:** configure the same providers, email/SMTP, redirect URLs, and allowed domains in the destination. For a CLI logical restore, plan new signups/invitations and user-ID remapping; existing sessions will need to sign in again. The managed restore-to-new-project path is the suitable option when existing Auth identities must be preserved.
3. **Storage:** this frontend has no direct Storage API calls, but check whether the source has buckets/files. Recreate bucket configuration and policies and migrate any objects separately; database-only restore does not carry the files. See [Storage migration options](https://supabase.com/docs/guides/storage/management/download-objects).
4. **Functions and secrets:** deploy the functions from the repo to the destination after linking it. Review the functions and add only the secrets still required, using the new project's secure secrets settings. This repo has used `CMC_API_KEY`, `FCM_SERVICE_ACCOUNT`, and `LOVABLE_API_KEY`; verify which remain needed. Built-in Supabase URL, publishable/anon key, and service-role key must all be from the destination. Never put service-role keys in frontend settings, Git, or this guide. See [function deployment](https://supabase.com/docs/guides/functions/deploy) and [function secrets](https://supabase.com/docs/guides/functions/secrets).

   ```bash
   npx supabase login
   npx supabase link --project-ref TARGET_PROJECT_REF
   npx supabase functions deploy --project-ref TARGET_PROJECT_REF
   ```

   Update `supabase/config.toml`'s `project_id` to the destination reference before future linked CLI operations. Confirm the right project is linked before deploying.

5. **VPS credentials:** set VPS `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_ANON_KEY` to destination values. Preserve the exact VPS `ENCRYPTION_KEY` that encrypted existing `exchange_credentials`; changing it makes those keys unreadable and users must re-enter credentials. Keep it secret and server-side. Start with `TRADING_ENABLED=false` and `EXECUTION_MODE=dry_run`.
6. **Supabase root encryption key:** with a manual logical restore, if the source uses Vault/pgsodium or root-key-encrypted columns, the source root key may need to be copied through Supabase's documented Management API procedure while both projects are active. Do not put the key or personal access token into chat/Git, and never overwrite a destination root key casually. Managed Restore to a new project handles this key copy. This is separate from the VPS `ENCRYPTION_KEY`.
   For a brand-new destination only, and only when such root-key-encrypted data exists, this streams the key directly between Supabase's Management API without printing it. Use a private terminal, a personal access token with the required access, and the actual destination reference; do not run this against a destination whose key must be retained:

   ```bash
   SOURCE_PROJECT_REF=zupbliefzhnohsoguwuk
   read -r -p 'Destination project reference: ' TARGET_PROJECT_REF
   read -r -s -p 'Supabase personal access token: ' SUPABASE_ACCESS_TOKEN; printf '\n'
   curl --fail --silent --show-error \
     "https://api.supabase.com/v1/projects/${SOURCE_PROJECT_REF}/pgsodium" \
     -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
   | curl --fail --silent --show-error \
     "https://api.supabase.com/v1/projects/${TARGET_PROJECT_REF}/pgsodium" \
     -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
     -X PUT --json @- --output /dev/null
   unset SUPABASE_ACCESS_TOKEN TARGET_PROJECT_REF
   ```

   Supabase documents this source-to-destination procedure for its 64-character encryption root key; do not substitute the VPS `ENCRYPTION_KEY`.
7. **Schedules and realtime:** compare extensions, realtime publication membership, Auth redirects, and cron jobs. Inspect migrated schedules for hardcoded old project URLs and stale function endpoints before enabling them. Recreate the existing 03:00 UTC cron-log cleanup if absent. Keep only one scanner and one automatic live-trade queue consumer; do not run duplicate VPS workers.

## Verify, cut over, and retain rollback

1. Connect Lovable to the destination and verify the app build uses its `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
2. Test login/reset, settings, exchange-key verification, admin pages, scanner opportunity ingestion, and paper trades. Ensure intended user data is visible.
3. Start the VPS in dry-run mode; verify health, new opportunities, queue processing, and saved trade timelines. Only consider live execution after these pass and all exchange credentials are revalidated.
4. Keep the old project intact and stop its writers until the destination passes all checks. Decommission it only after confirming the app, Auth, functions/secrets, scheduled jobs, and VPS are working.

## Details needed to complete the move

- Destination project reference and confirmation it belongs to the intended account/organization.
- Whether you want **A** (transfer the existing project) or **B** (a separate new project).
- If choosing B, whether **Restore to a new project** is available and existing user logins must be preserved.