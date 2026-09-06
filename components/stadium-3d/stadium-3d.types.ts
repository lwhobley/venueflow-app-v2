import type { StadiumZoneItem } from '../StadiumUnitDetailModal';
import type { StadiumZoneData } from '../stadium-map/zone-data';

export type Stadium3DRenderStatus = 'idle' | 'loading' | 'ready' | 'error' | 'fallback';

export type CameraPresetId = 'overview' | 'exterior' | 'field' | 'premium' | 'concourse';

export interface CameraPreset {
  id: CameraPresetId;
  label: string;
  icon: string;
  description: string;
  position: [number, number, number];
  target: [number, number, number];
}

export type OperationalHighlightStatus =
  | 'normal'
  | 'ready'
  | 'watch'
  | 'attention'
  | 'critical'
  | 'selected';

export interface StadiumZoneModelBinding {
  zoneId: string;
  name: string;
  level: string;
  category: string;
  meshNames: string[];
  /**
   * Name prefixes matched against mesh names, for the repeated families the
   * asset generates (yard lines, turf bands, endzone letters, goal posts).
   * Listing every member by hand goes stale the moment the model is re-exported.
   */
  meshPrefixes?: string[];
  anchor: [number, number, number];
  cameraPreset: CameraPresetId;
  colorHex?: string;
}

export interface ZoneHighlightState {
  zoneId: string;
  status: OperationalHighlightStatus;
  alertCount: number;
  openUnitsCount: number;
  totalUnitsCount: number;
  emissiveColor: string;
  emissiveIntensity: number;
}

export interface ProjectedZoneMarker {
  zoneId: string;
  name: string;
  code: string;
  status: OperationalHighlightStatus;
  alertCount: number;
  screenX: number;
  screenY: number;
  visible: boolean;
  distanceToCamera: number;
}

export interface Stadium3DCanvasProps {
  selectedZoneId: string | null;
  highlightedZones: Record<string, OperationalHighlightStatus>;
  cameraPreset: CameraPresetId;
  autoRotate: boolean;
  resetToken?: number;
  active?: boolean;
  reducedMotion?: boolean;
  onSelectZone: (zoneId: string) => void;
  onLoadProgress?: (progressPercent: number) => void;
  onLoadComplete?: (fallback?: boolean) => void;
  onLoadError?: (errorMessage: string) => void;
  dom?: import('expo/dom').DOMProps;
}

export interface Stadium3DViewerProps {
  zones: StadiumZoneData[];
  selectedZoneId: string | null;
  selectedUnitId: string | null;
  onSelectZone: (zoneId: string) => void;
  onSelectUnit: (unit: StadiumZoneItem) => void;
  onOpenOperationsMap: () => void;
  initialPreset?: CameraPresetId;
}
