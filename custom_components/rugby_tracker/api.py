"""Thin client for ESPN's public rugby endpoints.

The core API lists every event of a team across all competitions, which is what
lets this integration follow one team without configuring each tournament.
The site "summary" endpoint then gives score, status, lineups, scoring events
and the tournament table for one event.
"""

from __future__ import annotations

import asyncio
import re
from typing import Any

import aiohttp

from .flags import abbreviation, flag_url

CORE = "https://sports.core.api.espn.com/v2/sports/rugby"
SITE = "https://site.api.espn.com/apis/site/v2/sports/rugby"
SEARCH = "https://site.web.api.espn.com/apis/common/v3/search"

_REF_RE = re.compile(r"leagues/(\d+)/events/(\d+)")
_TIMEOUT = aiohttp.ClientTimeout(total=20)

SCORING_TYPES = {"try", "penalty try", "conversion", "penalty goal", "drop goal"}
CARD_TYPES = {"yellow card", "red card"}


class EspnError(Exception):
    """Raised when ESPN cannot be reached or returns garbage."""


class EspnClient:
    """Fetch and normalise ESPN rugby data."""

    def __init__(self, session: aiohttp.ClientSession) -> None:
        self._session = session

    async def _get(self, url: str, params: dict[str, Any] | None = None) -> dict:
        try:
            async with self._session.get(url, params=params, timeout=_TIMEOUT) as resp:
                resp.raise_for_status()
                return await resp.json(content_type=None)
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError) as err:
            raise EspnError(f"{url}: {err}") from err

    async def search_teams(self, query: str) -> list[dict[str, str]]:
        data = await self._get(
            SEARCH, {"query": query, "type": "team", "sport": "rugby", "limit": 20}
        )
        return [
            {"id": str(item["id"]), "name": item.get("displayName", item["id"])}
            for item in data.get("items", [])
            if item.get("sport") == "rugby" and item.get("id")
        ]

    async def team_events(self, team_id: str, year: int) -> dict[str, str]:
        """Return {event_id: league_id} for one team and season year."""
        data = await self._get(
            f"{CORE}/teams/{team_id}/events", {"dates": year, "limit": 500}
        )
        result: dict[str, str] = {}
        for item in data.get("items", []):
            if match := _REF_RE.search(item.get("$ref", "")):
                result[match.group(2)] = match.group(1)
        return result

    async def summary(self, league_id: str, event_id: str) -> dict:
        return await self._get(f"{SITE}/{league_id}/summary", {"event": event_id})


def _team(competitor: dict) -> dict[str, Any]:
    team = competitor.get("team", {})
    logos = team.get("logos") or []
    logo = logos[0]["href"] if logos else team.get("logo")
    name = team.get("displayName") or team.get("name") or "?"
    return {
        "id": str(team.get("id", "")),
        "name": name,
        "abbr": abbreviation(name, team.get("abbreviation")),
        "color": team.get("color"),
        "logo": logo,
        "flag": flag_url(name),
        "score": _int(competitor.get("score")),
        "form": competitor.get("form"),
    }


