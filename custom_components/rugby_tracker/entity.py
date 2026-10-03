"""Base entity for Rugby Tracker."""

from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import RugbyCoordinator


class RugbyEntity(CoordinatorEntity[RugbyCoordinator]):
    """Common device and naming for all entities of one tracked team."""

    _attr_has_entity_name = True
    _attr_attribution = "Data provided by ESPN"

    def __init__(self, coordinator: RugbyCoordinator, key: str) -> None:
        super().__init__(coordinator)
        self._attr_translation_key = key
        self._attr_unique_id = f"{coordinator.team_id}_{key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, coordinator.team_id)},
            name=coordinator.team_name,
            manufacturer="ESPN",
            model="Rugby team",
            entry_type=DeviceEntryType.SERVICE,
            configuration_url=f"https://www.espn.co.uk/rugby/team/_/id/{coordinator.team_id}",
        )


def match_summary(match: dict | None) -> dict:
    """Small, flat attribute set for automations and simple cards."""
    if not match:
        return {}
    home, away = match["home"], match["away"]
    us, them = (home, away) if match["is_home"] else (away, home)
    return {
        "match_id": match["id"],
        "competition": match["league"],
        "kickoff": match["date"],
        "home": home["name"],
        "away": away["name"],
        "home_score": home["score"],
        "away_score": away["score"],
        "opponent": them["name"],
        "opponent_flag": them["flag"],
        "opponent_logo": them["logo"],
        "team_score": us["score"],
        "opponent_score": them["score"],
        "venue": match["venue"],
        "city": match["city"],
        "status": match["status_detail"],
        "clock": match["clock"],
        "tv": match["tv_de"],
        "result": match["result"],
        "url": match["url"],
    }
