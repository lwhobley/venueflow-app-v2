import { Pressable, ScrollView, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  CAMERA_PRESETS,
  HIGHLIGHT_STATUS_LABELS,
  LEGEND_STATUSES,
  getHighlightColor,
} from './stadium-model-bindings';
import type { CameraPresetId } from './stadium-3d.types';
import { styles } from './Stadium3DViewer.styles';

interface Stadium3DControlsProps {
  currentPreset: CameraPresetId;
  onSelectPreset: (presetId: CameraPresetId) => void;
  onResetCamera: () => void;
  autoRotate: boolean;
  onToggleAutoRotate: () => void;
  showLegend?: boolean;
}

export function Stadium3DControls({
  currentPreset,
  onSelectPreset,
  onResetCamera,
  autoRotate,
  onToggleAutoRotate,
  showLegend = true,
}: Stadium3DControlsProps) {
  const presetList = Object.values(CAMERA_PRESETS);

  return (
    <>
      {/* Top Header Bar */}
      <View style={styles.topControlsBar} pointerEvents="box-none">
        <View style={styles.headerPill}>
          <View style={styles.headerLiveDot} />
          <Text style={styles.headerPillText}>3D STADIUM TWIN</Text>
        </View>

        <View style={styles.topActionsGroup}>
          {/* Auto-Rotate Toggle */}
          <Pressable
            onPress={onToggleAutoRotate}
            style={({ pressed }) => [
              styles.iconActionBtn,
              autoRotate && styles.iconActionBtnActive,
              { opacity: pressed ? 0.75 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={autoRotate ? 'Disable 3D stadium auto-rotation' : 'Enable 3D stadium auto-rotation'}
            accessibilityState={{ selected: autoRotate }}
          >
            <MaterialCommunityIcons
              name={autoRotate ? 'axis-z-rotate-clockwise' : 'axis-z-rotate-counterclockwise'}
              size={18}
              color={autoRotate ? '#00E5FF' : '#90A4AE'}
            />
          </Pressable>

          {/* Reset Camera View Button */}
          <Pressable
            onPress={onResetCamera}
            style={({ pressed }) => [styles.iconActionBtn, { opacity: pressed ? 0.75 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Reset stadium camera to overview"
          >
            <MaterialCommunityIcons name="camera-retake-outline" size={18} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>

      {/* Preset Camera Angles Bar */}
      <View style={styles.presetsBar} pointerEvents="box-none">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.presetsScrollContent}
        >
          {presetList.map((preset) => {
            const isActive = currentPreset === preset.id;
            return (
              <Pressable
                key={preset.id}
                onPress={() => onSelectPreset(preset.id)}
                style={({ pressed }) => [
                  styles.presetPill,
                  isActive && styles.presetPillActive,
                  { opacity: pressed ? 0.8 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Camera angle: ${preset.label}. ${preset.description}`}
                accessibilityState={{ selected: isActive }}
              >
                <MaterialCommunityIcons
                  name={preset.icon as any}
                  size={14}
                  color={isActive ? '#001E3D' : '#90A4AE'}
                />
                <Text style={[styles.presetPillText, isActive && styles.presetPillTextActive]}>
                  {preset.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Compact Operational Status Legend */}
      {showLegend ? (
        <View style={styles.legendBar} pointerEvents="none">
          {/* Swatches come from the same table that lights the model, so the key
              cannot drift away from the colours actually on screen. */}
          {LEGEND_STATUSES.map((status) => (
            <View key={status} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: getHighlightColor(status).colorHex }]} />
              <Text style={styles.legendText}>{HIGHLIGHT_STATUS_LABELS[status]}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </>
  );
}
