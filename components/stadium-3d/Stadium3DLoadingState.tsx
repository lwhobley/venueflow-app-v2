import { ActivityIndicator, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { styles } from './Stadium3DViewer.styles';

interface Stadium3DLoadingStateProps {
  progress?: number;
  message?: string;
}

export function Stadium3DLoadingState({
  progress,
  message = 'Loading interactive stadium view…',
}: Stadium3DLoadingStateProps) {
  const hasValidProgress = typeof progress === 'number' && progress > 0 && progress <= 100;

  return (
    <View
      style={styles.loadingContainer}
      accessibilityRole="progressbar"
      accessibilityLabel={`Loading 3D stadium model${hasValidProgress ? `, ${Math.round(progress)}% complete` : ''}`}
    >
      <View style={styles.loadingSpinnerRing}>
        <ActivityIndicator size="small" color="#00E5FF" />
      </View>

      <View style={{ alignItems: 'center', gap: 4 }}>
        <Text style={styles.loadingTitle}>{message}</Text>
        <Text style={styles.loadingSub}>
          Initializing spatial stadium digital twin, lighting and operational zones
        </Text>
      </View>

      {hasValidProgress ? (
        <View style={styles.loadingProgressBarTrack}>
          <View style={[styles.loadingProgressBarFill, { width: `${progress}%` }]} />
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
        <MaterialCommunityIcons name="cube-scan" size={14} color="#00E5FF" />
        <Text style={{ fontSize: 10, color: '#78909C', fontWeight: '700', letterSpacing: 0.5 }}>
          ENTERPRISE 3D DIGITAL TWIN · NRG STADIUM
        </Text>
      </View>
    </View>
  );
}
