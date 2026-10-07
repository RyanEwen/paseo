#!/usr/bin/env bash
# Run only Hermes in a bounded service; the sampler and Actions runner stay outside it.
set -euo pipefail

if [[ ${GITHUB_ACTIONS:-} != true || ${RUNNER_OS:-} != Linux ]]; then
  echo "The temporary Hermes resource driver is restricted to Linux GitHub Actions runners" >&2
  exit 1
fi

script_dir="$(cd "$(dirname "$0")" && pwd)"
swap_file="$RUNNER_TEMP/paseo-hermes.swap"
unit="paseo-hermes-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.service"
receipt="$RUNNER_TEMP/paseo-hermes-exit-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.txt"
sampler_pid=""
driver_pid=""
swap_active=false
swap_created=false

# Never unlink active swap. Refuse assembly if its pages cannot be reclaimed safely.
cleanup() {
  local result=$?
  trap - EXIT INT TERM
  set +e
  sudo systemctl show "$unit" -p Result -p ExecMainCode -p ExecMainStatus -p MemoryPeak -p MemorySwapPeak
  sudo systemctl stop "$unit" >/dev/null 2>&1
  if [[ -n $driver_pid ]]; then wait "$driver_pid"; fi
  if [[ -n $sampler_pid ]]; then kill "$sampler_pid"; wait "$sampler_pid"; fi
  sudo systemctl show "$unit" -p Result -p ExecMainCode -p ExecMainStatus -p MemoryPeak -p MemorySwapPeak
  sudo journalctl -k --since '-40 minutes' --no-pager | tail -80
  sudo journalctl -u systemd-oomd --since '-40 minutes' --no-pager | tail -40
  if ! $swap_created; then exit "$result"; fi
  # Cancellation may arrive immediately after swapon, before the launch flag changes.
  local swap_rows
  # Bare --show restores the default columns even alongside --output on util-linux.
  if swap_rows="$(sudo swapon --show=NAME,USED --bytes --noheadings)"; then
    swap_active=false
    if awk -v file="$swap_file" '$1 == file {found=1} END {exit !found}' <<< "$swap_rows"; then swap_active=true; fi
  else
    echo "Cannot verify temporary swap activation; refusing cleanup deletion" >&2
    swap_active=true
    result=1
  fi
  if $swap_active; then
    local used available
    used="$(awk -v file="$swap_file" '$1 == file {print $2}' <<< "$swap_rows")"
    available="$(awk '/MemAvailable:/ {printf "%.0f", $2 * 1024}' /proc/meminfo)"
    if [[ $used =~ ^[0-9]+$ && $available =~ ^[0-9]+$ ]] && (( available >= used + 3 * 1024 ** 3 )); then
      if sudo swapoff "$swap_file"; then swap_active=false; else result=1; fi
    else
      echo "Cannot safely reclaim temporary swap: used=$used available=$available; refusing native assembly" >&2
      result=1
    fi
  fi
  if $swap_created && ! $swap_active; then sudo rm -f "$swap_file" || result=1; fi
  sudo systemctl reset-failed "$unit" >/dev/null 2>&1
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Check the filesystem that will actually hold swap, without removing SDKs or caches.
free_disk="$(df -B1 --output=avail "$RUNNER_TEMP" | tail -1 | tr -d ' ')"
available_memory="$(awk '/MemAvailable:/ {printf "%.0f", $2 * 1024}' /proc/meminfo)"
limits=()
grep -qw memory /sys/fs/cgroup/cgroup.controllers || { echo "Missing cgroup v2 memory controller" >&2; exit 1; }
for group in /sys/fs/cgroup /sys/fs/cgroup/system.slice; do
  # The real hierarchy root has no memory.max; its root controller is unconstrained.
  if [[ $group == /sys/fs/cgroup && ! -f $group/memory.max ]]; then
    limits+=(max)
    continue
  fi
  [[ -f $group/memory.max && -f $group/memory.swap.max ]] || { echo "Missing cgroup v2 memory controls: $group" >&2; exit 1; }
  limits+=("$(cat "$group/memory.max")")
  swap_limit="$(cat "$group/memory.swap.max")"
  if [[ $swap_limit != max ]]; then
    echo "Finite shared ancestor swap limits are unsupported: $group $swap_limit" >&2
    exit 1
  fi
done
read -r ram_budget swap_budget < <(node "$script_dir/android-compiler-budget.mjs" "$free_disk" "$available_memory" "${limits[@]}")
echo "Hermes budget: RAM=$ram_budget swap=$swap_budget free_disk=$free_disk"
free -h
df -h "$RUNNER_TEMP"
ps -eo pid,ppid,rss,comm --sort=-rss | head -25 || true
echo "Hermes command arguments:"
printf '%q ' "$@"
printf '\n'
sha256sum "$1"
"$1" -version

[[ ! -e $swap_file ]] || { echo "Temporary swap path already exists" >&2; exit 1; }
swap_created=true
sudo fallocate -l "$swap_budget" "$swap_file"
sudo chmod 600 "$swap_file"
sudo mkswap "$swap_file"
sudo swapon "$swap_file"
swap_active=true
rm -f "$receipt"

# Stream evidence throughout compilation, even if no exit report or artifact upload survives.
sample() {
  local group pid
  while true; do
    echo "Hermes memory sample $(date -u +%FT%TZ) UTC"
    grep -E 'MemAvailable|SwapTotal|SwapFree' /proc/meminfo
    cat /proc/pressure/memory
    df -B1 --output=avail "$RUNNER_TEMP" | tail -1
    group="$(sudo systemctl show "$unit" -p ControlGroup --value 2>/dev/null || true)"
    if [[ -n $group && -d /sys/fs/cgroup$group ]]; then
      for metric in memory.current memory.peak memory.max memory.swap.current memory.swap.max memory.events memory.pressure cgroup.procs; do
        echo "$metric"
        cat "/sys/fs/cgroup$group/$metric" 2>/dev/null || true
      done
      while read -r pid; do
        grep -E 'Name:|VmRSS:|VmSwap:' "/proc/$pid/status" 2>/dev/null || true
      done < "/sys/fs/cgroup$group/cgroup.procs" || true
    fi
    sleep 5
  done
}
sample &
sampler_pid=$!
sudo systemd-run --unit="$unit" --slice=system.slice --wait --pipe \
  --uid="$(id -u)" --gid="$(id -g)" --working-directory="$PWD" \
  --property="MemoryMax=$ram_budget" --property="MemorySwapMax=$swap_budget" \
  --property=OOMPolicy=kill \
  --property=TimeoutStopSec=15s \
  /bin/bash "$script_dir/android-hermes-result.sh" "$receipt" "$@" &
driver_pid=$!

# Verify systemd applied the limits before trusting this experiment.
limits_verified=false
for attempt in {1..50}; do
  group="$(sudo systemctl show "$unit" -p ControlGroup --value 2>/dev/null || true)"
  if [[ -n $group && -f /sys/fs/cgroup$group/memory.max ]]; then
    [[ $(cat "/sys/fs/cgroup$group/memory.max") == "$ram_budget" && $(cat "/sys/fs/cgroup$group/memory.swap.max") == "$swap_budget" ]] || exit 1
    limits_verified=true
    break
  fi
  if ! kill -0 "$driver_pid" 2>/dev/null; then break; fi
  sleep 0.1
done
$limits_verified || { echo "Compiler cgroup limits could not be verified" >&2; exit 1; }
kill -0 "$sampler_pid" || { echo "Compiler memory sampler exited unexpectedly" >&2; exit 1; }
set +e
wait "$driver_pid"
result=$?
driver_pid=""
set -e
echo "Hermes service exit status: $result (timeout command uses 124; inspect service Result for oom-kill)"
if [[ ! -f $receipt || $(cat "$receipt") != 0 ]]; then
  echo "Hermes did not record a normal successful compiler exit" >&2
  exit 1
fi
exit "$result"
