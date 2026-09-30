#!/usr/bin/env bash
# nixfredOS status line — neon cockpit.
#
# Adaptive: 1 line in narrow panes (<70 cols), 5-line cockpit by default, and a
# richer version of the same 5 lines when the terminal is tall (>= 40 rows).
# One group per line: session · code · memory · plan · environment
#   nixfredOS │ ATLAS:laptop │ Opus 5.5·high │ ctx ■■■□□□□□□□ 30% 300k/1M │ ⏱ 1h
#   ⎇ main *3 │ ~/Projects/app │ ⛨ hooks 38/38
#   ◎ 812 sessions · 1,204 decisions · 377 learnings │ ⌕ recalled 2m ago │ ✿ 8.4↑
#   ⏳ week 35% · +8% banked ≈14h ahead ↻Sun │ 5h 6%
#   BOS 07:21 ☀ 58° │ ▣ ollama 6.1/12G │ 🔇
#
# Plan pace uses subscription rate limits, never dollars: banked = share of the
# week elapsed minus share used (shown only when ahead); when behind it counts
# down to the moment you're even again.
#
# Portable: macOS bash 3.2 + Linux. Needs jq. Optional: sqlite3, nvidia-smi,
# curl, kitten. Every expensive probe is cached in $STATE_DIR with a TTL, so a
# render never waits on the network or the GPU.
#
# Env knobs:
#   NIXFREDOS_SL_WEATHER=off   hide location/time/weather (no network calls)
#   NIXFREDOS_SL_MODE=one|compact|full   force a layout
#   NIXFREDOS_MEMORY_DB=path   memory database (default ~/.claude/memory.db)

CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SETTINGS_FILE="$CLAUDE_DIR/settings.json"
STATE_DIR="$CLAUDE_DIR/MEMORY/State"
MEMORY_DB="${NIXFREDOS_MEMORY_DB:-$CLAUDE_DIR/memory.db}"
RATINGS_FILE="$CLAUDE_DIR/MEMORY/LEARNING/SIGNALS/ratings.jsonl"
RECALL_LOG="$STATE_DIR/recall-xray.jsonl"
ALGO_DIR="$STATE_DIR/algorithms"
VOICE_FILE="$CLAUDE_DIR/voice.json"
mkdir -p "$STATE_DIR" 2>/dev/null

# ── neon palette (truecolor) ────────────────────────────────────────────────
E=$'\033'
R="${E}[0m"; B="${E}[1m"
CY="${E}[38;2;0;240;255m"; VI="${E}[38;2;122;92;255m"; MG="${E}[38;2;255;43;214m"
TX="${E}[38;2;230;236;255m"; MU="${E}[38;2;176;192;238m"; DIM="${E}[38;2;150;164;210m"; LN="${E}[38;2;95;108;160m"
OK="${E}[38;2;61;255;168m"; WR="${E}[38;2;255;204;77m"; BAD="${E}[38;2;255;85;110m"
SEP="${LN} │ ${R}"

mtime() { if [[ "$OSTYPE" == darwin* ]]; then stat -f %m "$1" 2>/dev/null || echo 0; else stat -c %Y "$1" 2>/dev/null || echo 0; fi; }
age() { [ -f "$1" ] && echo $(( $(date +%s) - $(mtime "$1") )) || echo 999999; }
date_at() { date -r "$1" +"$2" 2>/dev/null || date -d "@$1" +"$2" 2>/dev/null; }
commas() { printf '%s' "$1" | awk '{ s=$0; o=""; while (length(s) > 3) { o="," substr(s, length(s)-2) o; s=substr(s, 1, length(s)-3) } print s o }'; }
ktok() {  # 300235 -> 300k, 1000000 -> 1M
    local n=${1:-0}
    if [ "$n" -ge 1000000 ]; then awk -v n="$n" 'BEGIN{ v=n/1000000; printf (v==int(v)) ? "%dM" : "%.1fM", v }'
    elif [ "$n" -ge 1000 ]; then echo "$((n / 1000))k"; else echo "$n"; fi
}
ago() {  # seconds -> 2m / 3h / 4d
    local s=$1
    if [ "$s" -lt 60 ]; then echo "${s}s"; elif [ "$s" -lt 3600 ]; then echo "$((s / 60))m"
    elif [ "$s" -lt 86400 ]; then echo "$((s / 3600))h"; else echo "$((s / 86400))d"; fi
}
reset_label() {
    [ "${1:-0}" -gt 0 ] 2>/dev/null || return
    if [ "$(date_at "$1" %Y%m%d)" = "$(date +%Y%m%d)" ]; then date_at "$1" %H:%M; else date_at "$1" %a; fi
}
pct_color() {  # green < 60 <= amber < 85 <= red
    if [ "${1:-0}" -ge 85 ]; then printf '%s' "$BAD"; elif [ "${1:-0}" -ge 60 ]; then printf '%s' "$WR"; else printf '%s' "$OK"; fi
}

