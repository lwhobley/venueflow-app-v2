import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Image,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  introRemoteAssetBase,
  nbaJerseyImages,
  nflHelmetImages,
} from '../lib/intro-logo-map';
import { VENUE_WRANGLER_ENTERPRISE_LOGO_SOURCE } from '../lib/enterprise-logo-data';

/**
 * Cold-start brand intro:
 * - Black field
 * - Left: 32 NFL clubs (helmet) / Right: 30 NBA clubs (jersey)
 * - ≤180ms per flash
 * - Lasso pulls Venue Wrangler Enterprise logo, then fades into Home
 */

const FLASH_MS = 180;
const LASSO_MS = 1400;
const LOGO_HOLD_MS = 1100;
const LOGO_FADE_MS = 700;

const NFL_CLUBS: { code: string; color: string; accent: string }[] = [
  { code: 'ARI', color: '#97233F', accent: '#000000' },
  { code: 'ATL', color: '#A71930', accent: '#000000' },
  { code: 'BAL', color: '#241773', accent: '#000000' },
  { code: 'BUF', color: '#00338D', accent: '#C60C30' },
  { code: 'CAR', color: '#0085CA', accent: '#000000' },
  { code: 'CHI', color: '#0B162A', accent: '#C83803' },
  { code: 'CIN', color: '#FB4F14', accent: '#000000' },
  { code: 'CLE', color: '#311D00', accent: '#FF3C00' },
  { code: 'DAL', color: '#003594', accent: '#869397' },
  { code: 'DEN', color: '#FB4F14', accent: '#002244' },
  { code: 'DET', color: '#0076B6', accent: '#B0B7BC' },
  { code: 'GB', color: '#203731', accent: '#FFB612' },
  { code: 'HOU', color: '#03202F', accent: '#A71930' },
  { code: 'IND', color: '#002C5F', accent: '#A2AAAD' },
  { code: 'JAX', color: '#006778', accent: '#D7A22A' },
  { code: 'KC', color: '#E31837', accent: '#FFB81C' },
  { code: 'LV', color: '#000000', accent: '#A5ACAF' },
  { code: 'LAC', color: '#0080C6', accent: '#FFC20E' },
  { code: 'LAR', color: '#003594', accent: '#FFA300' },
  { code: 'MIA', color: '#008E97', accent: '#FC4C02' },
  { code: 'MIN', color: '#4F2683', accent: '#FFC62F' },
  { code: 'NE', color: '#002244', accent: '#C60C30' },
  { code: 'NO', color: '#D3BC8D', accent: '#000000' },
  { code: 'NYG', color: '#0B2265', accent: '#A71930' },
  { code: 'NYJ', color: '#125740', accent: '#000000' },
  { code: 'PHI', color: '#004C54', accent: '#A5ACAF' },
  { code: 'PIT', color: '#000000', accent: '#FFB612' },
  { code: 'SF', color: '#AA0000', accent: '#B3995D' },
  { code: 'SEA', color: '#002244', accent: '#69BE28' },
  { code: 'TB', color: '#D50A0A', accent: '#FF7900' },
  { code: 'TEN', color: '#0C2340', accent: '#4B92DB' },
  { code: 'WAS', color: '#5A1414', accent: '#FFB612' },
];

