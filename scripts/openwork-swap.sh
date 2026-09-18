#!/usr/bin/env bash
#
# openwork-swap.sh — swap / restore the OpenWork AppImage with its data.
#
# Everything the app writes (workspaces, chats, tokens, server config,
# runtime.sqlite) lives in Electron's userData dir, NOT inside the AppImage.
# This script snapshots both, so you can swap the binary and roll back if
# the new build misbehaves.
#
# Usage:
#   openwork-swap.sh help
#   openwork-swap.sh list
#   openwork-swap.sh backup [<tag>]            snapshot binary + data now
#   openwork-swap.sh install <new.appimage>    backup current, then swap in new
#   openwork-swap.sh restore [<tag>]           restore last (or named) backup
#   openwork-swap.sh prune [--keep N]          drop old backups (default keep 3)
#
#   install and restore first close any running OpenWork gracefully: SIGTERM,
#   wait up to 15s, then SIGKILL if it refuses to exit.
#
# Overrides (env):
#   OPENWORK_APP_DIR      dir holding the AppImage      (default ~/Applications)
#   OPENWORK_DATA_DIR     Electron userData dir         (default ~/.config/com.differentai.openwork)
#   OPENWORK_BACKUP_DIR   where snapshots go            (default ~/.cache/openwork-swap)
#   OPENWORK_APPIMAGE     exact AppImage file name      (default detected)
#
set -euo pipefail

APP_DIR="${OPENWORK_APP_DIR:-$HOME/Applications}"
DATA_DIR="${OPENWORK_DATA_DIR:-$HOME/.config/com.differentai.openwork}"
BACKUP_DIR="${OPENWORK_BACKUP_DIR:-$HOME/.cache/openwork-swap}"
KEEP="${OPENWORK_KEEP:-3}"

msg()  { printf '\033[1;36m[openwork-swap]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[openwork-swap]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[openwork-swap]\033[0m %s\n' "$*" >&2; exit 1; }

detect_appimage() {
  local matches
  matches=$(find "$APP_DIR" -maxdepth 1 -type f -name 'openwork-*.appimage' -printf '%f\n' 2>/dev/null | sort)
  if [[ -z "$matches" ]]; then
    die "no openwork-*.appimage found in $APP_DIR (set OPENWORK_APPIMAGE)"
  fi
  if [[ $(printf '%s\n' "$matches" | grep -c .) -gt 1 ]]; then
    warn "multiple AppImages in $APP_DIR:"
    printf '%s\n' "$matches" | sed 's/^/    /' >&2
    die "set OPENWORK_APPIMAGE to choose one"
  fi
  printf '%s\n' "$matches"
}

appimage_path() { printf '%s/%s' "$APP_DIR" "$(detect_appimage)"; }

# Only ever match the real OpenWork binary (process name `openwork`) plus
# AppImage FUSE mount dirs. NEVER a broad `pgrep -f openwork`, because the
# shell that launches this script has "openwork" (and the .appimage path) in
# its own command line and would be killed instead.
openwork_pids() {
  ( pgrep -x openwork 2>/dev/null || true; pgrep -f '/tmp/[^ ]*\.mount_[^ ]*openwork' 2>/dev/null || true ) | sort -u
}

is_running() {
  [[ -n "$(openwork_pids)" ]]
}

terminate_openwork() {
  local pids p waited=0
  pids="$(openwork_pids)"
  if [[ -z "$pids" ]]; then
    msg "no running OpenWork session to stop"
    return 0
  fi
  p="$(printf '%s ' $pids | tr '\n' ' ')"
  msg "closing running OpenWork (pid(s): ${p% })..."
  for p in $pids; do kill -TERM "$p" 2>/dev/null || true; done
  while (( waited < 15 )); do
    if [[ -z "$(openwork_pids)" ]]; then
      msg "OpenWork exited cleanly"
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  warn "OpenWork still up after 15s; forcing quit..."
  for p in $pids; do kill -KILL "$p" 2>/dev/null || true; done
  sleep 2
  if [[ -n "$(openwork_pids)" ]]; then
    die "could not stop OpenWork — close it manually and re-run"
  fi
  msg "OpenWork stopped (forced)"
}

mktag() { date +%Y%m%d-%H%M%S; }

