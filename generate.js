// World Labs Marble API — 3D World Generator
// Usage: WLT_API_KEY=xxx node generate.js "A cozy cyberpunk apartment with neon lights"

const API_BASE = "https://api.worldlabs.ai/marble/v1";
const API_KEY = process.env.WLT_API_KEY;

if (!API_KEY) {
  console.error("Error: WLT_API_KEY environment variable is required");
  process.exit(1);
}

const prompt = process.argv.slice(2).join(" ");
if (!prompt) {
  console.error("Usage: WLT_API_KEY=xxx node generate.js \"your prompt here\"");
  process.exit(1);
}

const headers = {
  "Content-Type": "application/json",
  "WLT-Api-Key": API_KEY,
};

// Generate world
console.log(`Generating world: "${prompt}"\n`);

const genRes = await fetch(`${API_BASE}/worlds:generate`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    display_name: prompt.slice(0, 60),
    world_prompt: { type: "text", text_prompt: prompt },
    model: "Marble 0.1-mini",
  }),
});

if (!genRes.ok) {
  const err = await genRes.text();
  console.error(`Generate failed (${genRes.status}): ${err}`);
  process.exit(1);
}

const { operation_id } = await genRes.json();
console.log(`Operation: ${operation_id}`);
console.log("Polling for completion...\n");

// Poll until done
let result;
while (true) {
  await new Promise((r) => setTimeout(r, 5000));

  const pollRes = await fetch(`${API_BASE}/operations/${operation_id}`, {
    headers,
  });

  if (!pollRes.ok) {
    const err = await pollRes.text();
    console.error(`Poll failed (${pollRes.status}): ${err}`);
    process.exit(1);
  }

  const data = await pollRes.json();
  if (data.done) {
    result = data;
    break;
  }

  process.stdout.write(".");
}

console.log("\nWorld generated!\n");

// Extract assets
const response = result.response || {};
const assets = response.assets || {};
const splats = assets.splats || {};
const mesh = assets.mesh || {};

const worldData = {
  operation_id,
  prompt,
  generated_at: new Date().toISOString(),
  display_name: prompt.slice(0, 60),
  splat_urls: splats.spz_urls || {},
  collider_mesh_url: mesh.collider_mesh_url || null,
  raw_response: result,
};

// Print summary
console.log("--- World Details ---");
console.log(`Prompt: ${prompt}`);
if (worldData.splat_urls.full_res) {
  console.log(`Splat (full res): ${worldData.splat_urls.full_res}`);
}
if (worldData.collider_mesh_url) {
  console.log(`Collider mesh: ${worldData.collider_mesh_url}`);
}
console.log();

// Save to file
const slug = prompt
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "")
  .slice(0, 50);
const timestamp = Date.now();
const outPath = new URL(
  `worlds/${slug}-${timestamp}.json`,
  import.meta.url
);

const fs = await import("node:fs");
fs.writeFileSync(outPath, JSON.stringify(worldData, null, 2));
console.log(`Saved: ${outPath.pathname}`);
