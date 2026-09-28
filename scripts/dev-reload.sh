#!/bin/bash
# Development: validate the plugin and restart omarchy-shell so it runs the working copy.
# omarchy-shell doesn't pick up changed plugin code on a rescan, so a restart is the reliable path
# (the same thing Omarchy's own plugin docs and other plugins do). The bar blinks briefly.
set -euo pipefail
cd "$(dirname "$0")/.."
omarchy plugin validate .
omarchy restart shell
