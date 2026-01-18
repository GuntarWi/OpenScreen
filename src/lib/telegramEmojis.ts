export interface TelegramEmoji {
  name: string;
  category: string;
  src: string;
}

const RAW_BASE = 'https://raw.githubusercontent.com/Tarikul-Islam-Anik/Telegram-Animated-Emojis/main';
const API_BASE = 'https://api.github.com/repos/Tarikul-Islam-Anik/Telegram-Animated-Emojis/contents';
const CACHE_KEY = 'openscreen-telegram-emojis-v1';
const LOCAL_MANIFEST = '/telegram-animated-emojis/manifest.json';

export const FALLBACK_EMOJIS: TelegramEmoji[] = [
  { name: 'Party Popper', category: 'Activity', src: `${RAW_BASE}/Activity/Party%20Popper.webp` },
  { name: '1st Place Medal', category: 'Activity', src: `${RAW_BASE}/Activity/1st%20Place%20Medal.webp` },
  { name: 'Alien', category: 'Smileys', src: `${RAW_BASE}/Smileys/Alien.webp` },
  { name: 'Alien Monster', category: 'Smileys', src: `${RAW_BASE}/Smileys/Alien%20Monster.webp` },
  { name: 'Cat With Tears Of Joy', category: 'Smileys', src: `${RAW_BASE}/Smileys/Cat%20With%20Tears%20Of%20Joy.webp` },
  { name: 'Ant', category: 'Animals and Nature', src: `${RAW_BASE}/Animals%20and%20Nature/Ant.webp` },
  { name: 'Baby Chick', category: 'Animals and Nature', src: `${RAW_BASE}/Animals%20and%20Nature/Baby%20Chick.webp` },
  { name: 'Banana', category: 'Food and Drink', src: `${RAW_BASE}/Food%20and%20Drink/Banana.webp` },
  { name: 'Bento Box', category: 'Food and Drink', src: `${RAW_BASE}/Food%20and%20Drink/Bento%20Box.webp` },
  { name: 'Automobile', category: 'Travel and Places', src: `${RAW_BASE}/Travel%20and%20Places/Automobile.webp` },
  { name: 'Airplane', category: 'Travel and Places', src: `${RAW_BASE}/Travel%20and%20Places/Airplane.webp` },
  { name: 'Backhand Index Left', category: 'People', src: `${RAW_BASE}/People/Backhand%20Index%20Pointing%20Left.webp` },
];

function tryLoadCache(): TelegramEmoji[] | null {
  try {
    const cached = typeof window !== 'undefined' ? window.localStorage.getItem(CACHE_KEY) : null;
    if (!cached) return null;
    const parsed = JSON.parse(cached);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch {
    // ignore cache errors
  }
  return null;
}

function saveCache(emojis: TelegramEmoji[]) {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(emojis.slice(0, 1500)));
  } catch {
    // ignore cache errors
  }
}

export async function loadTelegramEmojis(): Promise<TelegramEmoji[]> {
  // Prefer locally bundled manifest if available (offline-friendly)
  try {
    const localResp = await fetch(LOCAL_MANIFEST, { cache: 'force-cache' });
    if (localResp.ok) {
      const localData = await localResp.json();
      if (Array.isArray(localData) && localData.length > 0) {
        saveCache(localData);
        return localData as TelegramEmoji[];
      }
    }
  } catch {
    // Ignore and fall back to remote sources
  }

  const cached = tryLoadCache();
  if (cached && cached.length > 0) {
    return cached;
  }

  try {
    const rootResp = await fetch(API_BASE, {
      headers: {
        Accept: 'application/vnd.github+json',
      },
    });
    if (!rootResp.ok) {
      throw new Error(`Root request failed: ${rootResp.status}`);
    }
    const root = await rootResp.json();
    const categories = Array.isArray(root)
      ? root.filter((item) => item?.type === 'dir' && item?.name && item.name !== 'web')
      : [];

    const emojis: TelegramEmoji[] = [];

    for (const category of categories) {
      const url: string = category.url;
      const separator = url.includes('?') ? '&' : '?';
      const catResp = await fetch(`${url}${separator}per_page=200`, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!catResp.ok) continue;
      const files = await catResp.json();
      if (!Array.isArray(files)) continue;

      for (const file of files) {
        if (!file?.name || typeof file.name !== 'string') continue;
        if (!file.name.toLowerCase().endsWith('.webp')) continue;
        const friendlyName = decodeURIComponent(file.name.replace(/\.webp$/i, '').replace(/%20/g, ' ')).replace(/_/g, ' ');
        const encodedCategory = encodeURIComponent(category.name);
        const encodedFile = encodeURIComponent(file.name);
        emojis.push({
          name: friendlyName,
          category: category.name,
          src: `${RAW_BASE}/${encodedCategory}/${encodedFile}`,
        });
      }
    }

    const sorted = emojis.sort((a, b) => a.name.localeCompare(b.name));
    if (sorted.length > 0) {
      saveCache(sorted);
      return sorted;
    }
  } catch (error) {
    console.warn('[emoji-manifest] Falling back to bundled list', error);
  }

  return FALLBACK_EMOJIS;
}
