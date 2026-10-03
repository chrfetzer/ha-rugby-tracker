"""Data coordinator: follows one team across all competitions."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.storage import Store
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from .api import EspnClient, EspnError, parse_summary
from .const import (
    CONF_BROADCASTS,
    CONF_HISTORY_YEARS,
    CONF_KICKOFF_NOTICE,
    CONF_TEAM_ID,
    CONF_TEAM_NAME,
    DEFAULT_BROADCASTS,
    DEFAULT_HISTORY_YEARS,
    DEFAULT_KICKOFF_NOTICE,
    DOMAIN,
    EVENT_TYPE,
    INDEX_MAX_AGE,
    INTERVAL_IDLE,
    INTERVAL_LIVE,
    INTERVAL_SOON,
    LIVE_WINDOW_AFTER,
    LIVE_WINDOW_BEFORE,
    LOGGER,
    UPCOMING_MAX_AGE,
    UPCOMING_NEAR_MAX_AGE,
)

STORAGE_VERSION = 1
_FETCH_LIMIT = asyncio.Semaphore(4)

type RugbyConfigEntry = ConfigEntry[RugbyCoordinator]


def parse_broadcast_rules(text: str) -> list[tuple[str, list[str]]]:
    """Parse "competition substring = channel, channel" lines."""
    rules = []
    for line in (text or "").splitlines():
        if "=" not in line:
            continue
        key, _, channels = line.partition("=")
        names = [c.strip() for c in channels.split(",") if c.strip()]
        if key.strip() and names:
            rules.append((key.strip().lower(), names))
    return rules


def channels_for(league: str, rules: list[tuple[str, list[str]]]) -> list[str]:
    fallback: list[str] = []
    for key, names in rules:
        if key == "*":
            fallback = names
        elif key in league.lower():
            return names
    return fallback


class RugbyCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Polls ESPN; fast while a match is live, slow otherwise."""

    config_entry: RugbyConfigEntry

    def __init__(self, hass: HomeAssistant, entry: RugbyConfigEntry) -> None:
        super().__init__(
            hass,
            LOGGER,
            config_entry=entry,
            name=f"{DOMAIN} {entry.data[CONF_TEAM_NAME]}",
            update_interval=INTERVAL_IDLE,
        )
        self.api = EspnClient(async_get_clientsession(hass))
        self.team_id: str = entry.data[CONF_TEAM_ID]
        self.team_name: str = entry.data[CONF_TEAM_NAME]
        self._store: Store[dict] = Store(hass, STORAGE_VERSION, f"{DOMAIN}.{self.team_id}")
        self._index: dict[str, str] = {}
        self._index_at: datetime | None = None
        self._matches: dict[str, dict] = {}
        self._fetched_at: dict[str, datetime] = {}
        self._timelines: dict[str, list] = {}
        self._lineups: dict[str, dict] = {}
        self._standings: dict[str, dict] = {}
        self._kickoff_noticed: set[str] = set()
        self._team_info: dict[str, Any] = {"id": self.team_id, "name": self.team_name}

    @property
    def _options(self) -> dict[str, Any]:
        return self.config_entry.options

    async def _async_setup(self) -> None:
        stored = await self._store.async_load() or {}
        for match in stored.get("finished", {}).values():
            self._matches[match["id"]] = match
        self._timelines.update(stored.get("timelines", {}))

    # ------------------------------------------------------------------ fetching

    async def _refresh_index(self, now: datetime) -> None:
        years_back = int(self._options.get(CONF_HISTORY_YEARS, DEFAULT_HISTORY_YEARS))
        years = range(now.year - years_back + 1, now.year + 2)
        results = await asyncio.gather(
            *(self.api.team_events(self.team_id, y) for y in years), return_exceptions=True
        )
        index: dict[str, str] = {}
        for result in results:
            if isinstance(result, Exception):
                raise result
            index.update(result)
        self._index = index
        self._index_at = now
        for stale in set(self._matches) - set(index):
            self._matches.pop(stale, None)

    def _needs_fetch(self, event_id: str, now: datetime) -> bool:
        match = self._matches.get(event_id)
        if match is None:
            return True
        if match["state"] == "post":
            return False
        if match["state"] == "in":
            return True
        kickoff = _parse_dt(match["date"])
        if kickoff is None:
            return True
        if kickoff - LIVE_WINDOW_BEFORE <= now <= kickoff + LIVE_WINDOW_AFTER:
            return True
        last = self._fetched_at.get(event_id)
        if last is None:
            return True
        max_age = UPCOMING_NEAR_MAX_AGE if kickoff - now < timedelta(days=1) else UPCOMING_MAX_AGE
        return now - last > max_age

    async def _fetch(self, event_id: str) -> dict | None:
        league_id = self._index[event_id]
        async with _FETCH_LIMIT:
            try:
                return parse_summary(
                    league_id, event_id, await self.api.summary(league_id, event_id)
                )
            except EspnError as err:
                LOGGER.debug("Could not fetch event %s: %s", event_id, err)
                return None

    async def _async_update_data(self) -> dict[str, Any]:
        now = dt_util.utcnow()
        if self._index_at is None or now - self._index_at > INDEX_MAX_AGE:
            try:
                await self._refresh_index(now)
            except EspnError as err:
                if not self._index:
                    raise UpdateFailed(f"ESPN not reachable: {err}") from err
                LOGGER.warning("Keeping old fixture list, ESPN error: %s", err)

        due = [eid for eid in self._index if self._needs_fetch(eid, now)]
        # Fetch one past match per competition we have no table for yet.
        for league_id in {self._index[e] for e in self._index} - set(self._standings):
            candidates = [e for e in self._index if self._index[e] == league_id]
            latest = max(candidates, key=lambda e: self._matches.get(e, {}).get("date") or "")
            if latest not in due:
                due.append(latest)

        parsed = await asyncio.gather(*(self._fetch(eid) for eid in due))
        newly_finished = False
        for result in parsed:
            if result is None:
                continue
            match = result["match"]
            eid = match["id"]
            previous = self._matches.get(eid)
            self._capture_team_info(match)
            self._fire_events(previous, match, result["timeline"], now)
            if match["state"] == "post" and (previous is None or previous["state"] != "post"):
                newly_finished = True
            self._matches[eid] = match
            self._fetched_at[eid] = now
            if result["timeline"]:
                self._timelines[eid] = result["timeline"]
            if result["lineups"]:
                self._lineups[eid] = result["lineups"]
            league_key = match["league_id"]
            if result["standings"]:
                self._standings[league_key] = {
                    "league": match["league"],
                    "season": match["season"],
                    "groups": result["standings"],
                }
            else:
                self._standings.setdefault(league_key, {})

        if newly_finished:
            self._save()
        self.update_interval = self._next_interval(now)
        return self._build(now)

    def _capture_team_info(self, match: dict) -> None:
        for side in ("home", "away"):
            team = match[side]
            if team["id"] == self.team_id:
                self._team_info = {
                    "id": self.team_id,
                    "name": team["name"],
                    "abbr": team["abbr"],
                    "color": team["color"],
                    "logo": team["logo"],
                    "flag": team["flag"],
                }

    def _save(self) -> None:
        finished = {k: m for k, m in self._matches.items() if m["state"] == "post"}
        timelines = {k: t for k, t in self._timelines.items() if k in finished}
        self._store.async_delay_save(
            lambda: {"finished": finished, "timelines": timelines}, 5
        )

    def _next_interval(self, now: datetime) -> timedelta:
        soonest = None
        for match in self._matches.values():
            if match["state"] == "in":
                return INTERVAL_LIVE
            if match["state"] != "pre":
                continue
            kickoff = _parse_dt(match["date"])
            if kickoff is None:
                continue
            if kickoff - LIVE_WINDOW_BEFORE <= now <= kickoff + LIVE_WINDOW_AFTER:
                return INTERVAL_LIVE
            if kickoff > now and (soonest is None or kickoff < soonest):
                soonest = kickoff
        if soonest is not None:
            until = soonest - now
            if until < timedelta(hours=3):
                # Wake up right when the live window opens.
                return max(min(INTERVAL_SOON, until - LIVE_WINDOW_BEFORE), INTERVAL_LIVE)
        return INTERVAL_IDLE

    # ------------------------------------------------------------------ events

    def _fire_events(
        self, prev: dict | None, match: dict, timeline: list, now: datetime
    ) -> None:
        eid = match["id"]
        notice = timedelta(
            minutes=int(self._options.get(CONF_KICKOFF_NOTICE, DEFAULT_KICKOFF_NOTICE))
        )
        kickoff = _parse_dt(match["date"])
        if (
            match["state"] == "pre"
            and kickoff
            and now < kickoff <= now + notice
            and eid not in self._kickoff_noticed
        ):
            self._kickoff_noticed.add(eid)
            self._fire("kickoff_soon", match, minutes=round((kickoff - now).seconds / 60))

        if prev is None:
            return
        if prev["state"] == "pre" and match["state"] == "in":
            self._fire("kickoff", match)
        for side in ("home", "away"):
            old, new = prev[side]["score"] or 0, match[side]["score"] or 0
            if new > old:
                team_id = match[side]["id"]
                # Scoring plays since the last poll; a try outranks its conversion.
                plays = [
                    e
                    for e in timeline
                    if e["team_id"] == team_id
                    and "card" not in e["type"].lower()
                    and (e[side] is None or e[side] > old)
                ]
                key = next((e for e in plays if "try" in e["type"].lower()), None)
                key = key or (plays[-1] if plays else None)
                self._fire(
                    "score",
                    match,
                    scoring_team=match[side]["name"],
                    scoring_team_id=team_id,
                    points=new - old,
                    score_type=key["type"] if key else None,
                    player=key["player"] if key else None,
                    plays=[f"{e['type']} {e['player'] or ''}".strip() for e in plays],
                )
        if prev["status"] != match["status"] and match["status"] == "STATUS_HALFTIME":
            self._fire("halftime", match)
        if prev["state"] != "post" and match["state"] == "post":
            self._fire("full_time", match)

    def _fire(self, kind: str, match: dict, **extra: Any) -> None:
        home, away = match["home"], match["away"]
        tracked = home if home["id"] == self.team_id else away
        opponent = away if tracked is home else home
        data = {
            "type": kind,
            "team_id": self.team_id,
            "team": self.team_name,
            "match_id": match["id"],
            "competition": match["league"],
            "home": home["name"],
            "away": away["name"],
            "home_score": home["score"],
            "away_score": away["score"],
            "opponent": opponent["name"],
            "team_score": tracked["score"],
            "opponent_score": opponent["score"],
            "clock": match["clock"],
            "tv": self._channels(match),
            **extra,
        }
        if kind == "full_time":
            data["result"] = _result(tracked["score"], opponent["score"])
        LOGGER.debug("Firing %s: %s", EVENT_TYPE, data)
        self.hass.bus.async_fire(EVENT_TYPE, data)

    # ------------------------------------------------------------------ output

    def _channels(self, match: dict) -> list[str]:
        rules = parse_broadcast_rules(self._options.get(CONF_BROADCASTS, DEFAULT_BROADCASTS))
        return channels_for(match["league"], rules)

    def _build(self, now: datetime) -> dict[str, Any]:
        matches = []
        for match in sorted(self._matches.values(), key=lambda m: m["date"] or ""):
            if match["home"]["id"] != self.team_id and match["away"]["id"] != self.team_id:
                continue
            tracked_home = match["home"]["id"] == self.team_id
            us = match["home" if tracked_home else "away"]
            them = match["away" if tracked_home else "home"]
            item = dict(match)
            item["is_home"] = tracked_home
            item["tv_de"] = self._channels(match)
            item["result"] = (
                _result(us["score"], them["score"]) if match["state"] == "post" else None
            )
            matches.append(item)

        live = [m for m in matches if m["state"] == "in"]
        upcoming = [m for m in matches if m["state"] == "pre"]
        past = [m for m in matches if m["state"] == "post"]
        nxt = upcoming[0] if upcoming else None
        last = past[-1] if past else None

        focus_ids = {m["id"] for m in live} | {m["id"] for m in (nxt, last) if m}
        return {
            "team": self._team_info,
            "matches": matches,
            "live": live,
            "next": nxt,
            "last": last,
            "timelines": {k: v for k, v in self._timelines.items() if k in focus_ids},
            "lineups": {k: v for k, v in self._lineups.items() if k in focus_ids},
            "standings": {k: v for k, v in self._standings.items() if v.get("groups")},
            "updated": now.isoformat(),
        }


def _parse_dt(value: str | None) -> datetime | None:
    return dt_util.parse_datetime(value) if value else None


def _result(us: int | None, them: int | None) -> str | None:
    if us is None or them is None:
        return None
    return "W" if us > them else "L" if us < them else "D"
