# Rugby Tracker for Home Assistant

Follow one rugby team (default: the **Springboks** 🇿🇦) across **every competition**:
test matches, Rugby Championship, Nations Championship, World Cup and so on.
No per-tournament setup: ESPN's team feed is used, so new competitions show up automatically.

Includes a dashboard card made for wall tablets:

- **Live** hero with score, match minute, scoring timeline (tries, kicks, cards) – refreshes every 20 s
- **Next match** with countdown, venue and German TV channels (ProSieben MAXX / ran.de / Joyn by default)
- **Fixtures**, **results grouped by tournament** (filter chips), **standings** and **lineups**
- Team crests (Springbok, fern, Wallaby …) with country-flag fallback, English (German optional), follows your HA light/dark theme
- Works for any team ESPN covers (national sides, clubs like the Bulls or Stormers); add one entry per team

## Installation (HACS)

1. HACS → ⋮ → *Custom repositories* → add `https://github.com/chrfetzer/ha-rugby-tracker`, type *Integration*.
2. Install **Rugby Tracker**, restart Home Assistant.
3. *Settings → Devices & services → Add integration → Rugby Tracker*, search `South Africa`, pick the team.

The integration adds the card to your dashboard resources itself (`/rugby_tracker/rugby-tracker-card.js`)
and bumps its version after each update, so tablets pick up new card versions.
If you still see *Custom element doesn't exist*, reload the page once or, in the Companion app,
use *Settings → Companion app → Troubleshooting → Reset frontend cache*.

## Card

```yaml
type: custom:rugby-tracker-card
entity: sensor.south_africa_matches   # the "Matches" sensor
```

| Option | Default | Description |
| --- | --- | --- |
| `entity` | – | The *Matches* sensor of the team |
| `title` | team name | Header text; `""` hides the header |
| `badges` | `logo` | `logo` (union crest, e.g. Springbok, All Blacks fern; flag if ESPN has none), `flag`, or `both` (flag with small crest) |
| `default_tab` | `upcoming` | `upcoming`, `results`, `table`, `lineup` |
| `upcoming_count` | `8` | Number of fixtures in the list |
| `show_timeline` | `true` | Scoring timeline in the live/last-match panel |
| `language` | `en` | `en` or `de` |
| `accent_color` | team colour | Any CSS colour, e.g. `"#007a4d"` |
| `max_height` | – | e.g. `600px` to make the tab content scroll |

## Entities

| Entity | State | Notes |
| --- | --- | --- |
| `sensor.<team>_matches` | upcoming match count | All data for the card (not written to the recorder) |
| `sensor.<team>_next_match` | kickoff (timestamp) | Opponent, competition, venue, `tv`, flags |
| `sensor.<team>_last_result` | e.g. `43:28` | `result` = `W`/`L`/`D` |
| `binary_sensor.<team>_live` | on during a match | Live score and clock as attributes |

## Notifications

The integration fires `rugby_tracker_event` with `type`:
`kickoff_soon`, `kickoff`, `score`, `halftime`, `full_time`.
Data includes `team`, `opponent`, `team_score`, `opponent_score`, `competition`, `tv`, `clock`;
`score` events add `scoring_team`, `points`, `score_type` (e.g. `try`) and `player`;
`full_time` adds `result`.

```yaml
automation:
  - alias: Springboks – kickoff soon
    triggers:
      - trigger: event
        event_type: rugby_tracker_event
        event_data: { type: kickoff_soon }
    actions:
      - action: notify.mobile_app_phone
        data:
          title: "🏉 {{ trigger.event.data.team }} vs {{ trigger.event.data.opponent }}"
          message: >-
            Kickoff in {{ trigger.event.data.minutes }} min –
            {{ trigger.event.data.competition }} on {{ trigger.event.data.tv | join(', ') }}

  - alias: Springboks – score
    triggers:
      - trigger: event
        event_type: rugby_tracker_event
        event_data: { type: score }
    actions:
      - action: notify.mobile_app_phone
        data:
          title: >-
            {{ '🟢' if trigger.event.data.scoring_team_id == trigger.event.data.team_id else '⚪' }}
            {{ trigger.event.data.team_score }}:{{ trigger.event.data.opponent_score }}
            ({{ trigger.event.data.clock }})
          message: >-
            {{ trigger.event.data.score_type | default('Points', true) | title }}
            {{ trigger.event.data.player | default('', true) }} – {{ trigger.event.data.scoring_team }}
```

## Options

*Settings → Devices & services → Rugby Tracker → Configure*

- **Broadcasters (Germany)** – one rule per line, `part of competition name = channels`, `*` is the fallback:
  ```
  * = ProSieben MAXX, ran.de, Joyn
  World Cup = ProSieben MAXX, Joyn
  ```
- **Kickoff reminder** – minutes before kickoff for `kickoff_soon`.
- **Seasons of results** – how many seasons back to show.

## Polling

20 s while a match is live (from 20 min before kickoff), 5 min in the 3 h before, otherwise every 30 min.
Finished matches are cached on disk and never fetched again.

## Development

`dev/preview.html` renders the card with real sample data, no Home Assistant needed:

```bash
python -m http.server 8765
```

Open `http://localhost:8765/dev/preview.html` – add `?live=1`, `?dark=1`, `?tab=results|table|lineup`.

Data: ESPN's public (unofficial) API. Flags: flagcdn.com.
