#!/bin/bash
export PATH="/opt/homebrew/bin:/opt/homebrew/Cellar/node/23.11.0/bin:/usr/local/bin:/usr/bin:/bin"
export NODE="/opt/homebrew/Cellar/node/23.11.0/bin/node"
cd "$(dirname "$0")"
exec /opt/homebrew/Cellar/node/23.11.0/bin/node node_modules/next/dist/bin/next dev