# ── stdin (one jq pass) ─────────────────────────────────────────────────────
input=$(cat)
eval "$(printf '%s' "$input" | jq -r '
  @sh "session_id=\(.session_id // "")",
  @sh "model=\(.model.display_name // "")",
  @sh "effort=\(.effort.level // "")",
  @sh "cwd=\(.workspace.current_dir // .cwd // "")",
  @sh "cost=\(.cost.total_cost_usd // 0)",
  @sh "dur_ms=\(.cost.total_duration_ms // 0)",
  @sh "ctx_pct=\(.context_window.used_percentage // "")",
  @sh "ctx_max=\(.context_window.context_window_size // 200000)",
  @sh "ctx_used=\((.context_window.current_usage // {}) | ((.input_tokens // 0) + (.cache_read_input_tokens // 0) + (.cache_creation_input_tokens // 0)))",
  @sh "rl5=\(.rate_limits.five_hour.used_percentage // "")",
  @sh "rl5_reset=\(.rate_limits.five_hour.resets_at // 0)",
  @sh "rl7=\(.rate_limits.seven_day.used_percentage // "")",
  @sh "rl7_reset=\(.rate_limits.seven_day.resets_at // 0)",
  @sh "cache_hit=\(.prompt_cache.hit_ratio // "")",
  @sh "lines_add=\(.cost.total_lines_added // 0)",
  @sh "lines_del=\(.cost.total_lines_removed // 0)"
' 2>/dev/null)"
[ -z "$ctx_pct" ] && [ "${ctx_max:-0}" -gt 0 ] && ctx_pct=$(( ctx_used * 100 / ctx_max ))
ctx_pct=${ctx_pct%.*}; ctx_pct=${ctx_pct:-0}

# ── size → layout ───────────────────────────────────────────────────────────
cols=""; rows=""
if [ -n "$KITTY_WINDOW_ID" ] && command -v kitten >/dev/null 2>&1; then
    read -r cols rows <<<"$(kitten @ ls 2>/dev/null | jq -r --argjson w "$KITTY_WINDOW_ID" \
        '.[].tabs[].windows[] | select(.id == $w) | "\(.columns) \(.lines)"' 2>/dev/null | head -1)"
fi
if [ -z "$cols" ] || [ "$cols" = "null" ]; then read -r rows cols <<<"$( { stty size </dev/tty; } 2>/dev/null )"; fi
cols=${cols:-${COLUMNS:-100}}; rows=${rows:-${LINES:-30}}
[ "$cols" = "null" ] && cols=100; [ "$rows" = "null" ] && rows=30
if [ -n "$NIXFREDOS_SL_MODE" ]; then MODE="$NIXFREDOS_SL_MODE"
elif [ "$cols" -lt 70 ]; then MODE="one"
elif [ "$rows" -ge 40 ] && [ "$cols" -ge 100 ]; then MODE="full"
else MODE="compact"; fi

# ── identity ────────────────────────────────────────────────────────────────
ai_name=$(jq -r '.daidentity.displayName // .daidentity.name // "AI"' "$SETTINGS_FILE" 2>/dev/null)
host=$(hostname -s 2>/dev/null || hostname)
wordmark="${B}${CY}nix${VI}fred${MG}OS${R}"
ident="${TX}${B}$(printf '%s' "$ai_name" | tr '[:lower:]' '[:upper:]')${R}${DIM}:${R}${MU}${host}${R}"

