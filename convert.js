// convert.js
// Usage:
//   npm i csv-parser
//   node convert.js tabulatimes.csv scoring.js
//
// Then in index.html either:
//   <script src="scoring.js"></script>
// OR rename scoring.js -> event_data.js and keep your current script tag.

const fs = require("fs");
const csv = require("csv-parser");

const input = process.argv[2] || "tabulatimes.csv";
const output = process.argv[3] || "scoring.js";

// Events we want + the exact column header strings that appear in your CSV header rows
const EVENTS = [
    { key: "100m", headers: ["100m"] },
    { key: "200m", headers: ["200m"] },
    { key: "300m", headers: ["300m"] },
    { key: "400m", headers: ["400m"] },
    { key: "800m", headers: ["800m"] },
    { key: "mile", headers: ["Mile"] },
    { key: "5k", headers: ["5 km"] },
    { key: "10k", headers: ["10 km"] },
    { key: "hm", headers: ["HM"] },
    { key: "marathon", headers: ["Marathon"] },
];

// Labels used by index.html
const labels = {
    "100m": "100m",
    "200m": "200m",
    "300m": "300m",
    "400m": "400m",
    "800m": "800m",
    "mile": "1 mile (road)",
    "5k": "5 km (road)",
    "10k": "10 km (road)",
    "hm": "Half Marathon",
    "marathon": "Marathon",
};

function clean(s) {
    if (s === null || s === undefined) return "";
    return String(s).trim();
}

function isBlankOrDash(v) {
    const t = clean(v);
    return t === "" || t === "-" || t === "—";
}

// Supports:
//  - "9.46"       -> 9.46
//  - "17:37"      -> 1057
//  - "2:16.92"    -> 136.92
//  - "1:24:26"    -> 5066
function toSeconds(timeStr) {
    const s = clean(timeStr);
    if (!s || s === "-" || s === "—") return null;

    if (s.indexOf(":") === -1) {
        const x = Number(s);
        return Number.isFinite(x) ? x : null;
    }

    const parts = s.split(":").map(Number);
    if (parts.some((x) => !Number.isFinite(x))) return null;

    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];

    return null;
}

function isIntegerPoints(s) {
    return /^[0-9]{1,4}$/.test(clean(s));
}

// Convert csv-parser row object { '0': '...', '1': '...' } into array in column order
function objToRowArray(rowObj) {
    return Object.keys(rowObj)
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => clean(rowObj[k]));
}

// raw[eventKey][pts] = time string
const raw = Object.fromEntries(EVENTS.map((e) => [e.key, {}]));

// Section state: changes whenever we hit a header row containing "Points"
let pointsIdx = null; // numeric column index of "Points" for current section
let eventIdxByKey = {}; // event key -> numeric column index for current section
let sawHeader = false;

fs.createReadStream(input)
    // IMPORTANT: headers:false means each row comes through as columns 0..N
    .pipe(csv({ headers: false, skipLines: 0 }))
    .on("data", (rowObj) => {
        const row = objToRowArray(rowObj);

        // Skip empty rows
        if (!row.some((c) => c !== "")) return;

        // Detect header row (contains "Points")
        const p = row.findIndex((c) => c.toLowerCase() === "points");
        if (p !== -1) {
            pointsIdx = p;
            eventIdxByKey = {};
            sawHeader = true;

            // Map our events to column indices in THIS header row
            for (const ev of EVENTS) {
                const idx = row.findIndex((c) => ev.headers.includes(c));
                if (idx !== -1) eventIdxByKey[ev.key] = idx;
            }
            return;
        }

        // Can't parse data until we've seen a header
        if (!sawHeader || pointsIdx === null) return;

        const ptsStr = clean(row[pointsIdx]);
        if (!isIntegerPoints(ptsStr)) return;

        const pts = Number(ptsStr);
        if (!Number.isInteger(pts) || pts < 1 || pts > 1400) return;

        // Capture times for any event columns present in this section
        for (const [key, idx] of Object.entries(eventIdxByKey)) {
            const val = row[idx];
            if (isBlankOrDash(val)) continue;
            raw[key][pts] = clean(val);
        }
    })
    .on("end", () => {
        const scoring = {};

        for (const ev of EVENTS) {
            const key = ev.key;

            // Build filled array for pts 1..1400
            // Rule: if a point is missing, use the next faster time (from higher points)
            const filled = Array(1401).fill(null);

            // Carry downward from 1400 -> 1
            let last = null;
            for (let pts = 1400; pts >= 1; pts--) {
                if (raw[key][pts]) last = raw[key][pts];
                filled[pts] = last;
            }

            // If the very top end was missing, fill upward from the first found (rare but safe)
            let next = null;
            for (let pts = 1; pts <= 1400; pts++) {
                if (filled[pts] !== null && filled[pts] !== undefined) next = filled[pts];
                else filled[pts] = next;
            }

            scoring[key] = [];
            for (let pts = 1; pts <= 1400; pts++) {
                const time = (filled[pts] !== null && filled[pts] !== undefined) ? filled[pts] : "-";
                const sec = (time === "-") ? null : toSeconds(time);
                scoring[key].push({ pts, time, sec });
            }
        }

        // Output globals for index.html
        const out =
            "const labels = " + JSON.stringify(labels, null, 2) + ";\n\n" +
            "const scoring = " + JSON.stringify(scoring, null, 2) + ";\n";

        fs.writeFileSync(output, out, "utf8");
        console.log("Wrote:", output);

        // Quick sanity print so you can see it's not empty
        for (const ev of EVENTS) {
            const nonDash = scoring[ev.key].filter(r => r.time !== "-").length;
            console.log(ev.key, "non-dash rows:", nonDash);
        }
    })
    .on("error", (err) => {
        console.error("Error:", err);
        process.exit(1);
    });