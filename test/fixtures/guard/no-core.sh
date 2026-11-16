#!/bin/sh
# test/fixtures/guard/no-core.sh — the Node that test/guard.test.mjs gives the guard: Node itself ($LTMS_NODE), with no
# core kept of a process that a signal ends (ulimit -c 0), so that the planted aborts leave none in the system's store.
ulimit -c 0
exec "$LTMS_NODE" "$@"