def _int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def parse_summary(league_id: str, event_id: str, data: dict) -> dict[str, Any]:
    """Normalise a summary payload into match, standings, lineups and timeline."""
    header = data.get("header", {})
    comp = (header.get("competitions") or [{}])[0]
    league = header.get("league", {})
    season = header.get("season", {})
    status = comp.get("status", {})
    stype = status.get("type", {})

    home = away = None
    for competitor in comp.get("competitors", []):
        if competitor.get("homeAway") == "home":
            home = _team(competitor)
        else:
            away = _team(competitor)
    if home is None or away is None:
        raise EspnError(f"event {event_id} has no competitors")

    venue = (data.get("gameInfo") or {}).get("venue") or {}
    broadcasts = []
    for b in comp.get("broadcasts") or []:
        name = (b.get("media") or {}).get("shortName") or b.get("names", [None])[0]
        if name:
            broadcasts.append(name)

    timeline = [
        {
            "type": d.get("type", {}).get("text", ""),
            "team_id": str((d.get("team") or {}).get("id", "")),
            "player": ((d.get("participants") or [{}])[0].get("athlete") or {}).get(
                "displayName"
            ),
            "minute": (d.get("clock") or {}).get("displayValue"),
            "period": (d.get("period") or {}).get("number"),
            "home": d.get("homeScore"),
            "away": d.get("awayScore"),
        }
        for d in comp.get("details") or []
        if d.get("type", {}).get("text", "").lower() in SCORING_TYPES | CARD_TYPES
    ]
    timeline.sort(key=lambda e: ((e["period"] or 0), _minute(e["minute"])))

    clock = status.get("displayClock")
    if stype.get("state") == "in" and not clock and timeline:
        clock = timeline[-1]["minute"]

    match = {
        "id": event_id,
        "league_id": league_id,
        "league": league.get("name") or league.get("shortName") or "",
        "is_tournament": bool(league.get("isTournament")),
        "season": season.get("year"),
        "date": comp.get("date") or header.get("date"),
        "state": stype.get("state", "pre"),
        "status": stype.get("name", ""),
        "status_detail": stype.get("shortDetail") or stype.get("detail") or "",
        "clock": clock,
        "period": status.get("period"),
        "venue": venue.get("fullName"),
        "city": (venue.get("address") or {}).get("city"),
        "neutral": bool(comp.get("neutralSite")),
        "home": home,
        "away": away,
        "broadcasts": broadcasts,
        "url": f"https://www.espn.co.uk/rugby/match/_/gameId/{event_id}",
    }

    return {
        "match": match,
        "timeline": timeline,
        "lineups": _lineups(data.get("rosters") or []),
        "standings": _standings(data.get("standings") or {}),
    }


def _minute(value: str | None) -> int:
    digits = re.match(r"\d+", value or "")
    return int(digits.group()) if digits else 0


def _num(value: str | None) -> float:
    try:
        return float(str(value).replace("+", ""))
    except ValueError:
        return 0.0


def _lineups(rosters: list[dict]) -> dict[str, list[dict]]:
    result: dict[str, list[dict]] = {}
    for roster in rosters:
        team_id = str((roster.get("team") or {}).get("id", ""))
        players = []
        for p in roster.get("roster") or []:
            athlete = p.get("athlete") or {}
            players.append(
                {
                    "no": _int(p.get("jersey")),
                    "name": athlete.get("displayName") or athlete.get("fullName"),
                    "pos": (p.get("position") or {}).get("abbreviation"),
                    "captain": bool(p.get("captain")),
                }
            )
        players.sort(key=lambda x: x["no"] if x["no"] is not None else 99)
        if team_id and players:
            result[team_id] = players
    return result


_STAT_KEYS = {"GP": "gp", "W": "w", "D": "d", "L": "l", "PD": "pd", "BP": "bp", "P": "pts"}


def _standings(data: dict) -> list[dict]:
    """Collect tables from the (sometimes nested) standings payload.

    ESPN occasionally repeats the same table under several group names, so
    groups with an identical set of teams are only kept once.
    """
    groups: list[dict] = []
    seen: set[frozenset[str]] = set()

    def walk(node: dict, fallback: str) -> None:
        entries = (node.get("standings") or {}).get("entries")
        name = node.get("name") or fallback
        if entries:
            rows = []
            for entry in entries:
                team = entry.get("team") or {}
                stats = {s.get("abbreviation"): s.get("displayValue") for s in entry.get("stats", [])}
                logos = team.get("logos") or []
                row = {
                    "id": str(team.get("id", "")),
                    "name": team.get("displayName", "?"),
                    "flag": flag_url(team.get("displayName", "")),
                    "logo": logos[0]["href"] if logos else None,
                }
                row.update({key: stats.get(abbr) for abbr, key in _STAT_KEYS.items()})
                rows.append(row)
            rows.sort(key=lambda r: (-_num(r["pts"]), -_num(r["pd"])))
            ids = frozenset(r["id"] for r in rows)
            if ids not in seen:
                seen.add(ids)
                groups.append({"name": name, "rows": rows})
        for child in node.get("children") or []:
            walk(child, name)
        for group in node.get("groups") or []:
            walk(group, name)

    walk(data, data.get("name", ""))
    if len(groups) == 1:
        groups[0]["name"] = ""
    return groups
