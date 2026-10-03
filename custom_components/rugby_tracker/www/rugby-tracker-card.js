/* Rugby Tracker card – served by the rugby_tracker integration. */
const CARD_VERSION = "0.1.0";

const I18N = {
  de: {
    live: "LIVE", next: "Nächstes Spiel", last: "Letztes Ergebnis",
    upcoming: "Spielplan", results: "Ergebnisse", table: "Tabelle", lineup: "Aufstellung",
    all: "Alle", today: "Heute", tomorrow: "Morgen", in: "in", days: "Tagen", day: "Tag", hours: "Std.", min: "Min.",
    noUpcoming: "Keine weiteren Spiele angesetzt", noResults: "Noch keine Ergebnisse",
    noEntity: "Entity nicht gefunden", bench: "Bank", tv: "TV", ht: "Halbzeit", ft: "Endstand",
    W: "S", L: "N", D: "U",
    cols: ["#", "Team", "Sp", "S", "U", "N", "+/-", "BP", "Pkt"],
    events: {
      "try": "Versuch", "penalty try": "Strafversuch", "conversion": "Erhöhung",
      "penalty goal": "Straftritt", "drop goal": "Dropkick", "yellow card": "Gelbe Karte",
      "red card": "Rote Karte",
    },
    leagues: {
      "International Test Match": "Test-Länderspiele",
      "Rugby World Cup": "Rugby-Weltmeisterschaft",
      "International Friendly": "Freundschaftsspiele",
    },
  },
  en: {
    live: "LIVE", next: "Next match", last: "Last result",
    upcoming: "Fixtures", results: "Results", table: "Table", lineup: "Lineups",
    all: "All", today: "Today", tomorrow: "Tomorrow", in: "in", days: "days", day: "day", hours: "h", min: "min",
    noUpcoming: "No further matches scheduled", noResults: "No results yet",
    noEntity: "Entity not found", bench: "Bench", tv: "TV", ht: "Half time", ft: "Full time",
    W: "W", L: "L", D: "D",
    cols: ["#", "Team", "P", "W", "D", "L", "+/-", "BP", "Pts"],
    events: {
      "try": "Try", "penalty try": "Penalty try", "conversion": "Conversion",
      "penalty goal": "Penalty", "drop goal": "Drop goal", "yellow card": "Yellow card",
      "red card": "Red card",
    },
    leagues: {},
  },
};

const HOME_NATIONS = {
  "gb-eng": { de: "England", en: "England" },
  "gb-sct": { de: "Schottland", en: "Scotland" },
  "gb-wls": { de: "Wales", en: "Wales" },
};

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

class RugbyTrackerCard extends HTMLElement {
  static getStubConfig(hass) {
    const entity = Object.keys(hass.states).find(
      (id) => id.startsWith("sensor.") && hass.states[id].attributes.rugby_tracker
    );
    return { entity: entity || "sensor.south_africa_spiele" };
  }

  setConfig(config) {
    if (!config.entity) throw new Error("entity is required");
    this._config = { badges: "logo", upcoming_count: 8, show_timeline: true, ...config };
    this._tab = config.default_tab || "upcoming";
    this._filter = "all";
    this._table = null;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    const state = hass.states[this._config.entity];
    if (state !== this._state) {
      this._state = state;
      this._render();
    }
  }

  connectedCallback() {
    this._timer = setInterval(() => this._render(), 30000);
  }

  disconnectedCallback() {
    clearInterval(this._timer);
  }

