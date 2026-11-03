# Browser scanner and live trades
- [x] Connect browser prices and saved discoveries to the dashboard.
- [x] Add protected live trade summary with recorded fills and timeline.
- [ ] Verify Binance/Bybit (needs signed-in session and live VPS) public feeds and dashboard flows where access permits.
- [x] Explain Supabase's new-table access notice.

# VPS upload readiness
- [x] Complete the VPS-to-frontend connection requested on October 28.
- [x] Align uploaded scanner startup and Supabase opportunity schema.
- [x] Wire queue processing to verified exchange fills with sizing and safety gates.
- [x] Replace placeholder exchange verification and align credential decryption.
- [x] Test wiring and document upload/startup checks without submitting live orders.

# Database size and trading cycle (Nov 3)
- [x] Diagnose size growth: schedule run log was 750 MB of 862 MB; real data under 40 MB.
- [x] Clear the run log and keep it from refilling (nightly cleanup at 03:00 UTC).
- [x] Fix the every-minute trading cycle failing on an exchange-list format mismatch.
- [ ] Get opportunities flowing again: VPS scanner must run, or decide on the dead
      database-side scanner shortcut (points at an undeployed function).
- [ ] Confirm a paper trade and a queued live trade appear end to end once scanning resumes.