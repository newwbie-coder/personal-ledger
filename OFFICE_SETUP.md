# Office box setup

One computer in the office runs the ledger. Staff phones reach it from anywhere through WireGuard. Nothing runs in a cloud, and the app maker has no access.

## 1) What you need

- A PC that stays on: any 64-bit machine with 8 GB RAM and an SSD. A small mini PC is ideal.
- A UPS, so power cuts do not corrupt the database.
- An internet connection with a **public IP address**. Ask the ISP for a static IP. Many mobile and fibre plans use carrier-grade NAT, which makes the office unreachable from outside; a static IP fixes that. If the IP is public but changes, use a dynamic DNS name instead.
- Admin access to the office router, to forward one UDP port.
- A USB drive or NAS share for backups.

Linux (Ubuntu Server 24.04 LTS) is recommended because it runs unattended. Windows works too, but Docker Desktop only starts after a user signs in, so set Windows to sign in automatically and never sleep.

Turn on full-disk encryption (LUKS during Ubuntu install, or BitLocker on Windows), and keep the box in a locked room or cabinet.

## 2) Install the app

Linux:

```sh
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
git clone <your copy of this repo> ledger && cd ledger
cp .env.example .env
nano .env        # set POSTGRES_PASSWORD, BOX_HOSTS, BACKUP_PASSPHRASE, BACKUP_HOST_DIR
sudo docker compose up -d --build
```

Windows: install Docker Desktop (WSL 2 backend) and Git, then in PowerShell:

```powershell
git clone <your copy of this repo> ledger; cd ledger
Copy-Item .env.example .env
notepad .env
docker compose up -d --build
```

Settings in `.env`:

| Setting | Value |
|---------|-------|
| `POSTGRES_PASSWORD` | Long random text. Only the box uses it. |
| `BOX_HOSTS` | `10.8.0.1` plus the box's LAN IP if staff also use office Wi-Fi, for example `10.8.0.1,192.168.1.50` |
| `BACKUP_PASSPHRASE` | Long passphrase for nightly backups. Write it down with the recovery passphrase. |
| `BACKUP_HOST_DIR` | Folder on the USB drive or NAS, for example `/mnt/backup/ledger` or `E:/ledger-backups` |

The first start creates the office certificate authority and HTTPS certificate in `data/tls`, and the JWT secret in `data/keys`.

## 3) Set up WireGuard

Pick the office's public IP (or dynamic DNS name), then:

Linux:

```sh
sudo sh scripts/wireguard/setup-server.sh 203.0.113.10
```

Windows (Administrator PowerShell):

```powershell
.\scripts\wireguard\setup-server.ps1 -Endpoint 203.0.113.10
```

On the router, forward **UDP 51820 only** to the box's LAN IP. Do not forward 80 or 443. Give the box a fixed LAN IP (DHCP reservation) so the forward keeps working.

## 4) First-time company setup

On the box itself, or on a phone after step 5, open `https://10.8.0.1/setup` (or `https://localhost/setup` on the box):

1. Upload the license file you received.
2. Create the owner account.
3. Choose the recovery passphrase and type it twice.
4. Download the recovery kit. Store it off the box: a USB stick at home, plus a printed copy.

Keep the recovery passphrase and backup passphrase on paper in a safe place. Without them, a dead box cannot be restored, and no one can reset them.

## 5) Add a phone

For each staff phone, on the box:

```sh
sudo sh scripts/wireguard/add-phone.sh ravi-phone         # Linux
```
```powershell
.\scripts\wireguard\add-phone.ps1 -Name ravi-phone        # Windows, from the repo folder
```

On the phone:

1. Install the **WireGuard** app (App Store or Play Store), tap **+ → Scan from QR code**, and scan the code. Turn the tunnel on.
2. Open `http://10.8.0.1` and tap **Download certificate**, then install it:
   - iPhone: Settings → General → VPN & Device Management → install the profile, then Settings → General → About → Certificate Trust Settings → turn it on.
   - Android: Settings → Security → Encryption & credentials → Install a certificate → CA certificate.
3. Open `https://10.8.0.1`, sign in, and use **Add to Home Screen**.

In the WireGuard app you can set the tunnel to turn on automatically ("On-Demand" on iPhone, "Always-on VPN" on Android). Only traffic to the box goes through it; everything else on the phone uses the normal internet.

## 6) Remove a phone

If a phone is lost or someone leaves:

```sh
sudo sh scripts/wireguard/remove-phone.sh ravi-phone      # Linux
```
```powershell
.\scripts\wireguard\remove-phone.ps1 -Name ravi-phone     # Windows
```

Then disable their account in **Settings → Users**. The phone loses access immediately.

## 7) Backups

Every night at `NIGHTLY_HOUR` (default 2 AM) the box checks the fingerprint chain and writes an encrypted `ledger-<date>.lbk` file to `BACKUP_HOST_DIR`, keeping the newest `BACKUP_KEEP` files (default 30). Copy one to a second place each week, for example a drive the owner takes home.

Run a backup now:

```sh
docker compose exec app node apps/api/dist/box-cli.js backup
```

## 8) Restore onto a new box

1. Install the app on the new machine (step 2) with the same `.env`, but do **not** run setup.
2. Copy the `.lbk` file into the backup folder.
3. Stop the app and restore:

```sh
docker compose stop app
docker compose run --rm app node apps/api/dist/box-cli.js restore /backups/ledger-2026-11-05T02-00-00.lbk
docker compose start app
```

It asks for the backup passphrase and the recovery passphrase, checks the whole file before changing anything, recovers the data key, and confirms the fingerprint chain. Phones need the new box's `ca.crt` installed again, and new WireGuard configs if the box's keys changed.

## 9) Check the ledger

**Settings → Data protection → Verify ledger** recomputes every fingerprint. Each phone also re-checks the last point it saw every few minutes and shows a red banner if history on the box was changed. From the box:

```sh
docker compose exec app node apps/api/dist/box-cli.js verify-chain
```

## 10) Updates

```sh
git pull
docker compose up -d --build
```

Database migrations run automatically on start. Take a backup first.

## 11) Licenses (app maker only)

On the app maker's PC, once:

```sh
npm run license:keygen
```

This writes the signing key to `~/.ledger-vendor/` and the public key into `apps/api/src/license-key.ts`. Rebuild after keygen. Keep the signing key off every customer machine and out of git.

For each sale:

```sh
npm run license:issue -- --company "Ravi Traders" --users 10 --out ravi.license.json
```

Send the file to the customer. It never expires and is checked offline. To raise the seat limit, issue a new file; the owner uploads it in setup on a new box. (Re-licensing an existing box is not built yet.)
