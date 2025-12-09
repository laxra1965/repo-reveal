# 🚀 Deployment Guide: 24/7 Arbitrage Bot

This guide explains how to deploy your Arbitrage Bot for continuous, uninterrupted operation.

## 1. Prerequisites
*   A [Supabase](https://supabase.com/) project.
*   A [GitHub](https://github.com/) repository with this code.
*   A [Vercel](https://vercel.com/) account (for frontend hosting).

## 2. Deploy Background Logic (Edge Functions)
Your bot's "brain" lives in Supabase Edge Functions. You need to deploy them to the cloud.

1.  **Login to Supabase CLI** (if not already):
    ```bash
    npx supabase login
    ```
2.  **Link your project**:
    ```bash
    npx supabase link --project-ref your-project-ref
    ```
    *(Find your Reference ID in Supabase Dashboard > Settings > General)*

3.  **Deploy all functions**:
    ```bash
    npx supabase functions deploy --no-verify-jwt
    # Or specifically:
    npx supabase functions deploy arbitrage-scanner --no-verify-jwt
    npx supabase functions deploy auto-trade-scheduler --no-verify-jwt
    npx supabase functions deploy execute-trade --no-verify-jwt
    npx supabase functions deploy scheduled-arb-scan --no-verify-jwt
    ```

## 3. Configure Environment Variables
In your Supabase Dashboard > **Settings** > **Edge Functions**, add the following secrets:
*   `SUPABASE_URL`: Your project URL.
*   `SUPABASE_SERVICE_ROLE_KEY`: Your service role key (needed for bypassing RLS during auto-trading).
*   `ALLOWED_ORIGINS`: `https://your-vercel-app.vercel.app` (once deployed).

## 4. Automate 24/7 Execution (The Scheduler)
To make the bot run continuously without your computer being on, we use the database's built-in scheduler (`pg_cron`).

1.  Open **`production_setup.sql`** in this project.
2.  Replace:
    *   `YOUR_PROJECT_REF` with your actual project reference ID (e.g., `abcdefgh`).
    *   `YOUR_SERVICE_ROLE_KEY` with your actual strict Service Role Key.
3.  Copy the content.
4.  Go to Supabase Dashboard > **SQL Editor**.
5.  Paste and **Run** the script.

**What this does:**
*   **Arbitrage Scanner**: Runs every **1 minute** to find opportunities for all auto-trade users.
*   **Auto Trader**: Runs every **1 minute** to process queues and execute trades.
*   **Cleanup**: Runs every **hour** to keep the database clean.

## 5. Deploy Frontend (User Interface)
1.  Push your code to GitHub.
2.  Go to **Vercel** > **Add New** > **Project**.
3.  Import your GitHub repository.
4.  In "Environment Variables", add:
    *   `VITE_SUPABASE_URL`: Your Supabase URL.
    *   `VITE_SUPABASE_ANON_KEY`: Your Supabase Anon Key.
5.  Click **Deploy**.

## 6. Verification
*   Go to your Vercel URL -> Login -> **Dashboard**.
*   Enable **Auto-Trade** in Settings.
*   The "Arbitrage Scanner" function (running in the Supabase cloud) will now automatically check for opportunities 24/7 and execute them for you.
*   You can check the **Trade History** page to see the results.

## Troubleshooting
*   **Logs**: Check Supabase Dashboard > **Edge Functions** > **Logs** to see if the cron job is successfully calling your functions.
*   **Database Cron**: Run `select * from cron.job_run_details order by start_time desc limit 10;` in SQL Editor to see if the jobs are firing.