# ── context bar ─────────────────────────────────────────────────────────────
bar_w=10; [ "$MODE" = "full" ] && bar_w=16
filled=$(( ctx_pct * bar_w / 100 )); [ "$filled" -gt "$bar_w" ] && filled=$bar_w
cc=$(pct_color "$ctx_pct"); bar=""
i=0; while [ $i -lt $bar_w ]; do
    if [ $i -lt $filled ]; then bar="${bar}${cc}■"; else bar="${bar}${LN}□"; fi; i=$((i + 1)); done
ctx_seg="${MU}ctx${R} ${bar}${R} ${cc}${B}${ctx_pct}%${R} ${DIM}$(ktok "$ctx_used")/$(ktok "$ctx_max")${R}"

# ── cost + burn rate ────────────────────────────────────────────────────────
cost_seg=$(awk -v c="$cost" -v ms="$dur_ms" 'BEGIN{
    h = ms / 3600000; printf "$%.2f", c; if (h > 0.05) printf " \033[38;2;150;164;210m$%.1f/h", c / h }')
cost_seg="${TX}${cost_seg}${R}"
mins=$(( dur_ms / 60000 )); sess_seg="${MU}⏱${R} ${TX}$(ago $(( dur_ms / 1000 )))${R}"

model_seg="${TX}${model}${R}"; [ -n "$effort" ] && model_seg="${model_seg}${DIM}·${R}${MU}${effort}${R}"