  getCardSize() {
    return 9;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  /* ---------------------------------------------------------------- helpers */

  get _lang() {
    const lang = this._config.language || this._hass?.locale?.language || this._hass?.language || "de";
    return lang.startsWith("de") ? "de" : "en";
  }

  get _t() {
    return I18N[this._lang];
  }

  get _tz() {
    return this._hass?.config?.time_zone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  _fmt(date, opts) {
    return new Intl.DateTimeFormat(this._lang === "de" ? "de-DE" : "en-GB", { timeZone: this._tz, ...opts }).format(date);
  }

  _dayKey(date) {
    return this._fmt(date, { year: "numeric", month: "2-digit", day: "2-digit" });
  }

  _teamName(team) {
    const code = (team.flag || "").match(/\/([a-z-]+)\.svg$/)?.[1];
    if (!code || /women|7s|xv|u20|\ba\b/i.test(team.name)) return team.name;
    if (HOME_NATIONS[code]) return HOME_NATIONS[code][this._lang];
    try {
      return new Intl.DisplayNames([this._lang], { type: "region" }).of(code.toUpperCase()) || team.name;
    } catch (e) {
      return team.name;
    }
  }

  _leagueName(m) {
    const name = this._t.leagues[m.league] || m.league;
    return m.season && !String(name).includes(m.season) ? `${name} ${m.season}` : name;
  }

  _badge(team, size = "m") {
    const mode = this._config.badges;
    const flag = team.flag ? `<img class="flag" src="${esc(team.flag)}" alt="">` : "";
    // ESPN serves an empty file for teams without a crest (e.g. Germany): fall back to the flag.
    const onError = team.flag
      ? `this.onerror=null;this.className='flag';this.src='${esc(team.flag)}';this.closest('.badge').classList.replace('is-logo','is-flag')`
      : `this.closest('.badge').classList.add('no-img');this.remove()`;
    const logo = team.logo ? `<img class="logo" src="${esc(team.logo)}" alt="" onerror="${onError}">` : "";
    const abbr = `<span class="abbr">${esc(team.abbr || "")}</span>`;
    let inner;
    let kind;
    if (mode === "flag") {
      inner = flag || logo;
      kind = flag ? "is-flag" : "is-logo";
    } else if (mode === "both" && flag && logo) {
      const crest = `<img class="logo" src="${esc(team.logo)}" alt="" onerror="this.parentNode.remove()">`;
      inner = `${flag}<span class="crest">${crest}</span>`;
      kind = "is-flag";
    } else {
      inner = logo || flag;
      kind = logo ? "is-logo" : "is-flag";
    }
    return `<span class="badge ${size} ${inner ? kind : "no-img"}">${inner}${abbr}</span>`;
  }

  _countdown(date) {
    const t = this._t;
    const diff = date - Date.now();
    if (diff <= 0) return "";
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (d > 1) return `${t.in} ${d} ${t.days}`;
    if (d === 1) return `${t.in} ${d} ${t.day} ${h} ${t.hours}`;
    if (h > 0) return `${t.in} ${h} ${t.hours} ${m} ${t.min}`;
    return `${t.in} ${m} ${t.min}`;
  }

  _when(date) {
    const t = this._t;
    const today = this._dayKey(new Date());
    const tomorrow = this._dayKey(new Date(Date.now() + 86400000));
    const key = this._dayKey(date);
    const time = this._fmt(date, { hour: "2-digit", minute: "2-digit" });
    if (key === today) return `${t.today}, ${time}`;
    if (key === tomorrow) return `${t.tomorrow}, ${time}`;
    return `${this._fmt(date, { weekday: "long", day: "numeric", month: "long" })} · ${time}`;
  }

  _tv(m) {
    const channels = [...(m.tv_de || [])];
    if (!channels.length) return "";
    return `<div class="tv"><ha-icon icon="mdi:television-classic"></ha-icon>${channels.map((c) => `<span class="chip">${esc(c)}</span>`).join("")}</div>`;
  }

  /* ---------------------------------------------------------------- sections */

  _hero(m, kind, attrs) {
    const t = this._t;
    const date = new Date(m.date);
    let status = "";
    if (kind === "live") {
      const label = m.status === "STATUS_HALFTIME" ? t.ht : m.clock || m.status_detail || "";
      status = `<span class="live-pill"><span class="dot"></span>${t.live}${label ? ` · ${esc(label)}` : ""}</span>`;
    } else if (kind === "next") {
      status = `<span class="label">${t.next}</span><span class="countdown">${this._countdown(date)}</span>`;
    } else {
      status = `<span class="label">${t.last}</span>${m.result ? `<span class="pill r-${m.result}">${t[m.result]}</span>` : ""}`;
    }

    const showScore = kind !== "next";
    const centre = showScore
      ? `<div class="score ${kind === "live" ? "is-live" : ""}">${m.home.score ?? 0}<span>:</span>${m.away.score ?? 0}</div>`
      : `<div class="vs">${this._fmt(date, { hour: "2-digit", minute: "2-digit" })}</div>`;

    const timeline = this._config.show_timeline && kind !== "next" ? this._timeline(m, attrs) : "";
    const place = [m.venue, m.city].filter(Boolean).join(", ");

    return `
      <section class="hero ${kind}">
        <div class="hero-top"><span class="comp">${esc(this._leagueName(m))}</span><span class="status">${status}</span></div>
        <div class="hero-main">
          <div class="side">${this._badge(m.home, "xl")}<div class="name">${esc(this._teamName(m.home))}</div></div>
          ${centre}
          <div class="side">${this._badge(m.away, "xl")}<div class="name">${esc(this._teamName(m.away))}</div></div>
        </div>
        <div class="hero-meta">
          <span>${esc(this._when(date))}</span>${place ? `<span>· ${esc(place)}</span>` : ""}
        </div>
        ${kind !== "last" ? this._tv(m) : ""}
        ${timeline}
      </section>`;
  }

  _timeline(m, attrs) {
    const events = (attrs.timelines || {})[m.id] || [];
    if (!events.length) return "";
    const t = this._t;
    const row = (e) => {
      const isHome = e.team_id === m.home.id;
      const label = t.events[(e.type || "").toLowerCase()] || e.type;
      const icon = /card/i.test(e.type) ? `<span class="card-${/red/i.test(e.type) ? "red" : "yellow"}"></span>` : "";
      const text = `${icon}<b>${esc(label)}</b> ${esc(e.player || "")}`;
      return `<div class="ev ${isHome ? "home" : "away"}">
        <span class="h">${isHome ? text : ""}</span>
        <span class="min">${esc(e.minute || "")}</span>
        <span class="a">${isHome ? "" : text}</span></div>`;
    };
    return `<div class="timeline">${events.slice().reverse().map(row).join("")}</div>`;
  }

  _row(m, past) {
    const date = new Date(m.date);
    const day = this._fmt(date, { day: "2-digit" });
    const mon = this._fmt(date, { month: "short" });
    const sub = past ? this._fmt(date, { year: "numeric" }) : this._fmt(date, { weekday: "short", hour: "2-digit", minute: "2-digit" });
    const us = m.is_home ? "home" : "away";
    const team = (side) => `
      <div class="t ${side} ${side === us ? "us" : ""}">
        ${side === "away" ? this._badge(m[side], "s") : ""}
        <span class="tn">${esc(this._teamName(m[side]))}</span>
        <span class="ta">${esc(m[side].abbr)}</span>
        ${side === "home" ? this._badge(m[side], "s") : ""}
      </div>`;
    const mid = past
      ? `<div class="mid score-s">${m.home.score ?? "–"}<span>:</span>${m.away.score ?? "–"}</div>`
      : m.state === "in"
      ? `<div class="mid score-s live">${m.home.score ?? 0}<span>:</span>${m.away.score ?? 0}</div>`
      : `<div class="mid vs-s">vs</div>`;
    const right = past
      ? `<span class="pill r-${m.result || "D"}">${this._t[m.result] || "–"}</span>`
      : (m.tv_de || []).length
      ? `<span class="tv-s" title="${esc((m.tv_de || []).join(", "))}"><ha-icon icon="mdi:television-classic"></ha-icon>${esc(m.tv_de[0])}</span>`
      : "";
    return `
      <div class="row">
        <div class="date"><span class="d">${day}</span><span class="mo">${esc(mon)}</span></div>
        <div class="match">
          <div class="teams">${team("home")}${mid}${team("away")}</div>
          <div class="sub">${esc(sub)}${past ? "" : ` · ${esc(this._leagueName(m))}`}${m.venue ? ` · ${esc(m.venue)}` : ""}</div>
        </div>
        <div class="right">${right}</div>
      </div>`;
  }

  _upcoming(matches, heroId) {
    const list = matches.filter((m) => m.state === "pre" && m.id !== heroId).slice(0, this._config.upcoming_count);
    if (!list.length) return `<div class="empty">${this._t.noUpcoming}</div>`;
    return list.map((m) => this._row(m, false)).join("");
  }

  _results(matches) {
    const past = matches.filter((m) => m.state === "post").reverse();
    if (!past.length) return `<div class="empty">${this._t.noResults}</div>`;
    const groups = new Map();
    for (const m of past) {
      const key = `${m.league_id}|${m.season}`;
      if (!groups.has(key)) groups.set(key, { title: this._leagueName(m), items: [] });
      groups.get(key).items.push(m);
    }
    if (this._filter !== "all" && !groups.has(this._filter)) this._filter = "all";
    const chips = [`<button class="fchip ${this._filter === "all" ? "on" : ""}" data-league="all">${this._t.all}</button>`]
      .concat([...groups].map(([k, g]) => `<button class="fchip ${this._filter === k ? "on" : ""}" data-league="${esc(k)}">${esc(g.title)}</button>`))
      .join("");
    const body = [...groups]
      .filter(([k]) => this._filter === "all" || this._filter === k)
      .map(([, g]) => {
        const w = g.items.filter((m) => m.result === "W").length;
        const d = g.items.filter((m) => m.result === "D").length;
        const l = g.items.filter((m) => m.result === "L").length;
        const t = this._t;
        return `<div class="group"><div class="gh"><span>${esc(g.title)}</span><span class="rec">${w}${t.W} ${d}${t.D} ${l}${t.L}</span></div>${g.items.map((m) => this._row(m, true)).join("")}</div>`;
      })
      .join("");
    return `<div class="filters">${chips}</div>${body}`;
  }

  _standings(attrs) {
    const tables = attrs.standings || {};
    const keys = Object.keys(tables);
    if (!keys.length) return "";
    if (!this._table || !tables[this._table]) {
      // Prefer the competition of the next/live match.
      const focus = (attrs.matches || []).find((m) => m.state !== "post" && tables[m.league_id]);
      this._table = focus ? focus.league_id : keys[0];
    }
    const t = this._t;
    const chips = keys.length > 1
      ? `<div class="filters">${keys.map((k) => `<button class="fchip ${k === this._table ? "on" : ""}" data-table="${esc(k)}">${esc(this._leagueName({ ...tables[k], is_tournament: true }))}</button>`).join("")}</div>`
      : "";
    const teamId = attrs.team?.id;
    const tablesHtml = tables[this._table].groups
      .map((g) => `
        ${g.name ? `<div class="gh"><span>${esc(g.name)}</span></div>` : ""}
        <table class="tbl"><thead><tr>${t.cols.map((c, i) => `<th class="${i === 1 ? "l" : ""} ${[2, 5, 7].includes(i) ? "opt" : ""}">${c}</th>`).join("")}</tr></thead>
        <tbody>${g.rows.map((r, i) => `
          <tr class="${r.id === teamId ? "us" : ""}">
            <td>${i + 1}</td>
            <td class="l"><span class="tcell">${this._badge(r, "xs")}<span class="tn">${esc(this._teamName(r))}</span></span></td>
            <td class="opt">${esc(r.gp ?? "")}</td><td>${esc(r.w ?? "")}</td><td>${esc(r.d ?? "")}</td><td class="opt">${esc(r.l ?? "")}</td>
            <td>${esc(r.pd ?? "")}</td><td class="opt">${esc(r.bp ?? "")}</td><td class="pts">${esc(r.pts ?? "")}</td>
          </tr>`).join("")}</tbody></table>`)
      .join("");
    return chips + tablesHtml;
  }

  _lineups(m, attrs) {
    const lineups = m ? (attrs.lineups || {})[m.id] : null;
    if (!lineups) return "";
    const col = (team) => {
      const players = lineups[team.id] || [];
      const starters = players.filter((p) => p.no && p.no <= 15);
      const bench = players.filter((p) => !p.no || p.no > 15);
      const li = (p) => `<li><span class="no">${p.no ?? ""}</span><span class="pn">${esc(p.name)}${p.captain ? ' <span class="cap">C</span>' : ""}</span><span class="pos">${esc(p.pos || "")}</span></li>`;
      return `<div class="lcol"><div class="lh">${this._badge(team, "s")}<span>${esc(this._teamName(team))}</span></div>
        <ol>${starters.map(li).join("")}</ol>
        ${bench.length ? `<div class="bench">${this._t.bench}</div><ol>${bench.map(li).join("")}</ol>` : ""}</div>`;
    };
    return `<div class="lineups">${col(m.home)}${col(m.away)}</div>`;
  }

  /* ---------------------------------------------------------------- render */

  _render() {
    if (!this.shadowRoot || !this._config) return;
    const state = this._state;
    if (!state) {
      this.shadowRoot.innerHTML = `<ha-card><div class="empty">${this._hass ? `${this._t.noEntity}: ${esc(this._config.entity)}` : ""}</div></ha-card>`;
      return;
    }
    const attrs = state.attributes;
    const matches = attrs.matches || [];
    const team = attrs.team || {};
    const live = matches.filter((m) => m.state === "in");
    const next = matches.find((m) => m.state === "pre");
    const last = [...matches].reverse().find((m) => m.state === "post");

    let heroes = "";
    let heroId = null;
    if (live.length) {
      heroes = live.map((m) => this._hero(m, "live", attrs)).join("");
    } else if (next) {
      heroes = this._hero(next, "next", attrs);
      heroId = next.id;
    } else if (last) {
      heroes = this._hero(last, "last", attrs);
    }
    const lineupMatch = live[0] || next || last;
    const lineupHtml = this._lineups(lineupMatch, attrs);
    const tableHtml = this._standings(attrs);

    const tabs = [["upcoming", this._t.upcoming], ["results", this._t.results]];
    if (tableHtml) tabs.push(["table", this._t.table]);
    if (lineupHtml) tabs.push(["lineup", this._t.lineup]);
    if (!tabs.some(([k]) => k === this._tab)) this._tab = "upcoming";

    const content = {
      upcoming: () => this._upcoming(matches, heroId),
      results: () => this._results(matches),
      table: () => tableHtml,
      lineup: () => lineupHtml,
    }[this._tab]();

    const accent = this._config.accent_color || (team.color ? `#${team.color}` : "#007a4d");
    const title = this._config.title ?? this._teamName(team);
    const scroll = this.shadowRoot.querySelector(".content")?.scrollTop || 0;

    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <ha-card class="${this._hass?.themes?.darkMode ? "dark" : ""}" style="--rt-accent:${esc(accent)}">
        ${title ? `<div class="head">${team.name ? this._badge(team, "s") : ""}<span class="title">${esc(title)}</span></div>` : ""}
        ${heroes}
        <nav class="tabs">${tabs.map(([k, label]) => `<button class="tab ${k === this._tab ? "on" : ""}" data-tab="${k}">${label}</button>`).join("")}</nav>
        <div class="content" style="${this._config.max_height ? `max-height:${esc(this._config.max_height)};overflow-y:auto` : ""}">${content}</div>
      </ha-card>`;

    const contentEl = this.shadowRoot.querySelector(".content");
    if (contentEl) contentEl.scrollTop = scroll;
    this.shadowRoot.querySelectorAll("[data-tab]").forEach((el) =>
      el.addEventListener("click", () => { this._tab = el.dataset.tab; this._render(); }));
    this.shadowRoot.querySelectorAll("[data-league]").forEach((el) =>
      el.addEventListener("click", () => { this._filter = el.dataset.league; this._render(); }));
    this.shadowRoot.querySelectorAll("[data-table]").forEach((el) =>
      el.addEventListener("click", () => { this._table = el.dataset.table; this._render(); }));
  }
}

const STYLE = `
  :host { --rt-gold: #ffb612; --rt-live: #e53935; --rt-win: #2e7d32; --rt-loss: #c62828; --rt-draw: #757575; }
  ha-card { display: block; overflow: hidden; container-type: inline-size; }
  button { font: inherit; color: inherit; cursor: pointer; }
  .head { display: flex; align-items: center; gap: 10px; padding: 14px 16px 6px; }
  .title { font-size: 1.15rem; font-weight: 600; }

  /* badges: flag, team crest, or flag with crest */
  .badge { position: relative; display: inline-flex; align-items: center; justify-content: center; flex: none; font-size: .7rem; font-weight: 700; }
  .badge img { display: block; }
  .badge.is-flag .flag { width: 100%; height: 100%; object-fit: cover; border-radius: 4px; box-shadow: 0 0 0 1px rgba(0,0,0,.12); }
  .badge.is-logo .logo { width: 100%; height: 100%; object-fit: contain; }
  .badge .crest { position: absolute; right: -14px; bottom: -12px; width: 30px; height: 30px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.25); display: flex; align-items: center; justify-content: center; }
  .badge .crest .logo { width: 80%; height: 80%; object-fit: contain; }
  .badge.xs { width: 22px; height: 15px; } .badge.xs .crest { display: none; }
  .badge.s { width: 30px; height: 20px; } .badge.s .crest { display: none; }
  .badge.xl { width: 84px; height: 56px; }
  .badge.is-logo.s, .badge.is-logo.xs { height: 26px; width: 26px; }
  .badge.is-logo.xl { width: 80px; height: 80px; }
  .badge .abbr { display: none; }
  .badge.no-img .abbr { display: inline; }
  /* Most ESPN crests have no dark variant (the All Blacks fern is black): give them a light tile. */
  .dark .badge.is-logo { background: #f2f2f2; border-radius: 7px; padding: 3px; box-sizing: border-box; }
  .dark .badge.is-logo.xl { border-radius: 16px; padding: 9px; }
  .dark .badge.is-logo.xs { padding: 2px; border-radius: 5px; width: 24px; height: 24px; }

  /* hero */
  .hero { margin: 8px 12px 4px; padding: 14px 16px 12px; border-radius: 16px;
    background: linear-gradient(135deg, color-mix(in srgb, var(--rt-accent) 22%, transparent), color-mix(in srgb, var(--rt-gold) 10%, transparent));
    border: 1px solid color-mix(in srgb, var(--rt-accent) 30%, transparent); }
  .hero.live { border-color: color-mix(in srgb, var(--rt-live) 55%, transparent); }
  .hero-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: .85rem; }
  .comp { color: var(--secondary-text-color); font-weight: 500; }
  .status { display: flex; align-items: center; gap: 8px; }
  .label { text-transform: uppercase; letter-spacing: .06em; font-size: .72rem; font-weight: 600; color: var(--secondary-text-color); }
  .countdown { font-weight: 600; color: var(--primary-text-color); }
  .live-pill { display: inline-flex; align-items: center; gap: 6px; background: var(--rt-live); color: #fff; padding: 3px 10px; border-radius: 999px; font-weight: 700; font-size: .78rem; letter-spacing: .04em; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #fff; animation: pulse 1.4s infinite; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .25; } }
  .hero-main { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; margin: 14px 0 8px; }
  .side { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; min-width: 0; }
  .name { font-size: 1.1rem; font-weight: 600; line-height: 1.2; }
  .score { font-size: 3rem; font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
  .score span, .score-s span { opacity: .45; margin: 0 .12em; }
  .score.is-live { color: var(--rt-live); }
  .vs { font-size: 2rem; font-weight: 700; opacity: .85; font-variant-numeric: tabular-nums; }
  .hero-meta { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px; color: var(--secondary-text-color); font-size: .88rem; }
  .tv { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 6px; margin-top: 10px; }
  .tv ha-icon { --mdc-icon-size: 18px; color: var(--secondary-text-color); }
  .chip { padding: 3px 10px; border-radius: 999px; background: var(--card-background-color); border: 1px solid var(--divider-color); font-size: .8rem; font-weight: 500; }

  .timeline { margin-top: 12px; border-top: 1px solid var(--divider-color); padding-top: 8px; max-height: 160px; overflow-y: auto; font-size: .82rem; }
  .ev { display: grid; grid-template-columns: 1fr 44px 1fr; gap: 6px; padding: 2px 0; align-items: center; }
  .ev .h { text-align: right; } .ev .min { text-align: center; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
  .ev b { font-weight: 600; }
  .card-yellow, .card-red { display: inline-block; width: 8px; height: 11px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
  .card-yellow { background: #fbc02d; } .card-red { background: #d32f2f; }

  /* tabs & filters */
  .tabs { display: flex; gap: 4px; padding: 10px 12px 0; border-bottom: 1px solid var(--divider-color); overflow-x: auto; }
  .tab { background: none; border: 0; padding: 10px 14px; border-bottom: 3px solid transparent; color: var(--secondary-text-color); font-weight: 600; white-space: nowrap; }
  .tab.on { color: var(--primary-text-color); border-bottom-color: var(--rt-accent); }
  .content { padding: 6px 12px 14px; }
  .filters { display: flex; gap: 6px; flex-wrap: wrap; padding: 8px 0 4px; }
  .fchip { border: 1px solid var(--divider-color); background: none; padding: 5px 12px; border-radius: 999px; font-size: .82rem; }
  .fchip.on { background: var(--rt-accent); border-color: var(--rt-accent); color: #fff; }
  .empty { padding: 24px 16px; text-align: center; color: var(--secondary-text-color); }

  /* match rows */
  .group { margin-top: 6px; }
  .gh { display: flex; justify-content: space-between; align-items: baseline; padding: 12px 4px 4px; font-size: .78rem; text-transform: uppercase; letter-spacing: .06em; color: var(--secondary-text-color); font-weight: 600; }
  .rec { font-variant-numeric: tabular-nums; letter-spacing: 0; }
  .row { display: grid; grid-template-columns: 48px 1fr auto; gap: 10px; align-items: center; padding: 10px 4px; border-bottom: 1px solid var(--divider-color); }
  .row:last-child { border-bottom: 0; }
  .date { display: flex; flex-direction: column; align-items: center; line-height: 1.05; }
  .date .d { font-size: 1.3rem; font-weight: 700; }
  .date .mo { font-size: .72rem; text-transform: uppercase; color: var(--secondary-text-color); }
  .match { min-width: 0; }
  .teams { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 10px; }
  .t { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .t.home { justify-content: flex-end; text-align: right; }
  .t.us .tn, .t.us .ta { font-weight: 700; }
  .tn { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ta { display: none; }
  .mid { min-width: 56px; text-align: center; }
  .score-s { font-weight: 800; font-size: 1.1rem; font-variant-numeric: tabular-nums; }
  .score-s.live { color: var(--rt-live); }
  .vs-s { color: var(--secondary-text-color); font-size: .8rem; }
  .sub { margin-top: 4px; text-align: center; font-size: .78rem; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .right { display: flex; justify-content: flex-end; min-width: 28px; }
  .pill { display: inline-flex; align-items: center; justify-content: center; min-width: 24px; height: 24px; padding: 0 6px; border-radius: 6px; color: #fff; font-weight: 700; font-size: .8rem; }
  .r-W { background: var(--rt-win); } .r-L { background: var(--rt-loss); } .r-D { background: var(--rt-draw); }
  .tv-s { display: inline-flex; align-items: center; gap: 4px; font-size: .78rem; color: var(--secondary-text-color); white-space: nowrap; }
  .tv-s ha-icon { --mdc-icon-size: 16px; }

  /* table */
  .tbl { width: 100%; border-collapse: collapse; font-size: .9rem; font-variant-numeric: tabular-nums; }
  .tbl th { font-size: .72rem; color: var(--secondary-text-color); font-weight: 600; padding: 8px 4px; text-align: center; }
  .tbl td { padding: 7px 4px; text-align: center; border-top: 1px solid var(--divider-color); }
  .tbl .l { text-align: left; }
  .tbl tr.us td { background: color-mix(in srgb, var(--rt-accent) 14%, transparent); font-weight: 700; }
  .tbl .pts { font-weight: 700; }
  .tcell { display: flex; align-items: center; gap: 8px; }

  /* lineups */
  .lineups { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding-top: 8px; }
  .lh { display: flex; align-items: center; gap: 8px; font-weight: 700; padding-bottom: 6px; border-bottom: 2px solid var(--rt-accent); }
  .lineups ol { list-style: none; margin: 0; padding: 0; }
  .lineups li { display: grid; grid-template-columns: 26px 1fr auto; gap: 6px; padding: 4px 0; font-size: .86rem; border-bottom: 1px solid var(--divider-color); }
  .no { font-weight: 700; color: var(--secondary-text-color); text-align: right; font-variant-numeric: tabular-nums; }
  .pos { font-size: .72rem; color: var(--secondary-text-color); }
  .cap { font-size: .65rem; background: var(--rt-gold); color: #000; border-radius: 3px; padding: 0 3px; font-weight: 700; }
  .bench { margin-top: 10px; font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; color: var(--secondary-text-color); font-weight: 600; }

  /* narrow cards (phones, small grid cells) */
  @container (max-width: 460px) {
    .tn { display: none; } .ta { display: inline; }
    .t.us .ta { font-weight: 700; }
    .score { font-size: 2.3rem; }
    .badge.xl { width: 64px; height: 43px; }
    .name { font-size: .95rem; }
    .tbl .opt { display: none; }
    .tbl .tn { display: inline; }
    .lineups { grid-template-columns: 1fr; }
    .row { grid-template-columns: 34px 1fr auto; gap: 6px; }
    .tv-s { display: none; }
    .teams { gap: 6px; }
  }
`;

customElements.get("rugby-tracker-card") || customElements.define("rugby-tracker-card", RugbyTrackerCard);
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "rugby-tracker-card")) {
  window.customCards.push({
    type: "rugby-tracker-card",
    name: "Rugby Tracker",
    description: "Live-Spiele, Spielplan, Ergebnisse, Tabelle und Aufstellungen eines Rugby-Teams.",
    preview: true,
  });
}
console.info(`%c RUGBY-TRACKER-CARD %c ${CARD_VERSION} `, "background:#007a4d;color:#ffb612;font-weight:700", "");
