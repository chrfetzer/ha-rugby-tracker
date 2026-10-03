"""Constants for the Rugby Tracker integration."""

from __future__ import annotations

from datetime import timedelta
import logging

DOMAIN = "rugby_tracker"
LOGGER = logging.getLogger(__package__)
VERSION = "0.1.1"

CONF_TEAM_ID = "team_id"
CONF_TEAM_NAME = "team_name"
CONF_TEAM_QUERY = "team_query"
CONF_HISTORY_YEARS = "history_years"
CONF_BROADCASTS = "broadcasts"
CONF_KICKOFF_NOTICE = "kickoff_notice_minutes"

DEFAULT_TEAM_QUERY = "South Africa"
DEFAULT_HISTORY_YEARS = 2
DEFAULT_KICKOFF_NOTICE = 30
# One rule per line: "<substring of competition name> = <channels>". "*" is the fallback.
DEFAULT_BROADCASTS = "* = ProSieben MAXX, ran.de, Joyn"

# Polling cadence
INTERVAL_LIVE = timedelta(seconds=20)
INTERVAL_SOON = timedelta(minutes=5)
INTERVAL_IDLE = timedelta(minutes=30)
INDEX_MAX_AGE = timedelta(hours=6)
UPCOMING_MAX_AGE = timedelta(hours=6)
UPCOMING_NEAR_MAX_AGE = timedelta(minutes=30)
LIVE_WINDOW_BEFORE = timedelta(minutes=20)
# A match whose kickoff passed but is not reported final yet is polled for this long.
LIVE_WINDOW_AFTER = timedelta(hours=4)

EVENT_TYPE = f"{DOMAIN}_event"

CARD_URL = f"/{DOMAIN}/rugby-tracker-card.js"
