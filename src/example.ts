import { LyricsManager } from './index';

async function main(): Promise<void> {
  const manager = new LyricsManager({
    providers: [
      'LRCLIB', 'Musixmatch', 'NetEase', 'LetrasMus', 'Spotify',
      'KuGou', 'QQMusic', 'AppleMusic', 'YouLyPlus',
      'BiniLyrics', 'BetterLyrics', 'LyricsOvh', 'Unison', 'Genius', 'LyricFind',
      'YouTubeMusic', 'YouTubeCaptions'
    ],
    lyricfind: {
      apiKey: process.env.LYRICFIND_API_KEY,
      territory: process.env.LYRICFIND_TERRITORY
    },
    youtubeMusic: { cookies: process.env.YT_MUSIC_COOKIES },
    youtubeCaptions: { cookies: process.env.YT_MUSIC_COOKIES },
    preferSynced: true
  });

  await manager.initialize();

  const query = process.argv.slice(2).join(' ') || 'Adele - Hello';
  console.log(`\nSearching lyrics for: "${query}"\n`);

  const result = await manager.getLyrics(query);
  if (!result) {
    console.log('No lyrics found in any provider.');
    return;
  }

  console.log(`Provider: ${result.provider}`);
  console.log(`Synced: ${result.synced}`);
  if (result.name) console.log(`Track: ${result.name}`);
  if (result.artist) console.log(`Artist: ${result.artist}`);
  if (result.album) console.log(`Album: ${result.album}`);
  console.log(`Lines: ${result.lines.length}\n`);

  const sample = result.lines.slice(0, 10);
  for (const line of sample) {
    if (result.synced) {
      const m = Math.floor(line.time / 60_000);
      const s = (line.time - m * 60_000) / 1000;
      console.log(`[${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}] ${line.text}`);
    } else {
      console.log(line.text);
    }
  }

  if (result.lines.length > 10) console.log(`... (+${result.lines.length - 10} more lines)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
