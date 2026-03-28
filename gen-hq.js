const API_KEY = 'xugLJ3dzxt5emLw2X0H0TgWSaZIZxqZJ';
const BASE = 'https://api.worldlabs.ai/marble/v1';
const headers = { 'Content-Type': 'application/json', 'WLT-Api-Key': API_KEY };

const prompt = "First person view standing at street level on Fifth Avenue Manhattan NYC, tall modern glass skyscrapers towering on both sides, yellow taxi cabs on the road, pedestrians on sidewalks, clear blue sky, American flags, trees lining the avenue, looking straight down the avenue";

console.log('Generating HQ Manhattan (plus model, ~5 min)...');

const res = await fetch(`${BASE}/worlds:generate`, {
  method: 'POST', headers,
  body: JSON.stringify({
    display_name: 'Manhattan Fifth Ave HQ',
    world_prompt: { type: 'text', text_prompt: prompt },
    model: 'Marble 0.1-plus'
  })
});
const { operation_id } = await res.json();
console.log('Operation:', operation_id);

while (true) {
  await new Promise(r => setTimeout(r, 10000));
  const poll = await fetch(`${BASE}/operations/${operation_id}`, { headers });
  const data = await poll.json();
  if (data.done) {
    const assets = data.response?.assets || {};
    console.log('\nDONE!');
    console.log('Full res:', assets.splats?.spz_urls?.full_res);
    console.log('500k:', assets.splats?.spz_urls?.['500k']);
    console.log('100k:', assets.splats?.spz_urls?.['100k']);
    console.log('Collider:', assets.mesh?.collider_mesh_url);
    console.log('Caption:', assets.caption?.substring(0, 200));

    const fs = await import('node:fs');
    fs.writeFileSync('/Users/gtrush/Downloads/oracle/worlds/manhattan-hq.json', JSON.stringify(data, null, 2));
    break;
  }
  process.stdout.write('.');
}
