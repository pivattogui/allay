#!/bin/sh
# Fake Minecraft server for runtime tests.
# Env contract:
#   FAKE_BEHAVIOR=ok           run until SIGTERM (exit 0 on TERM)
#   FAKE_BEHAVIOR=early-crash  print an error to stdout and exit 1 immediately
#   FAKE_BEHAVIOR=ignore-term  ignore SIGTERM (forces the SIGKILL path)
#   FAKE_CRASH_FILE=<path>     (optional, any behavior) exit 1 as soon as the
#                              file exists — lets tests trigger a crash
#                              deterministically AFTER reaching running.
# Writes "Done"-style lines to logs/latest.log like the real server.

if [ "$1" = "-version" ]; then
  echo 'openjdk version "21.0.1"' >&2
  exit 0
fi

mkdir -p logs
case "$FAKE_BEHAVIOR" in
  early-crash)
    echo "Error occurred during initialization of VM"
    echo "Could not reserve enough space for object heap"
    exit 1
    ;;
  ignore-term)
    trap '' TERM
    ;;
  *)
    trap 'exit 0' TERM
    ;;
esac

echo "[12:00:00 INFO]: Starting minecraft server" >> logs/latest.log
echo "[12:00:01 INFO]: Done (1.0s)! For help, type \"help\"" >> logs/latest.log

while true; do
  if [ -n "$FAKE_CRASH_FILE" ] && [ -e "$FAKE_CRASH_FILE" ]; then
    exit 1
  fi
  sleep 0.1
done
