#!/bin/bash
# Opens Cadence. The app starts its own server when needed.
cd "$(dirname "$0")"
if [ -d "Cadence Studio.app/Contents/MacOS" ] && [ -x "Cadence Studio.app/Contents/MacOS/CadenceStudio" ]; then
  open "Cadence Studio.app"
else
  (lsof -i :3847 >/dev/null 2>&1) || (nohup node server.js > data/server.log 2>&1 &)
  sleep 1
  open "http://localhost:3847"
fi