const NBA_CLUBS: { code: string; color: string; accent: string }[] = [
  { code: 'ATL', color: '#E03A3E', accent: '#C1D32F' },
  { code: 'BOS', color: '#007A33', accent: '#BA9653' },
  { code: 'BKN', color: '#000000', accent: '#FFFFFF' },
  { code: 'CHA', color: '#1D1160', accent: '#00788C' },
  { code: 'CHI', color: '#CE1141', accent: '#000000' },
  { code: 'CLE', color: '#860038', accent: '#FDBB30' },
  { code: 'DAL', color: '#00538C', accent: '#002B5E' },
  { code: 'DEN', color: '#0E2240', accent: '#FEC524' },
  { code: 'DET', color: '#C8102E', accent: '#1D42BA' },
  { code: 'GSW', color: '#1D428A', accent: '#FFC72C' },
  { code: 'HOU', color: '#CE1141', accent: '#000000' },
  { code: 'IND', color: '#002D62', accent: '#FDBB30' },
  { code: 'LAC', color: '#C8102E', accent: '#1D42BA' },
  { code: 'LAL', color: '#552583', accent: '#FDB927' },
  { code: 'MEM', color: '#5D76A9', accent: '#12173F' },
  { code: 'MIA', color: '#98002E', accent: '#F9A01B' },
  { code: 'MIL', color: '#00471B', accent: '#EEE1C6' },
  { code: 'MIN', color: '#0C2340', accent: '#236192' },
  { code: 'NOP', color: '#0C2340', accent: '#C8102E' },
  { code: 'NYK', color: '#006BB6', accent: '#F58426' },
  { code: 'OKC', color: '#007AC1', accent: '#EF3B24' },
  { code: 'ORL', color: '#0077C0', accent: '#C4CED4' },
  { code: 'PHI', color: '#006BB6', accent: '#ED174C' },
  { code: 'PHX', color: '#1D1160', accent: '#E56020' },
  { code: 'POR', color: '#E03A3E', accent: '#000000' },
  { code: 'SAC', color: '#5A2D81', accent: '#63727A' },
  { code: 'SAS', color: '#C4CED4', accent: '#000000' },
  { code: 'TOR', color: '#CE1141', accent: '#000000' },
  { code: 'UTA', color: '#002B5C', accent: '#00471B' },
  { code: 'WAS', color: '#002B5C', accent: '#E31837' },
];

function resolveArt(league: 'nfl' | 'nba', code: string) {
  const local = league === 'nfl' ? nflHelmetImages[code] : nbaJerseyImages[code];
  if (local) return { local };
  if (introRemoteAssetBase) {
    const base = introRemoteAssetBase.replace(/\/$/, '');
    return { remote: `${base}/${league}/${code}.png` };
  }
  return {};
}

function HelmetCard({ code, color, accent }: { code: string; color: string; accent: string }) {
  const art = resolveArt('nfl', code);
  return (
    <View style={[styles.card, { backgroundColor: color, borderColor: accent }]}>
      {art.local || art.remote ? (
        <Image source={art.local ?? { uri: art.remote }} style={styles.officialArt} resizeMode="contain" accessibilityLabel={`${code} helmet`} />
      ) : (
        <View style={[styles.helmetShell, { backgroundColor: accent === '#000000' ? '#FFFFFF' : accent }]}>
          <View style={[styles.helmetFacemask, { borderColor: color }]} />
        </View>
      )}
      <Text style={[styles.cardCode, { color: accent === '#000000' || accent === '#FFFFFF' ? '#FFFFFF' : accent }]}>{code}</Text>
      <Text style={styles.cardKind}>HELMET</Text>
    </View>
  );
}

function JerseyCard({ code, color, accent }: { code: string; color: string; accent: string }) {
  const art = resolveArt('nba', code);
  return (
    <View style={[styles.card, { backgroundColor: color, borderColor: accent }]}>
      {art.local || art.remote ? (
        <Image source={art.local ?? { uri: art.remote }} style={styles.officialArt} resizeMode="contain" accessibilityLabel={`${code} jersey`} />
      ) : (
        <View style={[styles.jerseyBody, { backgroundColor: accent === '#FFFFFF' ? '#111111' : accent }]}>
          <View style={[styles.jerseySleeve, styles.jerseySleeveL, { backgroundColor: color }]} />
          <View style={[styles.jerseySleeve, styles.jerseySleeveR, { backgroundColor: color }]} />
          <View style={styles.jerseyNumberBar} />
        </View>
      )}
      <Text style={[styles.cardCode, { color: '#FFFFFF' }]}>{code}</Text>
      <Text style={styles.cardKind}>JERSEY</Text>
    </View>
  );
}