# ── git ─────────────────────────────────────────────────────────────────────
git_seg=""
if [ -n "$cwd" ] && git -C "$cwd" rev-parse --git-dir >/dev/null 2>&1; then
    branch=$(git -C "$cwd" branch --show-current 2>/dev/null); branch=${branch:-detached}
    dirty=$(git -C "$cwd" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    ahead=$(git -C "$cwd" rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)
    git_seg="${VI}⎇${R} ${TX}${branch}${R}"
    [ "$dirty" -gt 0 ] && git_seg="${git_seg} ${WR}*${dirty}${R}"
    [ "${ahead:-0}" -gt 0 ] && git_seg="${git_seg} ${CY}↑${ahead}${R}"
fi
tilde='~'; short_cwd="${cwd/#$HOME/$tilde}"
cwd_seg="${MU}${short_cwd}${R}"

# ── hooks health (cached 300s): declared hook commands whose file exists ────
HOOKS_CACHE="$STATE_DIR/sl-hooks.cache"
if [ "$(age "$HOOKS_CACHE")" -gt 300 ] && [ -f "$SETTINGS_FILE" ]; then
    total=0; okc=0
    while IFS= read -r cmd; do
        [ -z "$cmd" ] && continue
        total=$((total + 1))
        f=$(printf '%s' "$cmd" | tr ' ' '\n' | grep -E '\.(ts|sh|py|js)$' | head -1)
        f="${f/#\~/$HOME}"; f="${f//\$HOME/$HOME}"; f="${f//\$\{HOME\}/$HOME}"
        if [ -z "$f" ] || [ -f "$f" ]; then okc=$((okc + 1)); fi
    done <<<"$(jq -r '[.hooks[]?[]?.hooks[]?.command] | unique | .[]' "$SETTINGS_FILE" 2>/dev/null)"
    echo "$okc $total" > "$HOOKS_CACHE"
fi
read -r hooks_ok hooks_total < "$HOOKS_CACHE" 2>/dev/null
hooks_seg=""
if [ "${hooks_total:-0}" -gt 0 ]; then
    if [ "$hooks_ok" -eq "$hooks_total" ]; then hooks_seg="${OK}⛨${R} ${MU}hooks${R} ${OK}${hooks_ok}/${hooks_total}${R}"
    else hooks_seg="${BAD}⛨ hooks ${hooks_ok}/${hooks_total} MISSING${R}"; fi
fi

# ── algorithm phase (live runs only) ────────────────────────────────────────
algo_seg=""
AF="$ALGO_DIR/${session_id}.json"
if [ -n "$session_id" ] && [ -f "$AF" ] && [ "$(age "$AF")" -lt 14400 ]; then
    eval "$(jq -r '@sh "a_on=\(.active // false)", @sh "a_ph=\(.currentPhase // "")"' "$AF" 2>/dev/null)"
    if [ "$a_on" = "true" ] && [ -n "$a_ph" ]; then
        algo_seg="${WR}⚡${R}"
        for ph in OBSERVE THINK PLAN BUILD EXECUTE VERIFY LEARN; do
            if [ "$ph" = "$a_ph" ]; then algo_seg="${algo_seg} ${B}${CY}${ph}${R}"; else algo_seg="${algo_seg} ${DIM}${ph:0:1}${R}"; fi
        done
    fi
fi

# ── memory (cached 60s) ─────────────────────────────────────────────────────
MEM_CACHE="$STATE_DIR/sl-memory.cache"
if [ "$(age "$MEM_CACHE")" -gt 60 ] && [ -f "$MEMORY_DB" ] && command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 -separator ' ' "$MEMORY_DB" "select
        (select count(*) from loa_entries), (select count(*) from decisions), (select count(*) from learnings)" \
        2>/dev/null > "$MEM_CACHE.tmp" && mv "$MEM_CACHE.tmp" "$MEM_CACHE"
fi
read -r m_sess m_dec m_learn < "$MEM_CACHE" 2>/dev/null
mem_seg=""
if [ -n "$m_sess" ]; then
    mem_seg="${MG}◎${R} ${TX}$(commas "$m_sess")${R} ${MU}sessions${R} ${DIM}·${R} ${TX}$(commas "$m_dec")${R} ${MU}decisions${R} ${DIM}·${R} ${TX}$(commas "$m_learn")${R} ${MU}learnings${R}"
fi

# last recall: newest entry in the recall log that injected something
recall_seg=""
if [ -s "$RECALL_LOG" ]; then
    last=$(tail -40 "$RECALL_LOG" 2>/dev/null | jq -rc 'select((.injectedChars // 0) > 0) | .ts' 2>/dev/null | tail -1)
    if [ -n "$last" ]; then
        le=$(date -d "$last" +%s 2>/dev/null || date -jf "%Y-%m-%dT%H:%M:%S" "${last%%.*}" +%s 2>/dev/null)
        # BSD date parses the UTC stamp as local time; correct by the UTC offset
        if ! date -d "$last" +%s >/dev/null 2>&1 && [ -n "$le" ]; then
            off=$(date +%z); sign=${off:0:1}; oh=${off:1:2}; om=${off:3:2}
            corr=$(( (10#$oh * 3600 + 10#$om * 60) )); [ "$sign" = "-" ] && le=$((le - corr)) || le=$((le + corr))
        fi
        [ -n "$le" ] && recall_seg="${CY}⌕${R} ${MU}recalled${R} ${TX}$(ago $(( $(date +%s) - le )))${R} ${MU}ago${R}"
    fi
fi
[ -z "$recall_seg" ] && [ -f "$RECALL_LOG" ] && recall_seg="${DIM}⌕ no recall yet${R}"

rating_seg=""
if [ -s "$RATINGS_FILE" ]; then
    read -r r trend <<<"$(tail -20 "$RATINGS_FILE" 2>/dev/null | jq -rs '[.[].rating | numbers] as $a
        | if ($a | length) == 0 then empty else
          (($a | add / length * 10 | round) / 10) as $avg
          | (if ($a | length) >= 12 then
               (($a[-10:] | add / length) - ($a[:-10] | add / length)) as $d
               | (if $d > 0.3 then "up" elif $d < -0.3 then "down" else "flat" end)
             else "flat" end) as $t
          | "\($avg) \($t)" end' 2>/dev/null)"
    case "$trend" in up) ta="${OK}↑${R}" ;; down) ta="${BAD}↓${R}" ;; *) ta="" ;; esac
    [ -n "$r" ] && rating_seg="${MG}✿${R} ${TX}${r}${R}${ta}"
fi

# ── plan pace (subscription, no dollars) — same math as Burn Bar ──────────
# Weekly window, even pace: e = elapsed fraction, p = used fraction.
#   banked  = e - p  (shown only when ahead), as plan share and as clock time
#   behind  -> come back at reset - span*(1-p): the moment elapsed catches used
# The 5h window is shown small; only its cap warning matters.
plan_seg=""
if [ -n "$rl7" ] && [ "${rl7_reset:-0}" -gt 0 ]; then
    read -r u7 bank7 bank_s back_s <<<"$(awk -v u="${rl7%.*}" -v r="$rl7_reset" -v w=604800 -v now="$(date +%s)" 'BEGIN{
        el = w - (r - now); if (el < 0) el = 0; if (el > w) el = w
        e = el / w; p = u / 100; bank = e - p
        back = (r - w * (1 - p)) - now
        printf "%d %d %d %d", u, bank * 100, bank * w, back }')"
    plan_seg="${MU}⏳ week${R} $(pct_color "$u7")${B}${u7}%${R}"
    if [ "$bank7" -ge 1 ]; then
        plan_seg="${plan_seg} ${DIM}·${R} ${OK}+${bank7}% banked${R} ${DIM}≈$(ago "$bank_s") ahead${R}"
    elif [ "$bank7" -le -1 ]; then
        plan_seg="${plan_seg} ${DIM}·${R} ${BAD}behind${R} ${DIM}· even in${R} ${WR}$(ago "$back_s")${R}"
    else
        plan_seg="${plan_seg} ${DIM}·${R} ${OK}on pace${R}"
    fi
    plan_seg="${plan_seg} ${DIM}↻$(reset_label "$rl7_reset")${R}"
fi
if [ -n "$rl5" ]; then
    u5=${rl5%.*}
    s5="${MU}5h${R} $(pct_color "$u5")${u5}%${R}"
    [ "$u5" -ge 80 ] && s5="${s5} ${DIM}↻$(reset_label "$rl5_reset")${R}"
    plan_seg="${plan_seg:+$plan_seg${SEP}}${s5}"
fi

# ── local GPU / Ollama (cached 20s, only if installed) ──────────────────────
GPU_CACHE="$STATE_DIR/sl-gpu.cache"
if [ "$(age "$GPU_CACHE")" -gt 20 ]; then
    g=""
    if command -v ollama >/dev/null 2>&1 || command -v nvidia-smi >/dev/null 2>&1; then
        om=$(curl -s --max-time 0.4 http://127.0.0.1:11434/api/ps 2>/dev/null | jq -r '.models[0].name // empty' 2>/dev/null)
        up="down"; curl -s --max-time 0.4 -o /dev/null http://127.0.0.1:11434/api/version 2>/dev/null && up="up"
        vram=""
        if command -v nvidia-smi >/dev/null 2>&1; then
            vram=$(nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits 2>/dev/null | head -1 |
                awk -F', *' '{ printf "%.1f/%.0fG", $1/1024, $2/1024 }')
        fi
        g="$up|${om%%:*}|$vram"
    fi
    echo "$g" > "$GPU_CACHE"
fi
IFS='|' read -r g_up g_model g_vram < "$GPU_CACHE" 2>/dev/null
gpu_seg=""
if [ -n "$g_up" ]; then
    if [ "$g_up" = "up" ]; then gpu_seg="${OK}▣${R} ${MU}ollama${R}"; else gpu_seg="${DIM}▣ ollama off${R}"; fi
    [ -n "$g_model" ] && gpu_seg="${gpu_seg} ${TX}${g_model}${R}"
    [ -n "$g_vram" ] && gpu_seg="${gpu_seg} ${DIM}${g_vram}${R}"
fi

# ── location / time / weather (cached; IP geolocation once a day) ───────────
wx_seg=""
if [ "$NIXFREDOS_SL_WEATHER" != "off" ]; then
    LOC="$STATE_DIR/location-cache.json"; WX="$STATE_DIR/sl-weather.cache"
    if [ "$(age "$LOC")" -gt 86400 ]; then
        lj=$(curl -s --max-time 2 "http://ip-api.com/json/?fields=city,regionName,country,lat,lon" 2>/dev/null)
        printf '%s' "$lj" | jq -e '.lat' >/dev/null 2>&1 && printf '%s' "$lj" > "$LOC" || touch "$LOC"
    fi
    if [ "$(age "$WX")" -gt 900 ] && [ -s "$LOC" ]; then
        tunit=$(jq -r '.preferences.temperatureUnit // "fahrenheit"' "$SETTINGS_FILE" 2>/dev/null)
        [ "$tunit" = "celsius" ] || tunit="fahrenheit"
        lat=$(jq -r '.lat // empty' "$LOC" 2>/dev/null); lon=$(jq -r '.lon // empty' "$LOC" 2>/dev/null)
        if [ -n "$lat" ]; then
            wj=$(curl -s --max-time 2 "https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&temperature_unit=${tunit}&forecast_days=2" 2>/dev/null)
            printf '%s' "$wj" | jq -r 'select(.current) | "\(.current.temperature_2m|floor)|\(.current.weather_code)|\(.daily.temperature_2m_max[1]|floor)|\(.daily.temperature_2m_min[1]|floor)|\(.daily.precipitation_probability_max[1] // 0)"' \
                > "$WX.tmp" 2>/dev/null && [ -s "$WX.tmp" ] && mv "$WX.tmp" "$WX"
            rm -f "$WX.tmp"
        fi
    fi
    city=$(jq -r '.city // empty' "$LOC" 2>/dev/null)
    abbr=$(printf '%s' "$city" | tr -cd '[:alpha:]' | cut -c1-3 | tr '[:lower:]' '[:upper:]')
    IFS='|' read -r w_t w_code w_th w_tl w_rain < "$WX" 2>/dev/null
    hr=$(date +%H); hr=${hr#0}
    case "$w_code" in
        0) icon=$([ "$hr" -ge 6 ] && [ "$hr" -lt 20 ] && echo "☀" || echo "☾") ;;
        1|2|3) icon="☁" ;; 45|48) icon="≋" ;; 51|53|55|56|57|61|63|65|66|67|80|81|82) icon="☂" ;;
        71|73|75|77|85|86) icon="❄" ;; 95|96|99) icon="⚡" ;; *) icon="" ;;
    esac
    wx_seg="${MU}${abbr:+$abbr }${R}${TX}$(date +%H:%M)${R}"
    [ -n "$w_t" ] && wx_seg="${wx_seg} ${WR}${icon}${R} ${TX}${w_t}°${R}"
