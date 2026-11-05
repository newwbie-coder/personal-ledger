# Verification checklist

Version 2.0: office box, no cloud.

## 1) Proven by the local end-to-end test

Run against embedded Postgres 18 and system `pg_dump`/`psql` 18 on Windows.

Setup and license
- [x] Fresh box reports `setup_complete: false`
- [x] Signed license file accepted; a copy with `max_users` edited is rejected
- [x] Initialize creates company, owner, Main Firm, data key and recovery kit
- [x] A second initialize is refused (409)
- [x] Login with username and password only

Ledger
- [x] Party with opening balance, incoming and outgoing entries, reversal, dashboard balance

Fingerprint chain
- [x] Clean chain verifies (5 links, 4 records)
- [x] Phone checkpoint matches the server head
- [x] Postgres refuses UPDATE or DELETE on ledger entries and on the chain log, and refuses editing a locked opening balance
- [x] An edit made with triggers disabled is reported as `altered`
- [x] Deleting the newest chain link is caught by the phone checkpoint (`ok: false`)
- [x] The startup check logs `FINGERPRINT CHAIN BROKEN` on a tampered database

Backup and restore
- [x] Encrypted backup written; the file contains no plaintext SQL
- [x] Restore with the wrong recovery passphrase is refused
- [x] Restore onto an empty database and an empty data folder recovers the data key and the chain verifies

HTTPS
- [x] Entrypoint issues the CA and a server certificate with the `BOX_HOSTS` addresses; a second start does not reissue
- [x] HTTPS on 8443 verifies against `ca.crt`; fails without it
- [x] HTTP on 8080 serves the install page and `ca.crt`, and redirects everything else to HTTPS
- [x] HSTS, no-sniff and frame-deny headers; SPA fallback serves the web app

## 2) Still needs a human pass

- [ ] `docker compose up -d --build` on a real Linux box and on Windows with Docker Desktop
- [ ] `setup-server` and `add-phone` on both; scan the QR on an Android and an iPhone
- [ ] Install `ca.crt` on both phones (iPhone needs "Certificate Trust Settings" enabled) and open `https://10.8.0.1`
- [ ] Add to Home Screen, add an entry over mobile data, switch firms, balance-only mode
- [ ] `remove-phone` cuts the phone off immediately
- [ ] Leave the box overnight and confirm a `.lbk` file appears in the backup folder
- [ ] Restore the latest backup onto a second machine using [OFFICE_SETUP.md](OFFICE_SETUP.md)

## 3) Retired

The Railway API, Vercel web app and Supabase control database from version 1 are no longer used by this code. Shut them down once no customer depends on them.
