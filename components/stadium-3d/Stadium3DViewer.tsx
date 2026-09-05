import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, AppState, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useFocusEffect } from 'expo-router';
import Stadium3DCanvas from './Stadium3DCanvas';
import { Stadium3DControls } from './Stadium3DControls';
import { Stadium3DErrorState } from './Stadium3DErrorState';
import { Stadium3DLoadingState } from './Stadium3DLoadingState';
import { StadiumZoneOverlay } from './StadiumZoneOverlay';
import {
  buildZoneHighlightStates,
  findZoneBinding,
} from './stadium-model-bindings';
import type {
  CameraPresetId,
  OperationalHighlightStatus,
  Stadium3DRenderStatus,
  Stadium3DViewerProps,
} from './stadium-3d.types';
import { styles } from './Stadium3DViewer.styles';

class Local3DErrorBoundary extends React.Component<
  { children: React.ReactNode; onError: (error: Error) => void },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; onError: (error: Error) => void }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

export function Stadium3DViewer({
  zones,
  selectedZoneId,
  selectedUnitId,
  onSelectZone,
  onSelectUnit,
  onOpenOperationsMap,
  initialPreset = 'overview',
}: Stadium3DViewerProps) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isMobile = windowWidth < 768;

  // Viewport height calculation (responsive, thumb-friendly)
  const viewerHeight = isMobile ? Math.max(280, Math.min(480, windowHeight * 0.6)) : 560;
  const [resetToken, setResetToken] = useState(0);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [focused, setFocused] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(true);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (mounted) setReducedMotion(value); }).catch(() => undefined);
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    const app = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => { mounted = false; motion.remove(); app.remove(); };
  }, []);

  // Renderer and state machine
  const [renderStatus, setRenderStatus] = useState<Stadium3DRenderStatus>('loading');
  const [loadProgress, setLoadProgress] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [retryCount, setRetryCount] = useState<number>(0);
  useEffect(() => {
    if (renderStatus !== 'loading' || !foreground || !focused) return;
    const timeout = setTimeout(() => {
      setErrorMessage('The 3D view did not start. Retry or use the Operations Map.');
      setRenderStatus('error');
    }, 15000);
    return () => clearTimeout(timeout);
  }, [renderStatus, retryCount, foreground, focused]);

  // Controls state
  const [cameraPreset, setCameraPreset] = useState<CameraPresetId>(initialPreset);
  const [autoRotate, setAutoRotate] = useState<boolean>(false);

  // Selected Zone object
  const activeZone = useMemo(() => {
    if (!selectedZoneId) return null;
    return zones.find((z) => z.id === selectedZoneId) ?? null;
  }, [selectedZoneId, zones]);

  // Highlight states map for all zones
  const highlightStates = useMemo(() => {
    return buildZoneHighlightStates(zones, selectedZoneId);
  }, [zones, selectedZoneId]);

  // Simplified highlight lookup for canvas
  const highlightedZonesSimple = useMemo(() => {
    const map: Record<string, OperationalHighlightStatus> = {};
    for (const [zId, state] of Object.entries(highlightStates)) {
      map[zId] = state.status;
    }
    return map;
  }, [highlightStates]);

  // Camera preset handler
  const handleSelectPreset = useCallback((presetId: CameraPresetId) => {
    setCameraPreset(presetId);
  }, []);

  const handleResetCamera = useCallback(() => {
    setCameraPreset('overview');
    setResetToken((value) => value + 1);
  }, []);

  const handleToggleAutoRotate = useCallback(() => {
    setAutoRotate((prev) => !prev);
  }, []);

  // Zone selection handler
  const handleSelectZone = useCallback(
    (zoneId: string) => {
      onSelectZone(zoneId);
      const binding = findZoneBinding(zoneId);
      if (binding && binding.cameraPreset !== cameraPreset) {
        setCameraPreset(binding.cameraPreset);
      }
    },
    [onSelectZone, cameraPreset]
  );

  // Open Details action (opens the modal with the selected unit, or first unit in zone)
  const handleOpenDetails = useCallback(() => {
    if (!activeZone || activeZone.units.length === 0) return;

    // Prefer selected unit if it belongs to this zone, otherwise pick the first unit
    const unitToOpen =
      activeZone.units.find((u) => u.id === selectedUnitId) ?? activeZone.units[0];

    onSelectUnit(unitToOpen);
  }, [activeZone, selectedUnitId, onSelectUnit]);

  // Retry handler
  const handleRetry = useCallback(() => {
    setRenderStatus('loading');
    setLoadProgress(0);
    setErrorMessage('');
    setRetryCount((c) => c + 1);
  }, []);

  // Error boundary handler
  const handleLocalError = useCallback((error: Error) => {
    setErrorMessage(error.message || 'The 3D stadium viewer encountered an unexpected error.');
    setRenderStatus('error');
  }, []);

  return (
    <View style={styles.container}>
      <Pressable onPress={onOpenOperationsMap} accessibilityRole="button" accessibilityLabel="Open Operations Map" style={{ padding: 12, minHeight: 44 }}>
        <Text style={{ color: '#FFFFFF' }}>{renderStatus === 'fallback' ? 'Simplified 3D — some sections are unavailable. Open Operations Map' : 'Open Operations Map'}</Text>
      </Pressable>
      <View style={[styles.canvasWrapper, { height: viewerHeight }]}>
        {/* Loading State Overlay */}
        {renderStatus === 'loading' ? (
          <Stadium3DLoadingState progress={loadProgress} />
        ) : null}

        {/* Error State Overlay */}
        {renderStatus === 'error' ? (
          <Stadium3DErrorState
            errorMessage={errorMessage}
            onRetry={handleRetry}
            onOpenOperationsMap={onOpenOperationsMap}
          />
        ) : null}

        {/* Three.js 3D WebGL Canvas */}
        {renderStatus !== 'error' ? (
          <Local3DErrorBoundary onError={handleLocalError}>
            <Stadium3DCanvas
              key={`canvas-${retryCount}`}
              selectedZoneId={selectedZoneId}
              highlightedZones={highlightedZonesSimple}
              cameraPreset={cameraPreset}
              autoRotate={autoRotate}
              resetToken={resetToken}
              active={foreground && focused}
              reducedMotion={reducedMotion}
              onSelectZone={handleSelectZone}
              onLoadProgress={(p) => setLoadProgress(p)}
              onLoadComplete={(fallback) => setRenderStatus(fallback ? 'fallback' : 'ready')}
              onLoadError={(err) => {
                setErrorMessage(err);
                setRenderStatus('error');
              }}
              dom={{
                scrollEnabled: false,
                contentInsetAdjustmentBehavior: 'never',
                style: { width: '100%', height: '100%' },
                onError: () => handleLocalError(new Error('The stadium WebView could not load.')),
                onContentProcessDidTerminate: () => handleLocalError(new Error('The stadium renderer stopped. Retry or open the Operations Map.')),
                onRenderProcessGone: () => handleLocalError(new Error('The stadium renderer stopped. Retry or open the Operations Map.')),
              }}
            />
          </Local3DErrorBoundary>
        ) : null}

        {/* Interactive Controls Overlay */}
        {renderStatus === 'ready' || renderStatus === 'fallback' ? (
          <>
            <Stadium3DControls
              currentPreset={cameraPreset}
              onSelectPreset={handleSelectPreset}
              onResetCamera={handleResetCamera}
              autoRotate={autoRotate}
              onToggleAutoRotate={handleToggleAutoRotate}
              showLegend={!activeZone}
            />

            {/* Selected Zone Card Overlay */}
            {activeZone ? (
              <StadiumZoneOverlay
                zone={activeZone}
                highlightStatus={highlightStates[activeZone.id]?.status ?? 'selected'}
                onOpenDetails={handleOpenDetails}
                onClose={() => onSelectZone('')}
              />
            ) : null}
          </>
        ) : null}
      </View>
    </View>
  );
}
