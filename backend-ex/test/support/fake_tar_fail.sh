#!/bin/sh
# Fake tar that always fails hard (exit 2). bsdtar on macOS collapses every
# filesystem error class to exit 1 (treated as success by the backup contract),
# so the >1 failure branch can't be reached from the real tar there. This stub
# drives that branch deterministically on any platform.
echo "fake tar: forced failure" 1>&2
exit 2
