"""Sensors for Rugby Tracker."""

from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.util import dt as dt_util

from .const import VERSION
from .coordinator import RugbyConfigEntry
from .entity import RugbyEntity, match_summary


async def async_setup_entry(
    hass: HomeAssistant,
    entry: RugbyConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    coordinator = entry.runtime_data
    async_add_entities(
        [
            MatchesSensor(coordinator, "matches"),
            NextMatchSensor(coordinator, "next_match"),
            LastResultSensor(coordinator, "last_result"),
        ]
    )


class MatchesSensor(RugbyEntity, SensorEntity):
    """Holds the whole season for the dashboard card. State: number of upcoming matches."""

    _attr_icon = "mdi:rugby"
    # Large and changing constantly during matches: keep it out of the database.
    _unrecorded_attributes = frozenset(
        {"team", "matches", "live", "timelines", "lineups", "standings", "updated"}
    )

    @property
    def native_value(self) -> int:
        return sum(1 for m in self.coordinator.data["matches"] if m["state"] == "pre")

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        data = self.coordinator.data
        return {
            "rugby_tracker": VERSION,
            "team": data["team"],
            "matches": data["matches"],
            "live": [m["id"] for m in data["live"]],
            "timelines": data["timelines"],
            "lineups": data["lineups"],
            "standings": data["standings"],
            "updated": data["updated"],
        }


class NextMatchSensor(RugbyEntity, SensorEntity):
    """Kickoff time of the next (or currently live) match."""

    _attr_device_class = SensorDeviceClass.TIMESTAMP
    _attr_icon = "mdi:calendar-clock"

    def _match(self) -> dict | None:
        data = self.coordinator.data
        return data["live"][0] if data["live"] else data["next"]

    @property
    def native_value(self):
        match = self._match()
        return dt_util.parse_datetime(match["date"]) if match and match["date"] else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        match = self._match()
        return {"live": bool(match and match["state"] == "in"), **match_summary(match)}


class LastResultSensor(RugbyEntity, SensorEntity):
    """Score line of the last finished match, e.g. "43:28"."""

    _attr_icon = "mdi:scoreboard"

    @property
    def native_value(self) -> str | None:
        match = self.coordinator.data["last"]
        if not match:
            return None
        s = match_summary(match)
        return f"{s['team_score']}:{s['opponent_score']}"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return match_summary(self.coordinator.data["last"])