type Phase = 'flash' | 'lasso' | 'done';

export function SportsBrandIntro({ onComplete }: { onComplete: () => void }) {
  const { width, height } = Dimensions.get('window');
  const [phase, setPhase] = useState<Phase>('flash');
  const [nflIndex, setNflIndex] = useState(0);
  const [nbaIndex, setNbaIndex] = useState(0);

  const flashOpacity = useRef(new Animated.Value(1)).current;
  const lassoX = useRef(new Animated.Value(-width * 0.2)).current;
  const lassoY = useRef(new Animated.Value(height * 0.35)).current;
  const lassoScale = useRef(new Animated.Value(0.4)).current;
  const lassoOpacity = useRef(new Animated.Value(0)).current;
  const logoX = useRef(new Animated.Value(width * 0.15)).current;
  const logoY = useRef(new Animated.Value(height * 0.55)).current;
  const logoScale = useRef(new Animated.Value(0.55)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const vignette = useRef(new Animated.Value(0)).current;
  const overlayOpacity = useRef(new Animated.Value(1)).current;

  const maxFlashSteps = useMemo(() => Math.max(NFL_CLUBS.length, NBA_CLUBS.length), []);

  useEffect(() => {
    let step = 0;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (cancelled) return;
      flashOpacity.setValue(0.35);
      Animated.timing(flashOpacity, { toValue: 1, duration: Math.min(90, FLASH_MS * 0.45), useNativeDriver: true }).start();
      setNflIndex(step % NFL_CLUBS.length);
      setNbaIndex(step % NBA_CLUBS.length);
      step += 1;
      if (step >= maxFlashSteps) {
        setPhase('lasso');
        return;
      }
      timer = setTimeout(tick, FLASH_MS);
    };
    timer = setTimeout(tick, 40);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [flashOpacity, maxFlashSteps]);

  useEffect(() => {
    if (phase !== 'lasso') return;
    logoOpacity.setValue(0.85);
    lassoOpacity.setValue(1);
    Animated.sequence([
      Animated.parallel([
        Animated.timing(lassoX, { toValue: width * 0.12, duration: LASSO_MS * 0.55, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(lassoY, { toValue: height * 0.48, duration: LASSO_MS * 0.55, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(lassoScale, { toValue: 1.15, duration: LASSO_MS * 0.55, useNativeDriver: true }),
        Animated.timing(logoOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(logoX, { toValue: width / 2 - 130, duration: LASSO_MS * 0.45, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(logoY, { toValue: height / 2 - 130, duration: LASSO_MS * 0.45, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(logoScale, { toValue: 1, duration: LASSO_MS * 0.45, useNativeDriver: true }),
        Animated.timing(lassoX, { toValue: -width * 0.35, duration: LASSO_MS * 0.45, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
        Animated.timing(vignette, { toValue: 1, duration: LASSO_MS * 0.45, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(lassoOpacity, { toValue: 0, duration: 280, useNativeDriver: true }),
        Animated.timing(vignette, { toValue: 0, duration: 280, useNativeDriver: true }),
      ]),
      Animated.delay(LOGO_HOLD_MS),
      // Fade black + logo so Home is revealed underneath
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: LOGO_FADE_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        setPhase('done');
        onComplete();
      }
    });
  }, [phase, height, width, lassoX, lassoY, lassoScale, lassoOpacity, logoX, logoY, logoScale, logoOpacity, vignette, overlayOpacity, onComplete]);

  if (phase === 'done') return null;

  const nfl = NFL_CLUBS[nflIndex];
  const nba = NBA_CLUBS[nbaIndex];

  return (
    <Animated.View style={[styles.root, { opacity: overlayOpacity }]} pointerEvents="none">
      <View style={styles.black} />
      {phase === 'flash' ? (
        <Animated.View style={[styles.flashRow, { opacity: flashOpacity }]}>
          <View style={styles.column}>
            <Text style={styles.columnLabel}>GRIDIRON</Text>
            <HelmetCard code={nfl.code} color={nfl.color} accent={nfl.accent} />
          </View>
          <View style={styles.centerRule} />
          <View style={styles.column}>
            <Text style={styles.columnLabel}>HARDWOOD</Text>
            <JerseyCard code={nba.code} color={nba.color} accent={nba.accent} />
          </View>
        </Animated.View>
      ) : null}
      {phase === 'lasso' ? (
        <>
          <Animated.View
            style={[
              styles.lasso,
              {
                opacity: lassoOpacity,
                transform: [
                  { translateX: lassoX },
                  { translateY: lassoY },
                  { scale: lassoScale },
                  { rotate: lassoX.interpolate({ inputRange: [-width, width], outputRange: ['-25deg', '35deg'] }) },
                ],
              },
            ]}
          >
            <View style={styles.lassoLoop} />
            <View style={styles.lassoRope} />
          </Animated.View>
          <Animated.View
            style={[
              styles.logoWrap,
              {
                opacity: logoOpacity,
                transform: [{ translateX: logoX }, { translateY: logoY }, { scale: logoScale }],
              },
            ]}
          >
            <Image
              source={VENUE_WRANGLER_ENTERPRISE_LOGO_SOURCE}
              style={styles.logo}
              resizeMode="contain"
              accessibilityLabel="Venue Wrangler Enterprise"
            />
          </Animated.View>
          <Animated.View pointerEvents="none" style={[styles.vignette, { opacity: vignette.interpolate({ inputRange: [0, 1], outputRange: [0, 0.55] }) }]} />
        </>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, zIndex: 9999, elevation: 9999 },
  black: { ...StyleSheet.absoluteFill, backgroundColor: '#000000' },
  flashRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', paddingHorizontal: 12 },
  column: { alignItems: 'center', gap: 14 },
  columnLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: '800', letterSpacing: 3 },
  centerRule: { width: StyleSheet.hairlineWidth, height: '42%', backgroundColor: 'rgba(255,255,255,0.18)' },
  card: { width: 150, height: 190, borderRadius: 18, borderWidth: 3, alignItems: 'center', justifyContent: 'center', gap: 10, overflow: 'hidden' },
  officialArt: { width: 96, height: 96 },
  cardCode: { fontSize: 28, fontWeight: '900', letterSpacing: 1 },
  cardKind: { color: 'rgba(255,255,255,0.55)', fontSize: 10, fontWeight: '700', letterSpacing: 2 },
  helmetShell: { width: 72, height: 58, borderRadius: 36, borderBottomLeftRadius: 20, borderBottomRightRadius: 20, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 6 },
  helmetFacemask: { width: 48, height: 16, borderWidth: 3, borderTopWidth: 0, borderRadius: 4 },
  jerseyBody: { width: 64, height: 70, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  jerseySleeve: { position: 'absolute', top: 8, width: 22, height: 18, borderRadius: 4 },
  jerseySleeveL: { left: -14 },
  jerseySleeveR: { right: -14 },
  jerseyNumberBar: { width: 28, height: 34, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.25)' },
  lasso: { position: 'absolute', width: 160, height: 160, alignItems: 'center', justifyContent: 'center' },
  lassoLoop: { width: 120, height: 120, borderRadius: 60, borderWidth: 5, borderColor: '#C4A574', shadowColor: '#C4A574', shadowOpacity: 0.5, shadowRadius: 8 },
  lassoRope: { position: 'absolute', right: -40, width: 90, height: 5, borderRadius: 3, backgroundColor: '#A67C52', transform: [{ rotate: '12deg' }] },
  logoWrap: { position: 'absolute', width: 280, alignItems: 'center' },
  logo: { width: 260, height: 260, borderRadius: 28 },
  vignette: { ...StyleSheet.absoluteFill, backgroundColor: '#000000' },
});
