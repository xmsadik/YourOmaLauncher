#!/bin/bash
# Runs lib/*.js inside Qt's V4 engine (the engine omarchy-shell uses). Needs qml6 (qt6-declarative).
set -euo pipefail
cd "$(dirname "$0")"
QML_XHR_ALLOW_FILE_READ=1 QT_QPA_PLATFORM=offscreen QT_FORCE_STDERR_LOGGING=1 exec qml6 V4Smoke.qml
