import { LyricsManager } from './index';

const PROVIDERS = [
  'Musixmatch', 'LRCLIB', 'NetEase', 'LetrasMus',
  'Spotify', 'KuGou', 'QQMusic', 'AppleMusic', 'YouLyPlus',
  'BiniLyrics', 'BetterLyrics', 'LyricsOvh', 'Unison', 'Genius',
  'LyricFind', 'YouTubeMusic', 'YouTubeCaptions'
];

async function main(): Promise<void> {
  const query = process.argv[2] || 'Adele Hello';
  const manager = new LyricsManager({ providers: PROVIDERS, preferSynced: true });
  await manager.initialize();

  console.log(`\n========== Testing all ${PROVIDERS.length} providers with: "${query}" ==========\n`);

  for (const name of PROVIDERS) {
    process.stdout.write(`  ${name.padEnd(20)} `);
    const t0 = Date.now();
    try {
      const r = await manager.getFromProvider(name, query);
      const ms = Date.now() - t0;
      if (r && r.lines.length > 0) {
        console.log(`OK   ${String(r.lines.length).padStart(4)} lines  synced=${r.synced}  ${ms}ms`);
      } else if (r) {
        console.log(`EMPTY (0 lines)            ${ms}ms`);
      } else {
        console.log(`MISS                       ${ms}ms`);
      }
    } catch (err) {
      console.log(`ERR  ${(err as Error).message.substring(0, 50)}  ${Date.now() - t0}ms`);
    }
  }

  console.log(`\n========== Manager (fallback) ==========\n`);
  const t0 = Date.now();
  const r = await manager.getLyrics(query);
  const ms = Date.now() - t0;
  if (r) {
    console.log(`Provider: ${r.provider}`);
    console.log(`Lines:    ${r.lines.length}`);
    console.log(`Synced:   ${r.synced}`);
    if (r.name) console.log(`Name:     ${r.name}`);
    if (r.artist) console.log(`Artist:   ${r.artist}`);
    console.log(`Time:     ${ms}ms`);
    console.log('\nFirst 5 lines:');
    for (const line of r.lines.slice(0, 5)) {
      if (r.synced) {
        const m = Math.floor(line.time / 60_000);
        const s = (line.time - m * 60_000) / 1000;
        console.log(`  [${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}] ${line.text}`);
      } else {
        console.log(`  ${line.text}`);
      }
    }
  } else {
    console.log(`No lyrics found. ${ms}ms`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});