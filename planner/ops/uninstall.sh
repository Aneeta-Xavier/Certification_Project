#!/bin/bash
# Stops Daybloom and removes the auto-start entry. Your data is left untouched.
LABEL="com.aneeta.daybloom"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "🌱 Daybloom auto-start removed. Data kept in ~/Library/Application Support/Daybloom."