snapshot() {
  local tag="$1"
  local snap="$BACKUP_DIR/$tag"
  local app_file
  app_file="$(detect_appimage 2>/dev/null | head -1)" || app_file=""

  mkdir -p "$snap"
  {
    printf 'tag      : %s\n' "$tag"
    printf 'created  : %s\n' "$(date -Is)"
    printf 'app_dir  : %s\n' "$APP_DIR"
    printf 'app_file : %s\n' "${app_file:-<none>}"
    printf 'data_dir : %s\n' "$DATA_DIR"
  } > "$snap/MANIFEST.txt"

  if [[ -n "$app_file" && -f "$APP_DIR/$app_file" ]]; then
    cp -a "$APP_DIR/$app_file" "$snap/app.appimage"
    msg "saved binary: $APP_DIR/$app_file"
  else
    warn "no AppImage present; backing up data only"
  fi

  if [[ -d "$DATA_DIR" ]]; then
    cp -a "$DATA_DIR" "$snap/data"
    msg "saved data: $DATA_DIR"
  else
    warn "data dir missing ($DATA_DIR); nothing to back up"
  fi

  printf '%s\n' "$tag" > "$BACKUP_DIR/LATEST"
  msg "backup complete: $snap"
}

do_backup() {
  local tag="${1:-$(mktag)}"
  mkdir -p "$BACKUP_DIR"
  if is_running; then
    warn "app is running — data snapshot may catch a half-written sqlite; close it for a clean backup"
  fi
  snapshot "$tag"
  prune "$KEEP"
}

do_install() {
  local new="${1:-}"
  [[ -f "$new" ]] || die "AppImage not found: $new"
  mkdir -p "$BACKUP_DIR"
  terminate_openwork
  local tag="pre-install-$(mktag)"
  snapshot "$tag"
  local target
  target="$(appimage_path)"
  local target_bak="${target}.old"
  cp -a "$target" "$target_bak"
  cp -a "$new" "$target"
  chmod +x "$target"
  rm -f "$target_bak"
  msg "installed $new as $target ($(stat -c %s "$target") bytes)"
  msg "rollback snapshot kept at: $BACKUP_DIR/$tag"
  prune "$KEEP"
  msg "launch it — if anything's wrong, run: openwork-swap.sh restore"
}

do_restore() {
  local which
  if [[ -n "${1:-}" ]]; then
    which="$1"
  elif [[ -f "$BACKUP_DIR/LATEST" ]]; then
    which="$(cat "$BACKUP_DIR/LATEST")"
  else
    die "no backups; run 'openwork-swap.sh backup' first"
  fi
  local snap="$BACKUP_DIR/$which"
  [[ -d "$snap" ]] || die "backup not found: $which (see 'list')"
  terminate_openwork

  local current
  current="$(appimage_path)"
  cp -a "$current" "$current.mid-restore"
  if [[ -f "$snap/app.appimage" ]]; then
    cp -a "$snap/app.appimage" "$current"
    msg "binary restored"
  else
    warn "snapshot had no binary; leaving current binary in place"
  fi
  rm -f "$current.mid-restore"

  if [[ -d "$snap/data" ]]; then
    if [[ -d "$DATA_DIR" ]]; then
      mv "$DATA_DIR" "$DATA_DIR.old-$(mktag)"
    fi
    cp -a "$snap/data" "$DATA_DIR"
    msg "data restored to $DATA_DIR (pre-restore copy kept as $DATA_DIR.old-*)"
  else
    warn "snapshot had no data; data left untouched"
  fi
}

prune() {
  local keep="${1:-$KEEP}"
  [[ -d "$BACKUP_DIR" ]] || return 0
  local latest="" t count=0 tags
  # keep: the LATEST marker tag, plus the 'keep' newest other tags
  [[ -f "$BACKUP_DIR/LATEST" ]] && latest="$(cat "$BACKUP_DIR/LATEST")"
  tags=$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %f\n' 2>/dev/null | sort -rn | sed -E 's/^[0-9.]+ //')
  tags=$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %f\n' 2>/dev/null | sort -rn | sed -E 's/^[0-9.]+ //')
  if [[ -n "$tags" ]]; then
    while IFS= read -r t; do
      [[ -z "$t" ]] && continue
      [[ "$t" == "$latest" ]] && continue
      if (( count < keep )); then
        count=$((count + 1))
      else
        rm -rf "$BACKUP_DIR/$t"
        msg "pruned $t"
      fi
    done <<< "$tags"
  fi
}

cmd="${1:-help}"

case "$cmd" in
  help|-h|--help)
    sed -n '2,40p' "$0"
    ;;
  list)
    if [[ -d "$BACKUP_DIR" ]]; then
      find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | sort -r
    else
      die "no backups yet (run 'backup')"
    fi
    ;;
  backup)
    do_backup "${2:-}"
    ;;
  install)
    do_install "${2:-}"
    ;;
  restore)
    do_restore "${2:-}"
    ;;
  prune)
    if [[ "${2:-}" == "--keep" && -n "${3:-}" ]]; then
      prune "$3"
    else
      prune "${2:-$KEEP}"
    fi
    ;;
  *)
    die "unknown command: $cmd  (try: help)"
    ;;
esac