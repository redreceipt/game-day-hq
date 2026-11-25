# Game Day HQ for Kindle Keyboard

A standalone native app for the 600 × 800 Kindle Keyboard (Kindle 3). It draws its own black-and-white score and lineup screens and uses the physical five-way controller. There is no HTML, web browser, Amazon account, or ESPN login in the app.

- **Left / Right** or the page buttons: switch between the matchup and starters.
- **Center** or **R**: refresh from the relay.
- **Back** or **Q**: close and release the keys. Press **Home** if the stock screen hasn’t redrawn.
- Offline, the app retains the last good update. Before any live update, it shows a clearly labeled sample board.

## Build and copy over USB

Build on Linux with Node.js and Zig 0.15.2. For host previews, use a Linux C compiler instead of Zig.

```sh
make -C kindle kindle
make -C kindle preview
```

On the Kindle USB volume:

1. Create a `game-day-hq` folder and copy `kindle/build/gameday`, `kindle/build/demo-score.txt`, and `kindle/launch.sh` into it.
2. Copy `kindle/launchpad.ini` into the volume’s `launchpad` folder as `game-day-hq.ini`. Do not replace the launcher’s own `launchpad.ini`.
3. Put the relay computer’s private IPv4 address in `game-day-hq/host.txt`, one line, no URL or port.
4. Eject the volume. If Launchpad is already installed, press **Shift**, **Shift**, **Space** in sequence on the Kindle Home screen to reload its shortcuts. Then press **Shift**, **G** in quick succession to open Game Day HQ.

If Launchpad is not installed, use the [original Launchpad release](https://www.mobileread.com/forums/showthread.php?t=97636) on an **already-jailbroken** Kindle. Match the installer to the exact hardware; `B006` is the U.S. 3G Kindle Keyboard and uses `update_launchpad_0.0.1d_k3g_install.bin`. Copy that file to the USB volume’s root, eject and unplug, then choose **Home → Menu → Settings → Menu → Update Your Kindle**. This installs the launcher; Game Day HQ itself doesn’t patch the firmware. If the update is unavailable or fails, don’t force it.

## Run the home Wi-Fi relay

The Kindle speaks a small read-only feed over your local network. A computer on the same trusted Wi-Fi uses modern HTTPS to contact ESPN. Keep the computer awake and never port-forward the relay.

```sh
# Replace the example IP with the computer's actual Wi-Fi address.
node kindle/relay.mjs --host 192.168.1.10
# Optional live mode. Get the three values from a public ESPN team link.
node kindle/relay.mjs --host 192.168.1.10 --season 2026 --league LEAGUE_ID --team TEAM_ID
```

The Kindle refreshes on launch and on demand. Live mode follows ESPN’s current week. If the relay computer’s address changes, update the Kindle’s `host.txt`. The relay shares only the upstream feed adapter with the website; no web UI is used, and local team selection and the relay address aren’t committed.

Font: [font8x8](https://github.com/dhepper/font8x8), public domain.
