// One raw HTTPS call to the Anthropic Messages API (no SDK → nothing to install),
// plus the parse / insight / review / vision handlers and their JSON schema.

const MODEL = process.env.DAYBLOOM_MODEL || "claude-opus-4-8";

const PARSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    mood: { anyOf: [{ type: "string", enum: ["😔", "😐", "🙂", "😊", "🤩"] }, { type: "null" }] },
    habits_done: { type: "array", items: { type: "string" } },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: ["sleep", "food", "water", "exercise", "weight", "meds", "screen_time", "work_stress", "metric", "task", "note", "other"] },
          bucket: { type: "string", enum: ["Health", "Work", "Legal", "Personal", "Other"] },
          label: { type: "string" },
          amount: { anyOf: [{ type: "number" }, { type: "null" }] },
          metric: { anyOf: [{ type: "string" }, { type: "null" }] },
          unit: { anyOf: [{ type: "string" }, { type: "null" }] },
          calories: { anyOf: [{ type: "number" }, { type: "null" }] },
          protein_g: { anyOf: [{ type: "number" }, { type: "null" }] },
          carbs_g: { anyOf: [{ type: "number" }, { type: "null" }] },
          fat_g: { anyOf: [{ type: "number" }, { type: "null" }] }
        },
        required: ["kind", "bucket", "label", "amount", "metric", "unit", "calories", "protein_g", "carbs_g", "fat_g"]
      }
    }
  },
  required: ["summary", "mood", "habits_done", "items"]
};

async function callClaude(payload) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { configured: false };
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(payload)
  });
  if (!r.ok) { const t = await r.text(); throw new Error("Anthropic " + r.status + ": " + t.slice(0, 300)); }
  const data = await r.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  return { configured: true, text: text };
}

function hasKey() { return !!process.env.ANTHROPIC_API_KEY; }

// --- free text → structured items ---
async function parseText(text, habits) {
  const sys = "You turn a person's free-text daily log into structured items. " +
    "Break the text into one item per distinct thing they mention. For each item set: " +
    "kind (sleep, food, water, exercise, meds, screen_time, work_stress, task, note, or other); " +
    "bucket, the life area it belongs to (Health, Work, Legal, Personal, or Other); " +
    "label, a short human phrase to display (e.g. 'Slept 6.5h', 'Took Wellbutrin', 'Email the lawyer'); " +
    "and amount, a number when there is a clear one (hours of sleep, glasses of water, minutes of exercise, a 1-5 stress or screen level), else null. " +
    "For body weight use kind 'weight' with the number in amount and the unit (lb or kg) in unit. " +
    "For ANY other numeric thing not covered by the fixed kinds (steps, heart rate, caffeine, calories, etc.) use kind 'metric', set metric to a short name for it (e.g. 'caffeine', 'steps', 'resting HR'), and fill amount and unit. Never drop information — if it does not fit a kind, make it a metric or a note. Leave metric and unit null when they do not apply. " +
    "Anything they intend to do is a task. Anything reflective with no number is a note. " +
    "For food/drink items, estimate the nutrition from a typical portion and fill calories, protein_g, carbs_g, fat_g (grams). Leave those four null for anything that is not food or drink. " +
    "Also set mood to the single closest of the five faces, or null. " +
    "Their current habit names are: " + (habits.join(", ") || "(none)") + ". If the text clearly says they did one, put its EXACT name in habits_done. " +
    "Keep summary to a short phrase (max 8 words).";
  const out = await callClaude({
    model: MODEL, max_tokens: 400, system: sys,
    messages: [{ role: "user", content: text }],
    output_config: { format: { type: "json_schema", schema: PARSE_SCHEMA } }
  });
  if (!out.configured) return { configured: false };
  let data; try { data = JSON.parse(out.text); } catch (e) { return { configured: false, error: "unparseable" }; }
  return { configured: true, data: data };
}

// --- one short insight ---
async function insight(state) {
  const sys = "You are a warm, sharp personal wellness coach. Given the user's recent tracking data as JSON, " +
    "write ONE short, specific, encouraging insight (max 28 words) about a pattern you notice or a gentle nudge for today. " +
    "Address them as 'you'. No preamble, no markdown, no quotes — just the single sentence.";
  const out = await callClaude({
    model: MODEL, max_tokens: 200, system: sys,
    messages: [{ role: "user", content: JSON.stringify(state || {}) }]
  });
  if (!out.configured) return { configured: false };
  return { configured: true, text: out.text.trim() };
}

// --- written day/week/month review ---
async function review(body) {
  const period = ["day", "week", "month"].indexOf(body.period) > -1 ? body.period : "week";
  const sys = "You're Claude, looking over a friend's " + period + " of self-tracking (her name is Aneeta). Respond the way you naturally would if she shared this with you — warm, direct, and genuinely thoughtful, not a chirpy wellness-app script. " +
    "Notice something real and specific in the data, connect a couple of dots if the data honestly supports it, and offer one grounded reflection or suggestion. It's okay to be honest when a stretch looks hard (rough sleep, a stressful run of days). " +
    "When a day includes a 'planned' list, compare it to what actually happened and reflect on the gap without judgment. " +
    "For a week review, a 'weekly_plan' lists what she meant to focus on this week; for a month review, 'monthly_goals' lists her goals with progress. When present, weigh what happened against those intentions and speak to how the week or month is tracking toward them. " +
    "If 'calendar' events are present, treat them as what was actually scheduled and feel free to connect them to how the time was spent. " +
    "Keep it to a short paragraph — 2 to 5 sentences, since she's reading it on a phone card. Plain text: no markdown, no bullet points, no preamble like 'Here's your review'. If there's very little data yet, say so kindly and name one specific thing worth logging next.";
  const out = await callClaude({
    model: MODEL, max_tokens: 1600,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    system: sys,
    messages: [{ role: "user", content: JSON.stringify(body).slice(0, 12000) }]
  });
  if (!out.configured) return { configured: false };
  return { configured: true, text: out.text.trim() };
}

// --- vision: read a screenshot into items ---
async function parseImage(media, b64, habits) {
  const sys = "You read a screenshot from a health or tracking app (often Apple Health — sleep, steps, heart rate, workouts) " +
    "and turn what you see into structured items. For each item set kind (sleep, food, water, exercise, meds, screen_time, work_stress, task, note, or other), " +
    "bucket (Health, Work, Legal, Personal, or Other), a short label (e.g. 'Slept 6h 40m', '8,432 steps'), and amount (the main number, e.g. sleep hours as a decimal, or null). " +
    "If the screenshot shows food or a nutrition label, estimate calories, protein_g, carbs_g, fat_g; otherwise leave those null. " +
    "Their current habit names are: " + (habits.join(", ") || "(none)") + ". Set mood to null unless the screenshot clearly shows it. Keep summary short.";
  const out = await callClaude({
    model: MODEL, max_tokens: 500, system: sys,
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: media, data: b64 } },
      { type: "text", text: "Extract the structured items from this screenshot." }
    ] }],
    output_config: { format: { type: "json_schema", schema: PARSE_SCHEMA } }
  });
  if (!out.configured) return { configured: false };
  let data; try { data = JSON.parse(out.text); } catch (e) { return { configured: false, error: "unparseable" }; }
  return { configured: true, data: data };
}

module.exports = { MODEL, PARSE_SCHEMA, callClaude, hasKey, parseText, insight, review, parseImage };