fi

voice_seg=""
if [ -f "$VOICE_FILE" ]; then
    if jq -e '.enabled == true or .voice == "on" or .state == "on"' "$VOICE_FILE" >/dev/null 2>&1; then voice_seg="🔊"; else voice_seg="${DIM}🔇${R}"; fi
fi

# ── assemble ────────────────────────────────────────────────────────────────
join() {  # join segments with the separator, skipping empties
    local out="" s
    for s in "$@"; do [ -z "$s" ] && continue; [ -n "$out" ] && out="${out}${SEP}"; out="${out}${s}"; done
    printf '%s' "$out"
}

case "$MODE" in
    one)
        printf '%s\n' "$(join "$wordmark" "${cc}${ctx_pct}%${R}" "${git_seg:-$cwd_seg}")"
        ;;
    *)
        # five groups, one per line: session · code · memory · plan · environment
        extra_sess=""; extra_code=""; extra_env=""
        if [ "$MODE" = "full" ]; then
            [ -n "$cache_hit" ] && extra_sess="${MU}cache${R} ${TX}$(awk -v h="$cache_hit" 'BEGIN{printf "%d%%", h*100}')${R}"
            extra_code="${OK}+${lines_add}${R} ${BAD}-${lines_del}${R}"
            load=$(uptime 2>/dev/null | sed -E 's/.*load averages?: *//' | awk '{ sub(/,$/, "", $1); print $1 }')
            extra_env="${MU}load${R} ${TX}${load}${R}"
            [ -n "$w_th" ] && wx_seg="${wx_seg} ${DIM}· tmrw ↑${w_th}° ↓${w_tl}° ☂${w_rain}%${R}"
        fi
        printf '%s\n' "$(join "$wordmark" "$ident" "$model_seg" "$ctx_seg" "$sess_seg" "$extra_sess")"
        printf '%s\n' "$(join "$git_seg" "$extra_code" "$cwd_seg" "$algo_seg" "$hooks_seg")"
        printf '%s\n' "$(join "$mem_seg" "$recall_seg" "$rating_seg")"
        [ -n "$plan_seg" ] && printf '%s\n' "$plan_seg"
        printf '%s\n' "$(join "$wx_seg" "$gpu_seg" "$extra_env" "$voice_seg")"
        ;;
esac
