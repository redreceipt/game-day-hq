#!/bin/sh
# Launchpad runs this after releasing its hotkey grab. No framework stop is needed.
cd /mnt/us/game-day-hq || exit 1
PATH=/usr/sbin:/usr/bin:/sbin:/bin:$PATH
export PATH
exec > /tmp/game-day-hq.log 2>&1
# Execute from RAM, even if the USB volume does not expose executable mode bits.
umask 077
run_dir=/tmp/game-day-hq-app.$$
mkdir "$run_dir" || exit 1
trap 'rm -f "$run_dir/gameday"; rmdir "$run_dir"' EXIT
cp gameday "$run_dir/gameday" && chmod 0700 "$run_dir/gameday" && "$run_dir/gameday"
