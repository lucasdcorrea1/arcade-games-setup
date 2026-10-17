// Maps ROM-site category slugs (e.g. the "<slug>" in retrostic .../roms/<slug>/...)
// to the RetroPie roms folder name under ~/RetroPie/roms/<folder>.
//
// The folder is only a sensible default: the UI always lets the user override it,
// because the right arcade folder (arcade / mame / mame-libretro / fba) depends on
// which emulator is installed on that particular RetroPie.

const SYSTEMS = [
  { folder: 'nes', label: 'Nintendo (NES)', slugs: ['nes', 'nintendo-entertainment-system-nes', 'nintendo', 'famicom'] },
  { folder: 'snes', label: 'Super Nintendo (SNES)', slugs: ['snes', 'super-nintendo-snes', 'super-nintendo'] },
  { folder: 'n64', label: 'Nintendo 64', slugs: ['n64', 'nintendo-64'] },
  { folder: 'gb', label: 'Game Boy', slugs: ['gb', 'game-boy', 'gameboy'] },
  { folder: 'gbc', label: 'Game Boy Color', slugs: ['gbc', 'game-boy-color'] },
  { folder: 'gba', label: 'Game Boy Advance', slugs: ['gba', 'game-boy-advance'] },
  { folder: 'nds', label: 'Nintendo DS', slugs: ['nds', 'nintendo-ds'] },
  { folder: 'virtualboy', label: 'Virtual Boy', slugs: ['virtualboy', 'virtual-boy'] },
  { folder: 'megadrive', label: 'Mega Drive / Genesis', slugs: ['megadrive', 'genesis', 'sega-genesis', 'sega-mega-drive', 'mega-drive'] },
  { folder: 'mastersystem', label: 'Master System', slugs: ['mastersystem', 'sega-master-system', 'master-system'] },
  { folder: 'gamegear', label: 'Game Gear', slugs: ['gamegear', 'sega-game-gear', 'game-gear'] },
  { folder: 'segacd', label: 'Sega CD', slugs: ['segacd', 'sega-cd'] },
  { folder: 'sega32x', label: 'Sega 32X', slugs: ['sega32x', 'sega-32x', '32x'] },
  { folder: 'saturn', label: 'Sega Saturn', slugs: ['saturn', 'sega-saturn'] },
  { folder: 'dreamcast', label: 'Dreamcast / NAOMI', slugs: ['dreamcast', 'sega-dreamcast', 'naomi'] },
  { folder: 'psx', label: 'PlayStation (PSX)', slugs: ['psx', 'playstation', 'sony-playstation', 'ps1', 'ps-1'] },
  { folder: 'psp', label: 'PSP', slugs: ['psp', 'playstation-portable', 'sony-psp'] },
  { folder: 'fba', label: 'Arcade (MAME / FBA)', slugs: ['mame', 'arcade', 'fba', 'fbneo', 'final-burn', 'cps-1', 'cps-2', 'cps-3', 'cps1', 'cps2', 'cps3'] },
  { folder: 'neogeo', label: 'Neo Geo', slugs: ['neogeo', 'neo-geo', 'snk-neo-geo'] },
  { folder: 'pcengine', label: 'PC Engine / TurboGrafx-16', slugs: ['pcengine', 'pc-engine', 'turbografx-16', 'turbografx', 'turbografx16'] },
  { folder: 'atari2600', label: 'Atari 2600', slugs: ['atari2600', 'atari-2600'] },
  { folder: 'atari5200', label: 'Atari 5200', slugs: ['atari5200', 'atari-5200'] },
  { folder: 'atari7800', label: 'Atari 7800', slugs: ['atari7800', 'atari-7800'] },
  { folder: 'atarilynx', label: 'Atari Lynx', slugs: ['atarilynx', 'atari-lynx', 'lynx'] },
  { folder: 'wonderswan', label: 'WonderSwan', slugs: ['wonderswan', 'wonder-swan'] },
  { folder: 'wonderswancolor', label: 'WonderSwan Color', slugs: ['wonderswancolor', 'wonderswan-color'] },
  { folder: 'msx', label: 'MSX', slugs: ['msx'] },
  { folder: 'c64', label: 'Commodore 64', slugs: ['c64', 'commodore-64', 'commodore', 'c64-tapes', 'c64-preservation'] },
  { folder: 'amiga', label: 'Amiga', slugs: ['amiga', 'commodore-amiga'] },
  { folder: '3do', label: '3DO', slugs: ['3do', 'panasonic-3do'] },
  { folder: 'coleco', label: 'ColecoVision', slugs: ['coleco', 'colecovision'] },
  { folder: 'intellivision', label: 'Intellivision', slugs: ['intellivision'] },
  { folder: 'vectrex', label: 'Vectrex', slugs: ['vectrex'] },
  { folder: 'gameandwatch', label: 'Game & Watch', slugs: ['gameandwatch', 'game-and-watch', 'game-watch'] }
];

// Build a lookup from every known slug to its folder.
const SLUG_TO_FOLDER = {};
for (const sys of SYSTEMS) {
  for (const slug of sys.slugs) SLUG_TO_FOLDER[slug] = sys.folder;
}

// Extract the category slug from a ROM-site URL and map it to a RetroPie folder.
// Returns { slug, folder } where folder falls back to the raw slug if unknown,
// or null when no "/roms/<slug>/" segment is present.
function systemFromUrl(url) {
  if (!url) return null;
  const match = /\/roms\/([^/?#]+)/i.exec(url);
  if (!match) return null;
  const slug = decodeURIComponent(match[1]).toLowerCase();
  const folder = SLUG_TO_FOLDER[slug] || slug;
  return { slug, folder };
}

module.exports = { SYSTEMS, systemFromUrl };
