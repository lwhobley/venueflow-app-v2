import { Pressable, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { styles } from './Stadium3DViewer.styles';

interface Stadium3DErrorStateProps {
  errorMessage?: string;
  onRetry: () => void;
  onOpenOperationsMap: () => void;
}

export function Stadium3DErrorState({
  errorMessage,
  onRetry,
  onOpenOperationsMap,
}: Stadium3DErrorStateProps) {
  return (
    <View
      style={styles.errorContainer}
      accessibilityRole="alert"
      accessibilityLabel="Interactive 3D stadium view could not be loaded."
    >
      <View style={styles.errorIconBox}>
        <MaterialCommunityIcons name="alert-circle-outline" size={28} color="#FF5252" />
      </View>

      <View style={{ alignItems: 'center', gap: 4 }}>
        <Text style={styles.errorTitle}>3D Stadium View Unavailable</Text>
        <Text style={styles.errorMessage}>
          {errorMessage ||
            'The spatial 3D renderer encountered an issue loading stadium assets. You can try again or switch to the 2D Operations Map to access all suite and stand workflows.'}
        </Text>
      </View>

      <View style={styles.errorActionsRow}>
        <Pressable
          onPress={onRetry}
          style={({ pressed }) => [styles.errorRetryBtn, { opacity: pressed ? 0.75 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="Retry loading 3D stadium view"
        >
          <MaterialCommunityIcons name="reload" size={16} color="#00E5FF" />
          <Text style={styles.errorRetryText}>Try Again</Text>
        </Pressable>

        <Pressable
          onPress={onOpenOperationsMap}
          style={({ pressed }) => [styles.errorFallbackBtn, { opacity: pressed ? 0.75 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="Open Operations Map"
        >
          <MaterialCommunityIcons name="floor-plan" size={16} color="#FFFFFF" />
          <Text style={styles.errorFallbackText}>Open Operations Map</Text>
        </Pressable>
      </View>
    </View>
  );
}
