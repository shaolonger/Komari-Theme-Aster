#!/bin/sh
set -eu
[ -f /etc/alpine-release ] || exit 1
apk add --no-cache openrc curl
mkdir -p /run/openrc /fixture-bin
printf 'default\n' > /run/openrc/softlevel
printf '\nrc_cgroup_mode="none"\n' >> /etc/rc.conf
cat > /etc/init.d/fixture-net <<'SH'
#!/sbin/openrc-run
depend() { provide net; }
start() { return 0; }
stop() { return 0; }
SH
chmod 0755 /etc/init.d/fixture-net
rc-update add fixture-net default
rc-status -a >/dev/null
rc-service fixture-net start
syslogd -O /tmp/messages -s 64
# Redirect only the two fixed release artifacts to the locally packaged candidate.
cat > /fixture-bin/curl <<'SH'
#!/bin/sh
output=''
asset=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output=$2; shift 2 ;;
    https://github.com/shaolonger/Komari-Theme-Aster/releases/latest/download/Aster-Network-Observatory-latest.zip*) asset=${1##*/}; shift ;;
    *) shift ;;
  esac
done
case "$asset" in
  Aster-Network-Observatory-latest.zip|Aster-Network-Observatory-latest.zip.sha256) cp "/fixture/$asset" "$output" ;;
  *) echo 'Unexpected network request in lite installer fixture' >&2; exit 1 ;;
esac
SH
chmod 0755 /fixture-bin/curl
export PATH="/fixture-bin:$PATH"
sh /fixture/network-observatory/runner/quick-install.sh --server-url http://127.0.0.1:25774 --node-uuid c388e74d-a922-4ae1-bd10-1fb30e2e53de
test "$(cat /etc/aster-network-observatory/service-manager)" = openrc
test "$(cat /etc/aster-network-observatory/install-profile)" = lite
! command -v nexttrace
! command -v iperf3
! command -v nping
python3 /fixture/scripts/alpine-runner-fixture.py
printf '\nInstalled filesystem usage (KiB; fixture/proc/sys/dev excluded):\n'
du -skx /bin /sbin /lib /usr /etc /var /root /tmp
printf '\nAll Alpine 3.21 / 128 MiB OpenRC checks passed.\n'
