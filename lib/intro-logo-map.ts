/**
 * Drop-in map for *licensed* official intro artwork.
 *
 * Metro requires static `require()` paths. After NFL/NBA Properties delivers
 * licensed PNGs into assets/intro/{nfl|nba}/, uncomment each line.
 *
 * Until then every entry stays undefined and SportsBrandIntro falls back to
 * color silhouettes (no trademarked marks shipped in-repo).
 *
 * Optional CDN: set EXPO_PUBLIC_INTRO_ASSET_BASE=https://your-cdn/licensed
 * to load `{base}/nfl/{CODE}.png` and `{base}/nba/{CODE}.png`.
 */
import type { ImageSourcePropType } from 'react-native';

export const nflHelmetImages: Partial<Record<string, ImageSourcePropType>> = {
  // ARI: require('../assets/intro/nfl/ARI.png'),
  // ATL: require('../assets/intro/nfl/ATL.png'),
  // BAL: require('../assets/intro/nfl/BAL.png'),
  // BUF: require('../assets/intro/nfl/BUF.png'),
  // CAR: require('../assets/intro/nfl/CAR.png'),
  // CHI: require('../assets/intro/nfl/CHI.png'),
  // CIN: require('../assets/intro/nfl/CIN.png'),
  // CLE: require('../assets/intro/nfl/CLE.png'),
  // DAL: require('../assets/intro/nfl/DAL.png'),
  // DEN: require('../assets/intro/nfl/DEN.png'),
  // DET: require('../assets/intro/nfl/DET.png'),
  // GB: require('../assets/intro/nfl/GB.png'),
  // HOU: require('../assets/intro/nfl/HOU.png'),
  // IND: require('../assets/intro/nfl/IND.png'),
  // JAX: require('../assets/intro/nfl/JAX.png'),
  // KC: require('../assets/intro/nfl/KC.png'),
  // LV: require('../assets/intro/nfl/LV.png'),
  // LAC: require('../assets/intro/nfl/LAC.png'),
  // LAR: require('../assets/intro/nfl/LAR.png'),
  // MIA: require('../assets/intro/nfl/MIA.png'),
  // MIN: require('../assets/intro/nfl/MIN.png'),
  // NE: require('../assets/intro/nfl/NE.png'),
  // NO: require('../assets/intro/nfl/NO.png'),
  // NYG: require('../assets/intro/nfl/NYG.png'),
  // NYJ: require('../assets/intro/nfl/NYJ.png'),
  // PHI: require('../assets/intro/nfl/PHI.png'),
  // PIT: require('../assets/intro/nfl/PIT.png'),
  // SF: require('../assets/intro/nfl/SF.png'),
  // SEA: require('../assets/intro/nfl/SEA.png'),
  // TB: require('../assets/intro/nfl/TB.png'),
  // TEN: require('../assets/intro/nfl/TEN.png'),
  // WAS: require('../assets/intro/nfl/WAS.png'),
};

export const nbaJerseyImages: Partial<Record<string, ImageSourcePropType>> = {
  // ATL: require('../assets/intro/nba/ATL.png'),
  // BOS: require('../assets/intro/nba/BOS.png'),
  // BKN: require('../assets/intro/nba/BKN.png'),
  // CHA: require('../assets/intro/nba/CHA.png'),
  // CHI: require('../assets/intro/nba/CHI.png'),
  // CLE: require('../assets/intro/nba/CLE.png'),
  // DAL: require('../assets/intro/nba/DAL.png'),
  // DEN: require('../assets/intro/nba/DEN.png'),
  // DET: require('../assets/intro/nba/DET.png'),
  // GSW: require('../assets/intro/nba/GSW.png'),
  // HOU: require('../assets/intro/nba/HOU.png'),
  // IND: require('../assets/intro/nba/IND.png'),
  // LAC: require('../assets/intro/nba/LAC.png'),
  // LAL: require('../assets/intro/nba/LAL.png'),
  // MEM: require('../assets/intro/nba/MEM.png'),
  // MIA: require('../assets/intro/nba/MIA.png'),
  // MIL: require('../assets/intro/nba/MIL.png'),
  // MIN: require('../assets/intro/nba/MIN.png'),
  // NOP: require('../assets/intro/nba/NOP.png'),
  // NYK: require('../assets/intro/nba/NYK.png'),
  // OKC: require('../assets/intro/nba/OKC.png'),
  // ORL: require('../assets/intro/nba/ORL.png'),
  // PHI: require('../assets/intro/nba/PHI.png'),
  // PHX: require('../assets/intro/nba/PHX.png'),
  // POR: require('../assets/intro/nba/POR.png'),
  // SAC: require('../assets/intro/nba/SAC.png'),
  // SAS: require('../assets/intro/nba/SAS.png'),
  // TOR: require('../assets/intro/nba/TOR.png'),
  // UTA: require('../assets/intro/nba/UTA.png'),
  // WAS: require('../assets/intro/nba/WAS.png'),
};

export const introRemoteAssetBase = (() => {
  try {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
    return env?.EXPO_PUBLIC_INTRO_ASSET_BASE ?? '';
  } catch {
    return '';
  }
})();
