"""Map rugby team names to country flags (served by flagcdn.com)."""

from __future__ import annotations

import re

_CODES = {
    "argentina": "ar",
    "australia": "au",
    "belgium": "be",
    "brazil": "br",
    "canada": "ca",
    "chile": "cl",
    "england": "gb-eng",
    "fiji": "fj",
    "france": "fr",
    "georgia": "ge",
    "germany": "de",
    "hong kong": "hk",
    "hong kong china": "hk",
    "ireland": "ie",
    "italy": "it",
    "japan": "jp",
    "kenya": "ke",
    "namibia": "na",
    "netherlands": "nl",
    "new zealand": "nz",
    "poland": "pl",
    "portugal": "pt",
    "romania": "ro",
    "russia": "ru",
    "samoa": "ws",
    "scotland": "gb-sct",
    "south africa": "za",
    "spain": "es",
    "sweden": "se",
    "switzerland": "ch",
    "tonga": "to",
    "united states": "us",
    "usa": "us",
    "uruguay": "uy",
    "wales": "gb-wls",
    "zimbabwe": "zw",
}

# Squad suffixes that still play under the national flag.
_SUFFIX = re.compile(r"\s+(women|women 7s|7s|sevens|xv|a|u20|under 20s?)$", re.IGNORECASE)


def flag_url(team_name: str) -> str | None:
    """Return a flag image URL for a national team, or None for clubs."""
    name = _SUFFIX.sub("", team_name.strip()).lower()
    code = _CODES.get(name)
    return f"https://flagcdn.com/{code}.svg" if code else None


# World Rugby style codes where ESPN's own abbreviation is unusual.
_ABBR = {
    "south africa": "RSA",
    "new zealand": "NZL",
    "romania": "ROU",
    "england": "ENG",
    "ireland": "IRL",
    "scotland": "SCO",
    "wales": "WAL",
    "australia": "AUS",
    "argentina": "ARG",
    "united states": "USA",
    "portugal": "POR",
    "samoa": "SAM",
    "tonga": "TGA",
    "georgia": "GEO",
}


def abbreviation(team_name: str, espn_abbr: str | None) -> str:
    return _ABBR.get(team_name.strip().lower()) or espn_abbr or team_name[:3].upper()
