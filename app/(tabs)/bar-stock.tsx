import { useCallback, useMemo, useState } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Button, Card, Chip, Dialog, Portal, Text, TextInput } from 'react-native-paper';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useAction, useMutation, useQuery } from '../../lib/railway-hooks';
import { api } from '../../lib/railway-api';
import type { Id } from '../../lib/ids';
import { accents, colors, radius, spacing } from '../../lib/theme';
import { useVenueAuth } from '../../lib/useVenueAuth';
import { asArray, errorMessage } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { ManagerGate } from '../../components/ManagerGate';
import {
  money,
  WASTE_REASON_LABELS,
  type WasteReason,
  type VelocityRow,
  type ShrinkageData,
  type PurchaseOrderData,
  type CostHistoryEntry,
  type AgingReport,
  type LocationStockSummary,
} from '../../lib/bar-inventory-types';
import {
  VelocityCard,
  ShrinkageCard,
  PurchaseOrderCard,
  AgingCard,
  MovementTimeline,
  LocationBreakdownCard,
  EventStockoutRiskCard,
} from '../../components/bar-stock/InventoryCards';
import { InlineMessage } from '../../components/InlineMessage';
import { SectionHeader } from '../../components/AppCard';
import { readPickedFileText } from '../../lib/picked-file';
import { useResponsive } from '../../lib/responsive';
import {
  INVENTORY_RENDER_BATCH_SIZE,
  inventoryRowsForWindow,
  nextInventoryWindow,
} from '../../lib/inventory-window';

const beverageCategories = ['spirit', 'wine', 'beer', 'mixer', 'garnish'] as const;
const foodCategories = ['protein', 'produce', 'dairy', 'dry_goods', 'bakery', 'frozen'] as const;
const categories = [...beverageCategories, ...foodCategories, 'supply', 'other'] as const;
type Category = (typeof categories)[number];

type BarItem = {
  _id: Id<'barInventoryItems'>;
  name: string;
  category: Category;
  area: string | null;
  unit: string;
  parLevel: number;
  onHand: number;
  unitCostCents: number | null;
  supplier: string | null;
  notes: string | null;
  sku: string | null;
};

type BarStock = {
  items: BarItem[];
  lowStockCount: number;
  totalValueCents: number;
  locationSummaries?: LocationStockSummary[];
  activeMultiplier?: number;
};

type ParsedItem = Omit<BarItem, '_id' | 'area' | 'unitCostCents' | 'supplier' | 'notes' | 'sku'> & {
  area?: string;
  unitCostCents?: number;
  supplier?: string;
  notes?: string;
  sku?: string;
};

type MovementType = 'count' | 'received' | 'waste' | 'comp' | 'transfer';
type PrepBoardKind = 'prep' | 'eighty_six';
type PrepBoardStatus = 'open' | 'done' | 'cancelled';

type PrepBoardItem = {
  _id: string;
  kind: PrepBoardKind;
  title: string;
  quantity: number | null;
  unit: string | null;
  station: string | null;
  notes: string | null;
  dueDate: string | null;
  status: PrepBoardStatus;
};

type PrepBoard = {
  items: PrepBoardItem[];
  openCount: number;
  eightySixCount: number;
  prepCount: number;
};

const addItemRow = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm };
const addItemWideField = { flexGrow: 1, flexShrink: 1, flexBasis: 140, minWidth: 136, backgroundColor: colors.surface };
const addItemNumberField = { flexGrow: 1, flexShrink: 1, flexBasis: 120, minWidth: 112, backgroundColor: colors.surface };

export default function BarStockScreen() {
  const { t } = useI18n();
  const { venue, isReady, canManage, profileLoading } = useVenueAuth();
  const { isPhone } = useResponsive();

  // Multi-location & Event Par state
  const [activeLocation, setActiveLocation] = useState<string>('all');
  const [eventParMultiplier, setEventParMultiplier] = useState<number>(1.0);
  const [searchQuery, setSearchQuery] = useState('');
  const [stockStatusFilter, setStockStatusFilter] = useState<'all' | 'below_par' | 'critical' | 'surplus'>('all');
  const [showLocationBreakdown, setShowLocationBreakdown] = useState(false);

  // Transfer modal state
  const [transferItem, setTransferItem] = useState<BarItem | null>(null);
  const [transferQty, setTransferQty] = useState('1');
  const [transferFromArea, setTransferFromArea] = useState('Main Warehouse');
  const [transferToArea, setTransferToArea] = useState('');
  const [transferNotes, setTransferNotes] = useState('');

  // Waste modal state
  const [wasteItem, setWasteItem] = useState<BarItem | null>(null);
  const [wasteQty, setWasteQty] = useState('1');
  const [wasteReason, setWasteReason] = useState<WasteReason>('draft_flush');
  const [wasteNotes, setWasteNotes] = useState('');

  // Rapid zone count state
  const [batchCountMode, setBatchCountMode] = useState(false);
  const [batchCountArea, setBatchCountArea] = useState('all');
  const [batchCounts, setBatchCounts] = useState<Record<string, number>>({});

  // Queries
  const stock = useQuery(
    api.barInventory.getBarStock,
    isReady && venue?.id
      ? {
          venueId: venue.id,
          area: activeLocation !== 'all' ? activeLocation : undefined,
          multiplier: eventParMultiplier,
        }
      : 'skip',
  ) as BarStock | null | undefined;

  const velocity = useQuery(
    api.barInventory.getUsageVelocity,
    isReady && canManage && venue?.id ? { venueId: venue.id } : 'skip',
  ) as VelocityRow[] | null | undefined;

  const prepBoard = useQuery(
    api.barInventory.listPrepBoard,
    isReady && canManage && venue?.id ? { venueId: venue.id } : 'skip',
  ) as PrepBoard | null | undefined;

  // Mutations
  const upsertBarItem = useMutation(api.barInventory.upsertBarItem);
  const recordMovement = useMutation(api.barInventory.recordBarStockMovement);
  const recordLocationTransfer = useMutation(api.barInventory.recordLocationTransfer);
  const recordBatchCount = useMutation(api.barInventory.recordBatchCount);
  const importParsed = useMutation(api.barInventory.importParsedBarItems);
  const parseInput = useAction(api.barInventory.parseBarInventoryInput);
  const updateCost = useMutation(api.barInventory.updateItemCost);
  const lookupSku = useAction(api.barInventory.lookupBySku);
  const sendPoEmail = useMutation(api.barInventory.sendPurchaseOrderEmail);
  const sendDigest = useMutation(api.barInventory.sendInventoryDigest);
  const upsertPrepBoardItem = useMutation(api.barInventory.upsertPrepBoardItem);
  const updatePrepBoardItemStatus = useMutation(api.barInventory.updatePrepBoardItemStatus);

  // Form state
  const [name, setName] = useState('');
  const [category, setCategory] = useState<Category>('spirit');
  const [area, setArea] = useState('');
  const [unit, setUnit] = useState('bottle');
  const [parLevel, setParLevel] = useState('0');
  const [onHand, setOnHand] = useState('0');
  const [unitCost, setUnitCost] = useState('');
  const [supplier, setSupplier] = useState('');
  const [sku, setSku] = useState('');
  const [notes, setNotes] = useState('');
  const [parseText, setParseText] = useState('');
  const [parsedItems, setParsedItems] = useState<ParsedItem[]>([]);
  const [parseNotes, setParseNotes] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'beverage' | 'food' | 'supplies'>('beverage');
  const [historyItemId, setHistoryItemId] = useState<string | null>(null);
  const [countMode, setCountMode] = useState(false);
  const [countIndex, setCountIndex] = useState(0);
  const [countValue, setCountValue] = useState('');
  const [showStockCsv, setShowStockCsv] = useState(false);
  const [showMovementCsv, setShowMovementCsv] = useState(false);
  const [showShrinkage, setShowShrinkage] = useState(false);
  const [showPurchaseOrder, setShowPurchaseOrder] = useState(false);
  const [showPurchaseOrderCsv, setShowPurchaseOrderCsv] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [scannedItem, setScannedItem] = useState<BarItem | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [costHistoryItemId, setCostHistoryItemId] = useState<string | null>(null);
  const [editCostItemId, setEditCostItemId] = useState<string | null>(null);
  const [editCostValue, setEditCostValue] = useState('');
  const [showAgingReport, setShowAgingReport] = useState(false);
  const [showInventoryTools, setShowInventoryTools] = useState(false);
  const [visibleItemCount, setVisibleItemCount] = useState(INVENTORY_RENDER_BATCH_SIZE);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [prepKind, setPrepKind] = useState<PrepBoardKind>('prep');
  const [prepTitle, setPrepTitle] = useState('');
  const [prepQuantity, setPrepQuantity] = useState('');
  const [prepUnit, setPrepUnit] = useState('');
  const [prepStation, setPrepStation] = useState('');
  const [prepNotes, setPrepNotes] = useState('');
  const [prepDueDate, setPrepDueDate] = useState('');

  const stockCsv = useQuery(api.barInventory.exportStockCsv, isReady && canManage && showStockCsv ? {} : 'skip') as string | null | undefined;
  const movementCsv = useQuery(api.barInventory.exportMovementsCsv, isReady && canManage && showMovementCsv ? {} : 'skip') as string | null | undefined;
  const shrinkageData = useQuery(api.barInventory.getShrinkageReport, isReady && canManage && showShrinkage ? {} : 'skip') as ShrinkageData | null | undefined;
  const purchaseOrder = useQuery(api.barInventory.getPurchaseOrder, isReady && canManage && showPurchaseOrder ? {} : 'skip') as PurchaseOrderData | null | undefined;
  const purchaseOrderCsv = useQuery(api.barInventory.exportPurchaseOrderCsv, isReady && canManage && showPurchaseOrderCsv ? {} : 'skip') as string | null | undefined;
  const costHistory = useQuery(api.barInventory.getCostHistory, isReady && canManage && costHistoryItemId ? { itemId: costHistoryItemId } : 'skip') as { itemName: string; currentCostCents: number | null; entries: CostHistoryEntry[] } | null | undefined;
  const agingReport = useQuery(api.barInventory.getAgingReport, isReady && canManage && showAgingReport ? {} : 'skip') as AgingReport | null | undefined;

  const allItems = useMemo(() => asArray(stock?.items) as BarItem[], [stock]);
  const locationSummaries = useMemo(() => asArray(stock?.locationSummaries), [stock]);

  // Filter items by category, search query, and stock status
  const items = useMemo(() => {
    return allItems.filter((item) => {
      // Category filter
      const isFood = foodCategories.includes(item.category as any);
      const isSupply = item.category === 'supply' || item.category === 'other';
      if (activeTab === 'beverage' && (isFood || isSupply)) return false;
      if (activeTab === 'food' && !isFood) return false;
      if (activeTab === 'supplies' && !isSupply) return false;

      // Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesName = item.name.toLowerCase().includes(query);
        const matchesSku = item.sku?.toLowerCase().includes(query);
        const matchesSupplier = item.supplier?.toLowerCase().includes(query);
        const matchesArea = item.area?.toLowerCase().includes(query);
        if (!matchesName && !matchesSku && !matchesSupplier && !matchesArea) return false;
      }

      // Stock status filter
      const effectivePar = Math.round(item.parLevel * eventParMultiplier);
      if (stockStatusFilter === 'below_par' && item.onHand > effectivePar) return false;
      if (stockStatusFilter === 'critical' && item.onHand > 0) return false;
      if (stockStatusFilter === 'surplus' && item.onHand <= effectivePar * 1.5) return false;

      return true;
    });
  }, [allItems, activeTab, searchQuery, stockStatusFilter, eventParMultiplier]);

  const lowItems = useMemo(() => {
    return items.filter((item) => item.onHand <= Math.round(item.parLevel * eventParMultiplier));
  }, [items, eventParMultiplier]);

  const activeLowStockCount = lowItems.length;
  const activeTotalValueCents = useMemo(() => {
    return items.reduce((sum, item) => sum + item.onHand * (item.unitCostCents ?? 0), 0);
  }, [items]);

  const prepItems = useMemo(() => asArray(prepBoard?.items), [prepBoard]);
  const activePrepItems = prepItems.filter((item) => item.status === 'open' && item.kind === 'prep');
  const activeEightySixItems = prepItems.filter((item) => item.status === 'open' && item.kind === 'eighty_six');

  // Sorted items for single-item count mode
  const countItems = useMemo(() => {
    return [...items].sort((a, b) => {
      const aArea = a.area ?? 'zzz';
      const bArea = b.area ?? 'zzz';
      if (aArea !== bArea) return aArea.localeCompare(bArea);
      return a.name.localeCompare(b.name);
    });
  }, [items]);

  const saveManualItem = async () => {
    if (!venue?.id) return;
    setBusy(true);
    setMessage(null);
    try {
      await upsertBarItem({
        venueId: venue.id,
        name,
        category,
        area: area.trim() || undefined,
        unit,
        parLevel: Number(parLevel || 0),
        onHand: Number(onHand || 0),
        unitCostCents: unitCost ? Math.round(Number(unitCost) * 100) : undefined,
        supplier: supplier.trim() || undefined,
        sku: sku.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      setName('');
      setParLevel('0');
      setOnHand('0');
      setUnitCost('');
      setSupplier('');
      setSku('');
      setNotes('');
      setMessage(t('barStock.messages.itemSaved'));
    } catch (e) {
      setMessage(errorMessage(e, t('barStock.messages.errorSaveItem')));
    } finally {
      setBusy(false);
    }
  };

  const parseWithAi = async (image?: { base64: string; mimeType?: string }) => {
    if (!venue?.id) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await parseInput({
        venueId: venue.id,
        text: parseText.trim() || undefined,
        imageBase64: image?.base64,
        imageMimeType: image?.mimeType,
      });
      setParsedItems(asArray(result.items) as ParsedItem[]);
      setParseNotes(result.notes || null);
      setMessage(t('barStock.messages.parsedItems', { count: asArray(result.items).length }));
    } catch (e) {
      setMessage(errorMessage(e, t('barStock.messages.errorParseInput')));
    } finally {
      setBusy(false);
    }
  };

  const pickCsv = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const doc = await DocumentPicker.getDocumentAsync({
        type: ['text/*', 'text/csv', 'application/csv'],
        copyToCacheDirectory: true,
      });
      if (doc.canceled || !doc.assets[0]?.uri) return;
      const text = await readPickedFileText(doc.assets[0]);
      setParseText(text);
      setMessage(t('barStock.messages.loadedForParsing', { name: doc.assets[0].name ?? t('barStock.messages.uploadFallback') }));
    } catch (e) {
      setMessage(errorMessage(e, t('barStock.messages.errorLoadCsv')));
    } finally {
      setBusy(false);
    }
  };

  const pickPhoto = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.status !== 'granted') {
        setMessage(t('barStock.messages.photoPermissionRequired'));
        return;
      }
      const image = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        base64: true,
        quality: 0.8,
      });
      if (image.canceled || !image.assets[0]?.base64) return;
      await parseWithAi({ base64: image.assets[0].base64, mimeType: image.assets[0].mimeType });
    } catch (e) {
      setMessage(errorMessage(e, t('barStock.messages.errorLoadPhoto')));
    } finally {
      setBusy(false);
    }
  };

  const importItems = async () => {
    if (!venue?.id || parsedItems.length === 0) return;
    setBusy(true);
    try {
      const result = await importParsed({ venueId: venue.id, items: parsedItems });
      setParsedItems([]);
      setParseText('');
      setMessage(t('barStock.messages.importedItems', { count: result.imported }));
    } catch (e) {
      setMessage(errorMessage(e, t('barStock.messages.errorImportItems')));
    } finally {
      setBusy(false);
    }
  };

  const recordInventoryMovement = async (
    itemId: Id<'barInventoryItems'>,
    movementType: MovementType,
    quantity: number,
    extra?: { wasteReason?: WasteReason; fromArea?: string; toArea?: string; notes?: string },
  ) => {
    if (!venue?.id) {
      setMessage(t('barStock.messages.noVenue'));
      return;
    }
    setMessage(null);
    try {
      await recordMovement({
        venueId: venue.id,
        itemId,
        movementType,
        quantity,
        wasteReason: extra?.wasteReason,
        fromArea: extra?.fromArea,
        toArea: extra?.toArea,
        notes: extra?.notes,
      });
    } catch (e) {
      setMessage(errorMessage(e, t('barStock.messages.errorUpdateStockCount')));
    }
  };

  const handleStockTransfer = async () => {
    if (!venue?.id || !transferItem) return;
    const qty = Number(transferQty);
    if (isNaN(qty) || qty <= 0) {
      setMessage('Please enter a valid transfer quantity greater than 0.');
      return;
    }
    if (!transferToArea.trim()) {
      setMessage('Please enter a destination outlet or area.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await recordLocationTransfer({
        venueId: venue.id,
        itemId: transferItem._id,
        quantity: qty,
        fromArea: transferFromArea.trim() || 'Central Warehouse',
        toArea: transferToArea.trim(),
        notes: transferNotes.trim() || undefined,
      });
      setTransferItem(null);
      setTransferQty('1');
      setTransferToArea('');
      setTransferNotes('');
      setMessage(`Successfully transferred ${qty} ${transferItem.unit} to ${transferToArea.trim()}.`);
    } catch (e) {
      setMessage(errorMessage(e, 'Failed to record inter-location transfer'));
    } finally {
      setBusy(false);
    }
  };

  const handleLogWaste = async () => {
    if (!venue?.id || !wasteItem) return;
    const qty = Number(wasteQty);
    if (isNaN(qty) || qty <= 0) {
      setMessage('Please enter a valid waste quantity greater than 0.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await recordMovement({
        venueId: venue.id,
        itemId: wasteItem._id,
        movementType: 'waste',
        quantity: -qty,
        wasteReason,
        notes: wasteNotes.trim() || undefined,
      });
      const lossCents = Math.round(qty * (wasteItem.unitCostCents ?? 0));
      setWasteItem(null);
      setWasteQty('1');
      setWasteNotes('');
      setMessage(`Recorded waste for ${wasteItem.name} (${qty} ${wasteItem.unit} · Loss: ${money(lossCents)}).`);
    } catch (e) {
      setMessage(errorMessage(e, 'Failed to log waste'));
    } finally {
      setBusy(false);
    }
  };

  const submitBatchCount = async () => {
    if (!venue?.id) return;
    const countsList = Object.entries(batchCounts).map(([itemId, countedQuantity]) => ({
      itemId,
      countedQuantity,
    }));
    if (countsList.length === 0) {
      setBatchCountMode(false);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await recordBatchCount({
        venueId: venue.id,
        counts: countsList,
        area: batchCountArea !== 'all' ? batchCountArea : undefined,
      });
      setBatchCountMode(false);
      setBatchCounts({});
      setMessage(`Successfully audited & updated ${res.updatedCount ?? countsList.length} items.`);
    } catch (e) {
      setMessage(errorMessage(e, 'Failed to save batch count audit'));
    } finally {
      setBusy(false);
    }
  };

  const submitCount = useCallback(async () => {
    if (!venue?.id || countIndex >= countItems.length) return;
    const item = countItems[countIndex];
    const qty = Number(countValue);
    if (isNaN(qty) || qty < 0) {
      setMessage(t('barStock.messages.invalidCount'));
      return;
    }
    try {
      await recordMovement({ venueId: venue.id, itemId: item._id, movementType: 'count', quantity: qty });
      if (countIndex + 1 < countItems.length) {
        setCountIndex(countIndex + 1);
        setCountValue(String(countItems[countIndex + 1].onHand));
      } else {
        setCountMode(false);
        setCountIndex(0);
        setMessage(t('barStock.messages.countComplete', { count: countItems.length }));
      }
    } catch (e) {
      setMessage(errorMessage(e, t('barStock.messages.errorRecordCount')));
    }
  }, [venue?.id, countIndex, countItems, countValue, recordMovement, t]);

  const openScanner = async () => {
    setScanMsg(null);
    setScannedItem(null);
    if (Platform.OS === 'web') {
      setScanMsg(t('barStock.messages.scanningNotAvailableWeb'));
      return;
    }
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) {
        setScanMsg(t('barStock.messages.cameraPermissionRequired'));
        return;
      }
    }
    setShowScanner(true);
  };

  const onBarcodeScanned = useCallback(
    async ({ data }: { data: string }) => {
      if (scanBusy || !data) return;
      setScanBusy(true);
      setScanMsg(null);
      try {
        const item = await lookupSku({ sku: data });
        setScannedItem(item as BarItem);
        setShowScanner(false);
      } catch {
        setScanMsg(t('barStock.messages.barcodeNotFound', { code: data }));
        setShowScanner(false);
      } finally {
        setScanBusy(false);
      }
    },
    [scanBusy, lookupSku, t],
  );

  const saveCostUpdate = async (itemId: string) => {
    const cents = Math.round(Number(editCostValue) * 100);
    if (isNaN(cents) || cents < 0) {
      setMessage(t('barStock.messages.invalidPrice'));
      return;
    }
    try {
      await updateCost({ itemId, unitCostCents: cents });
      setEditCostItemId(null);
      setEditCostValue('');
      setMessage(t('barStock.messages.costUpdated'));
    } catch (e) {
      setMessage(errorMessage(e, t('barStock.messages.errorUpdateCost')));
    }
  };

  const savePrepBoardItem = async () => {
    if (!venue?.id || !prepTitle.trim()) return;
    setMessage(null);
    try {
      const quantity = prepQuantity.trim() ? Number(prepQuantity) : undefined;
      if (quantity !== undefined && (Number.isNaN(quantity) || quantity < 0)) {
        setMessage(t('barStock.messages.invalidPrepQuantity'));
        return;
      }
      await upsertPrepBoardItem({
        venueId: venue.id,
        kind: prepKind,
        title: prepTitle.trim(),
        quantity,
        unit: prepUnit.trim() || undefined,
        station: prepStation.trim() || undefined,
        notes: prepNotes.trim() || undefined,
        dueDate: prepDueDate.trim() || undefined,
        status: 'open',
      });
      setPrepTitle('');
      setPrepQuantity('');
      setPrepUnit('');
      setPrepStation('');
      setPrepNotes('');
      setPrepDueDate('');
      setMessage(prepKind === 'prep' ? t('barStock.messages.prepItemAdded') : t('barStock.messages.eightySixItemAdded'));
    } catch (e) {
      setMessage(errorMessage(e, t('barStock.messages.errorSavePrepItem')));
    }
  };

  const setPrepBoardStatus = async (itemId: string, status: PrepBoardStatus) => {
    setMessage(null);
    try {
      await updatePrepBoardItemStatus({ itemId, status });
    } catch (e) {
      setMessage(errorMessage(e, t('barStock.messages.errorUpdatePrepBoard')));
    }
  };

  // Non-managers get a read-only inventory view
  if (!canManage) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ padding: isPhone ? spacing.md : spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        <SectionHeader kicker="STADIUM INVENTORY" title="Stock Directory" subtitle="Live beverage and food levels across stadium locations." />

        {profileLoading || stock === undefined ? (
          <Text style={{ color: colors.muted }}>{t('barStock.common.loading')}</Text>
        ) : (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {[
                { label: 'Active Items', value: String(items.length), a: accents[0] },
                { label: 'Below Par', value: String(lowItems.length), a: accents[4] },
              ].map((metric) => (
                <Card key={metric.label} style={{ backgroundColor: metric.a.bg, width: '48%', flexGrow: 1, borderRadius: radius.sharp }}>
                  <Card.Content>
                    <Text style={{ color: metric.a.fg, fontSize: 22, fontWeight: '800' }}>{metric.value}</Text>
                    <Text style={{ color: colors.charcoal }}>{metric.label}</Text>
                  </Card.Content>
                </Card>
              ))}
            </View>

            <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
              <Card.Content style={{ gap: spacing.sm }}>
                <Text variant="titleMedium" style={{ fontWeight: '700' }}>Stadium Inventory List</Text>
                {items.length === 0 ? (
                  <Text style={{ color: colors.muted }}>{t('barStock.list.empty')}</Text>
                ) : (
                  items.map((item) => (
                    <View key={item._id} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontWeight: '700' }}>{item.name}</Text>
                        <Text style={{ color: colors.muted }}>{item.category} · {item.area ?? 'Main Warehouse'}</Text>
                      </View>
                      <Chip compact style={{ backgroundColor: item.onHand <= item.parLevel ? accents[4].bg : accents[2].bg }}>
                        {item.onHand} / {item.parLevel} {item.unit}
                      </Chip>
                    </View>
                  ))
                )}
              </Card.Content>
            </Card>
          </>
        )}
      </ScrollView>
    );
  }

  // Barcode scanner overlay
  if (showScanner && Platform.OS !== 'web') {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'] }}
          onBarcodeScanned={onBarcodeScanned}
        />
        <View style={{ position: 'absolute', top: 60, left: 20, right: 20, alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700', textShadowColor: '#000', textShadowRadius: 4 }}>
            {t('barStock.scan.pointAtCode')}
          </Text>
        </View>
        <View style={{ position: 'absolute', bottom: 60, left: 20, right: 20 }}>
          {scanMsg ? <Text style={{ color: '#f88', textAlign: 'center', marginBottom: 12 }}>{scanMsg}</Text> : null}
          <Button mode="contained" buttonColor="#333" onPress={() => setShowScanner(false)}>{t('barStock.common.cancel')}</Button>
        </View>
      </View>
    );
  }

  // Count workflow overlay
  if (countMode && countItems.length > 0) {
    const current = countItems[countIndex];
    const prevArea = countIndex > 0 ? countItems[countIndex - 1].area : null;
    const isNewArea = current.area !== prevArea;
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="headlineMedium" style={{ color: colors.primary, fontWeight: '800' }}>Single-Item Count</Text>
          <Button compact mode="outlined" textColor={colors.danger} onPress={() => { setCountMode(false); setCountIndex(0); }}>Exit</Button>
        </View>
        <Text style={{ color: colors.muted }}>Item {countIndex + 1} of {countItems.length}</Text>
        <View style={{ height: 4, backgroundColor: colors.border, borderRadius: 2, overflow: 'hidden' }}>
          <View style={{ height: 4, width: `${Math.round(((countIndex + 1) / countItems.length) * 100)}%`, backgroundColor: colors.primary, borderRadius: 2 }} />
        </View>
        {isNewArea && (
          <Card style={{ backgroundColor: accents[1].bg, borderRadius: radius.sharp }}>
            <Card.Content style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <MaterialCommunityIcons name="map-marker" size={18} color={accents[1].fg} />
              <Text style={{ color: accents[1].fg, fontWeight: '700' }}>Area: {current.area ?? 'Main Warehouse'}</Text>
            </Card.Content>
          </Card>
        )}
        <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleLarge" style={{ fontWeight: '800' }}>{current.name}</Text>
            <Text style={{ color: colors.muted }}>Category: {current.category} · Unit: {current.unit} · Par: {Math.round(current.parLevel * eventParMultiplier)}</Text>
            <Text style={{ color: colors.muted }}>Current Recorded Stock: {current.onHand}</Text>
            <TextInput
              label="Actual Count"
              value={countValue}
              onChangeText={setCountValue}
              keyboardType="numeric"
              mode="outlined"
              style={{ backgroundColor: colors.surface }}
              autoFocus
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {countIndex > 0 && (
                <Button compact mode="outlined" textColor={colors.muted} onPress={() => { setCountIndex(countIndex - 1); setCountValue(String(countItems[countIndex - 1].onHand)); }}>Back</Button>
              )}
              <Button compact mode="outlined" textColor={colors.muted} onPress={() => {
                if (countIndex + 1 < countItems.length) { setCountIndex(countIndex + 1); setCountValue(String(countItems[countIndex + 1].onHand)); }
                else { setCountMode(false); setCountIndex(0); setMessage(t('barStock.messages.countFinishedSkipped')); }
              }}>Skip</Button>
              <Button mode="contained" buttonColor={colors.primary} onPress={() => void submitCount()} style={{ flex: 1 }}>
                {countIndex + 1 < countItems.length ? 'Save & Next' : 'Save & Finish'}
              </Button>
            </View>
          </Card.Content>
        </Card>
        <InlineMessage message={message} />
      </ScrollView>
    );
  }

  // Rapid zone audit mode
  if (batchCountMode) {
    const auditItems = items.filter(
      (item) => batchCountArea === 'all' || (item.area?.toLowerCase() === batchCountArea.toLowerCase()),
    );
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View>
            <Text variant="headlineMedium" style={{ color: colors.primary, fontWeight: '800' }}>Rapid Zone Audit</Text>
            <Text style={{ color: colors.muted }}>Auditing area: {batchCountArea === 'all' ? 'All Stadium Areas' : batchCountArea}</Text>
          </View>
          <Button compact mode="outlined" textColor={colors.danger} onPress={() => setBatchCountMode(false)}>Exit</Button>
        </View>

        <Card style={{ backgroundColor: accents[0].bg, borderRadius: radius.sharp }}>
          <Card.Content style={{ gap: spacing.xs }}>
            <Text style={{ fontWeight: '700', color: accents[0].fg }}>High-Speed Audit Instructions</Text>
            <Text style={{ color: colors.charcoal, fontSize: 12 }}>
              Quickly adjust counts below with the multiplier buttons or enter quantities directly. Tap "Submit Audit" when finished.
            </Text>
          </Card.Content>
        </Card>

        {auditItems.map((item) => {
          const currentCount = batchCounts[item._id] ?? item.onHand;
          return (
            <Card key={item._id} style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
              <Card.Content style={{ gap: spacing.xs }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '800', fontSize: 15 }}>{item.name}</Text>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>{item.category} · {item.area ?? 'Warehouse'} · Par: {item.parLevel}</Text>
                  </View>
                  <Chip compact style={{ backgroundColor: currentCount <= item.parLevel ? accents[4].bg : accents[2].bg }}>
                    {currentCount} {item.unit}
                  </Chip>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <Button compact mode="outlined" onPress={() => setBatchCounts((prev) => ({ ...prev, [item._id]: Math.max(0, currentCount - 1) }))}>-1</Button>
                  <Button compact mode="outlined" onPress={() => setBatchCounts((prev) => ({ ...prev, [item._id]: currentCount + 1 }))}>+1</Button>
                  <Button compact mode="outlined" onPress={() => setBatchCounts((prev) => ({ ...prev, [item._id]: currentCount + 6 }))}>+6</Button>
                  <Button compact mode="outlined" onPress={() => setBatchCounts((prev) => ({ ...prev, [item._id]: currentCount + 24 }))}>+24 (Case)</Button>
                  <TextInput
                    value={String(currentCount)}
                    onChangeText={(val) => {
                      const num = Number(val);
                      if (!isNaN(num)) setBatchCounts((prev) => ({ ...prev, [item._id]: num }));
                    }}
                    keyboardType="numeric"
                    dense
                    mode="outlined"
                    style={{ width: 70, backgroundColor: colors.surface, height: 36 }}
                  />
                </View>
              </Card.Content>
            </Card>
          );
        })}

        <Button mode="contained" buttonColor={colors.primary} loading={busy} onPress={() => void submitBatchCount()} style={{ marginTop: spacing.md, paddingVertical: 4 }}>
          Submit Zone Audit ({Object.keys(batchCounts).length} adjusted)
        </Button>
      </ScrollView>
    );
  }

  return (
    <ManagerGate canManage={canManage} profileLoading={profileLoading} feature="Stadium Inventory">
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        <SectionHeader kicker="ENTERPRISE INVENTORY" title="Stadium Bar & Concessions" subtitle="Multi-location inventory, event surge pars, and inter-stand distribution." />

        {/* Event Surge Par Multiplier Toolbar */}
        <Card style={{ backgroundColor: eventParMultiplier > 1 ? '#F0FDF4' : colors.surface, borderColor: eventParMultiplier > 1 ? '#86EFAC' : colors.border, borderWidth: 1, borderRadius: radius.sharp }}>
          <Card.Content style={{ gap: spacing.xs }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <MaterialCommunityIcons name="lightning-bolt" size={18} color={eventParMultiplier > 1 ? colors.success : colors.primary} />
                <Text style={{ fontWeight: '800', fontSize: 13 }}>Event Par Surge Multiplier:</Text>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {[
                  { label: '1.0x Normal', val: 1.0 },
                  { label: '1.5x Busy', val: 1.5 },
                  { label: '2.0x Game Day', val: 2.0 },
                  { label: '2.5x Sellout', val: 2.5 },
                ].map((m) => (
                  <Chip
                    key={m.val}
                    compact
                    selected={eventParMultiplier === m.val}
                    onPress={() => setEventParMultiplier(m.val)}
                    style={{ backgroundColor: eventParMultiplier === m.val ? colors.primary : colors.background }}
                    textStyle={{ color: eventParMultiplier === m.val ? '#fff' : colors.charcoal, fontSize: 11, fontWeight: '700' }}
                  >
                    {isPhone ? m.label.replace('1.0x ', '').replace('1.5x ', '').replace('2.0x ', '').replace('2.5x ', '') : m.label}
                  </Chip>
                ))}
              </View>
            </View>
          </Card.Content>
        </Card>

        {/* Location Filter Selector */}
        <View style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontWeight: '700', fontSize: 12, color: colors.muted }}>LOCATION FILTER:</Text>
            <TouchableOpacity onPress={() => setShowLocationBreakdown((v) => !v)}>
              <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>
                {showLocationBreakdown ? 'Hide Outlets' : 'View All Outlets'}
              </Text>
            </TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            <Chip
              selected={activeLocation === 'all'}
              onPress={() => setActiveLocation('all')}
              style={{ backgroundColor: activeLocation === 'all' ? colors.primary : colors.surface }}
              textStyle={{ color: activeLocation === 'all' ? '#fff' : colors.charcoal, fontWeight: '700' }}
            >
              {isPhone ? `All locations (${allItems.length})` : `All Stadium Locations (${allItems.length})`}
            </Chip>
            {locationSummaries.map((loc) => (
              <Chip
                key={loc.area}
                selected={activeLocation.toLowerCase() === loc.area.toLowerCase()}
                onPress={() => setActiveLocation(loc.area)}
                style={{ backgroundColor: activeLocation.toLowerCase() === loc.area.toLowerCase() ? colors.primary : colors.surface }}
                textStyle={{ color: activeLocation.toLowerCase() === loc.area.toLowerCase() ? '#fff' : colors.charcoal }}
              >
                {loc.area} ({loc.itemCount})
              </Chip>
            ))}
          </ScrollView>
        </View>

        {showLocationBreakdown && (
          <LocationBreakdownCard
            summaries={locationSummaries}
            activeArea={activeLocation}
            onSelectArea={(areaName) => setActiveLocation(areaName)}
          />
        )}

        {/* Search first on phones so a manager can narrow the working set before scanning metrics and tools. */}
        <View style={{ gap: spacing.xs }}>
          <TextInput
            placeholder={isPhone ? 'Search items, SKU or location' : 'Search by SKU, item name, supplier, or location...'}
            value={searchQuery}
            onChangeText={setSearchQuery}
            mode="outlined"
            dense
            left={<TextInput.Icon icon="magnify" />}
            style={{ backgroundColor: colors.surface }}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            <Chip compact selected={stockStatusFilter === 'all'} onPress={() => setStockStatusFilter('all')}>All ({items.length})</Chip>
            <Chip compact selected={stockStatusFilter === 'below_par'} onPress={() => setStockStatusFilter('below_par')} style={{ backgroundColor: stockStatusFilter === 'below_par' ? accents[4].bg : colors.surface }}>
              Below Par ({lowItems.length})
            </Chip>
            <Chip compact selected={stockStatusFilter === 'critical'} onPress={() => setStockStatusFilter('critical')}>
              Out of Stock
            </Chip>
          </ScrollView>
        </View>

        {/* Event Stockout Warnings */}
        <EventStockoutRiskCard velocity={velocity} activeMultiplier={eventParMultiplier} />

        {/* Category Tabs */}
        <View style={{ flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 12, padding: 4, marginVertical: 4 }}>
          <Button
            mode={activeTab === 'beverage' ? 'contained' : 'text'}
            buttonColor={activeTab === 'beverage' ? colors.primary : undefined}
            textColor={activeTab === 'beverage' ? '#fff' : colors.muted}
            style={{ flex: 1, borderRadius: 8 }}
            onPress={() => {
              setActiveTab('beverage');
              setCategory('spirit');
            }}
          >
            {isPhone ? 'Beverage' : `Beverage (${allItems.filter((i) => !foodCategories.includes(i.category as any) && i.category !== 'supply').length})`}
          </Button>
          <Button
            mode={activeTab === 'food' ? 'contained' : 'text'}
            buttonColor={activeTab === 'food' ? colors.primary : undefined}
            textColor={activeTab === 'food' ? '#fff' : colors.muted}
            style={{ flex: 1, borderRadius: 8 }}
            onPress={() => {
              setActiveTab('food');
              setCategory('protein');
            }}
          >
            {isPhone ? 'Food' : `Food (${allItems.filter((i) => foodCategories.includes(i.category as any)).length})`}
          </Button>
          <Button
            mode={activeTab === 'supplies' ? 'contained' : 'text'}
            buttonColor={activeTab === 'supplies' ? colors.primary : undefined}
            textColor={activeTab === 'supplies' ? '#fff' : colors.muted}
            style={{ flex: 1, borderRadius: 8 }}
            onPress={() => {
              setActiveTab('supplies');
              setCategory('supply');
            }}
          >
            {isPhone ? 'Supplies' : `Supplies (${allItems.filter((i) => i.category === 'supply' || i.category === 'other').length})`}
          </Button>
        </View>

        {/* Metrics Row */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {[
            { label: 'Active Items', value: String(items.length), a: accents[0] },
            { label: eventParMultiplier > 1 ? `Below Par (${eventParMultiplier}x)` : 'Below Par', value: String(activeLowStockCount), a: accents[4] },
            { label: 'Inventory Value', value: money(activeTotalValueCents), a: accents[2] },
          ].map((metric, index) => (
            <Card key={metric.label} style={{ backgroundColor: metric.a.bg, width: isPhone ? (index === 2 ? '100%' : '47%') : '31%', flexGrow: 1, borderRadius: radius.sharp }}>
              <Card.Content>
                <Text style={{ color: metric.a.fg, fontSize: 22, fontWeight: '800' }}>{metric.value}</Text>
                <Text style={{ color: metric.a.fg, fontSize: 12, fontWeight: '600' }}>{metric.label}</Text>
              </Card.Content>
            </Card>
          ))}
        </View>

        {/* Action Toolbar */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <Button
            mode="contained"
            buttonColor={colors.primary}
            icon="clipboard-list-outline"
            onPress={() => {
              setBatchCountMode(true);
              setBatchCountArea(activeLocation);
            }}
            style={{ flexGrow: 1 }}
          >
            Zone Audit
          </Button>
          <Button
            mode="contained"
            buttonColor="#4F46E5"
            icon="swap-horizontal-bold"
            onPress={() => {
              if (items.length > 0) {
                setTransferItem(items[0]);
                setTransferFromArea(items[0].area ?? 'Main Warehouse');
              }
            }}
            style={{ flexGrow: 1 }}
          >
            Stock Transfer
          </Button>
          <Button compact mode="outlined" textColor={colors.primary} icon="barcode-scan" onPress={() => void openScanner()}>
            Scan SKU
          </Button>
        </View>

        {isPhone ? (
          <Button
            mode="outlined"
            icon={showInventoryTools ? 'chevron-up' : 'dots-horizontal'}
            onPress={() => setShowInventoryTools((visible) => !visible)}
            contentStyle={{ minHeight: 44 }}
          >
            {showInventoryTools ? 'Hide tools' : 'More inventory tools'}
          </Button>
        ) : null}

        {(!isPhone || showInventoryTools) ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <Button compact mode="outlined" textColor={colors.primary} onPress={() => setShowShrinkage((v) => !v)}>
            {showShrinkage ? 'Hide Waste Log' : 'Shrinkage & Waste'}
          </Button>
          <Button compact mode="outlined" textColor={colors.primary} onPress={() => setShowPurchaseOrder((v) => !v)}>
            {showPurchaseOrder ? 'Hide PO' : 'Purchase Orders'}
          </Button>
          <Button compact mode="outlined" textColor={colors.primary} onPress={() => setShowStockCsv((v) => !v)}>
            {showStockCsv ? 'Hide Stock CSV' : 'Export Stock CSV'}
          </Button>
          <Button compact mode="outlined" textColor={colors.primary} onPress={() => setShowMovementCsv((v) => !v)}>
            {showMovementCsv ? 'Hide Logs' : 'Movement Log'}
          </Button>
          <Button compact mode="outlined" textColor={colors.primary} onPress={() => setShowAgingReport((v) => !v)}>
            {showAgingReport ? 'Hide Aging' : 'Aging Report'}
          </Button>
          </View>
        ) : null}

        {/* Scanned item result */}
        {scannedItem && (
          <Card style={{ backgroundColor: accents[0].bg, borderRadius: radius.sharp }}>
            <Card.Content style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text variant="titleMedium" style={{ color: accents[0].fg, fontWeight: '700' }}>Scanned: {scannedItem.name}</Text>
                <Button compact mode="text" textColor={accents[0].fg} onPress={() => setScannedItem(null)}>✕</Button>
              </View>
              <Text style={{ color: colors.charcoal }}>{scannedItem.category} · {scannedItem.area ?? 'Main Warehouse'} · {money(scannedItem.unitCostCents)} / {scannedItem.unit}</Text>
              <Text style={{ color: colors.charcoal }}>On hand: {scannedItem.onHand} · Par: {scannedItem.parLevel}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                <Button compact mode="contained" buttonColor={colors.success} onPress={() => { void recordInventoryMovement(scannedItem._id, 'received', 1); }}>+1 Received</Button>
                <Button compact mode="contained" buttonColor={colors.danger} onPress={() => { setWasteItem(scannedItem); }}>Log Waste</Button>
                <Button compact mode="contained" buttonColor="#4F46E5" onPress={() => { setTransferItem(scannedItem); setTransferFromArea(scannedItem.area ?? 'Warehouse'); }}>Transfer</Button>
                <Button compact mode="outlined" textColor={colors.muted} onPress={() => setScannedItem(null)}>Dismiss</Button>
              </View>
            </Card.Content>
          </Card>
        )}
        {scanMsg && !showScanner && <Text style={{ color: colors.danger }}>{scanMsg}</Text>}

        {/* Shrinkage Report */}
        {showShrinkage && <ShrinkageCard data={shrinkageData} />}

        {/* Purchase Order */}
        {showPurchaseOrder && (
          <PurchaseOrderCard
            purchaseOrder={purchaseOrder}
            csv={purchaseOrderCsv}
            showCsv={showPurchaseOrderCsv}
            busy={busy}
            onToggleCsv={() => setShowPurchaseOrderCsv((v) => !v)}
            onEmail={async () => {
              setBusy(true);
              setMessage(null);
              try {
                const r = await sendPoEmail({});
                setMessage(r.sent ? t('barStock.messages.poEmailed', { count: r.itemCount }) : r.reason ?? t('barStock.messages.notSent'));
              } catch (e) {
                setMessage(errorMessage(e, t('barStock.messages.errorSendPoEmail')));
              } finally {
                setBusy(false);
              }
            }}
          />
        )}

        {/* Aging Report */}
        {showAgingReport && <AgingCard report={agingReport} />}

        {/* CSV Dumps */}
        {showStockCsv && (
          <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
            <Card.Content style={{ gap: spacing.sm }}>
              <Text variant="titleMedium" style={{ fontWeight: '700' }}>Stock Snapshot CSV</Text>
              <Text selectable style={{ color: colors.charcoal, fontFamily: 'monospace', fontSize: 12 }}>
                {stockCsv ?? 'Loading export...'}
              </Text>
            </Card.Content>
          </Card>
        )}
        {showMovementCsv && (
          <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
            <Card.Content style={{ gap: spacing.sm }}>
              <Text variant="titleMedium" style={{ fontWeight: '700' }}>Movement Log CSV</Text>
              <Text selectable style={{ color: colors.charcoal, fontFamily: 'monospace', fontSize: 12 }}>
                {movementCsv ?? 'Loading export...'}
              </Text>
            </Card.Content>
          </Card>
        )}

        {/* Usage Velocity */}
        <VelocityCard velocity={velocity} />

        {/* Kitchen / Bar Prep Board */}
        <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing.sm }}>
              <View style={{ flex: 1, minWidth: 220 }}>
                <Text variant="titleMedium" style={{ fontWeight: '700' }}>Kitchen & Bar Prep Board</Text>
                <Text style={{ color: colors.muted }}>Daily shift prep tasks and 86'd out-of-stock items.</Text>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                <Chip compact>{prepBoard?.prepCount ?? 0} Prep Tasks</Chip>
                <Chip compact style={{ backgroundColor: (prepBoard?.eightySixCount ?? 0) > 0 ? accents[4].bg : accents[2].bg }}>
                  {prepBoard?.eightySixCount ?? 0} 86'd Items
                </Chip>
              </View>
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              <Chip selected={prepKind === 'prep'} onPress={() => setPrepKind('prep')}>+ Prep Item</Chip>
              <Chip selected={prepKind === 'eighty_six'} onPress={() => setPrepKind('eighty_six')}>! 86 / Out of Stock</Chip>
            </View>

            <TextInput
              label={prepKind === 'prep' ? 'Prep Item Title' : '86 Item Title'}
              value={prepTitle}
              onChangeText={setPrepTitle}
              mode="outlined"
              style={{ backgroundColor: colors.surface }}
            />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              <TextInput label="Qty" value={prepQuantity} onChangeText={setPrepQuantity} keyboardType="numeric" mode="outlined" style={{ flexGrow: 1, flexBasis: 90, backgroundColor: colors.surface }} />
              <TextInput label="Unit" value={prepUnit} onChangeText={setPrepUnit} mode="outlined" style={{ flexGrow: 1, flexBasis: 110, backgroundColor: colors.surface }} />
              <TextInput label="Station" value={prepStation} onChangeText={setPrepStation} mode="outlined" style={{ flexGrow: 1, flexBasis: 130, backgroundColor: colors.surface }} />
              <TextInput label="Due Date" placeholder="YYYY-MM-DD" value={prepDueDate} onChangeText={setPrepDueDate} mode="outlined" style={{ flexGrow: 1, flexBasis: 140, backgroundColor: colors.surface }} />
            </View>
            <Button mode="contained" buttonColor={colors.primary} icon={prepKind === 'prep' ? 'clipboard-plus-outline' : 'minus-circle-outline'} onPress={() => void savePrepBoardItem()} style={{ alignSelf: 'flex-start' }}>
              Add to Prep Board
            </Button>

            {activeEightySixItems.length > 0 ? (
              <View style={{ gap: spacing.xs }}>
                <Text style={{ color: colors.danger, fontWeight: '800' }}>CURRENTLY 86'D (OUT OF STOCK):</Text>
                {activeEightySixItems.map((item) => (
                  <View key={item._id} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: '700' }}>{item.title}</Text>
                      <Text style={{ color: colors.muted }}>{item.station ?? 'All Outlets'}</Text>
                    </View>
                    <Button compact mode="outlined" textColor={colors.primary} onPress={() => void setPrepBoardStatus(item._id, 'done')}>Restocked</Button>
                  </View>
                ))}
              </View>
            ) : null}
          </Card.Content>
        </Card>

        {/* AI & CSV Import Card */}
        <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleMedium" style={{ fontWeight: '700' }}>AI & CSV Batch Catalog Import</Text>
            <TextInput label="Paste distributor invoice text, product list, or manifest..." value={parseText} onChangeText={setParseText} mode="outlined" multiline style={{ backgroundColor: colors.surface }} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              <Button mode="contained" buttonColor={colors.primary} loading={busy} onPress={() => void parseWithAi()}>Parse with AI</Button>
              <Button mode="outlined" textColor={colors.primary} disabled={busy} onPress={() => void pickCsv()}>Upload CSV</Button>
              <Button mode="outlined" textColor={colors.primary} disabled={busy} onPress={() => void pickPhoto()}>Photo Invoice</Button>
            </View>
            {parsedItems.length > 0 ? (
              <View style={{ gap: spacing.sm }}>
                <Text style={{ fontWeight: '700' }}>Review Parsed Items ({parsedItems.length})</Text>
                {parsedItems.slice(0, 8).map((item, index) => (
                  <View key={`${item.name}-${index}`} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm }}>
                    <Text style={{ fontWeight: '700' }}>{item.name}</Text>
                    <Text style={{ color: colors.muted }}>{item.category} · On Hand: {item.onHand ?? 0} {item.unit} · Par: {item.parLevel ?? 0}</Text>
                  </View>
                ))}
                <Button mode="contained" buttonColor={colors.primary} loading={busy} onPress={() => void importItems()}>Import All Parsed Items</Button>
              </View>
            ) : null}
          </Card.Content>
        </Card>

        {/* Add Manual SKU Form */}
        <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleMedium" style={{ fontWeight: '700' }}>Add Stadium SKU</Text>
            <TextInput label="Item Name" value={name} onChangeText={setName} mode="outlined" style={{ backgroundColor: colors.surface }} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {(activeTab === 'beverage'
                ? (['spirit', 'wine', 'beer', 'mixer', 'garnish'] as const)
                : activeTab === 'food'
                ? foodCategories
                : (['supply', 'other'] as const)
              ).map((item) => (
                <Chip key={item} selected={category === item} onPress={() => setCategory(item as any)}>{item}</Chip>
              ))}
            </View>
            <View style={addItemRow}>
              <TextInput label="Area / Stand / Location" value={area} onChangeText={setArea} placeholder="e.g. Stand 104, Suite Pantry 3" mode="outlined" style={addItemWideField} />
              <TextInput label="Unit (bottle, keg, case, lb)" value={unit} onChangeText={setUnit} mode="outlined" style={addItemWideField} />
            </View>
            <View style={addItemRow}>
              <TextInput label="Base Par Level" value={parLevel} onChangeText={setParLevel} keyboardType="numeric" mode="outlined" style={addItemNumberField} />
              <TextInput label="Initial On Hand" value={onHand} onChangeText={setOnHand} keyboardType="numeric" mode="outlined" style={addItemNumberField} />
              <TextInput label="Unit Cost ($)" value={unitCost} onChangeText={setUnitCost} keyboardType="numeric" mode="outlined" style={addItemNumberField} />
            </View>
            <View style={addItemRow}>
              <TextInput label="Supplier / Distributor" value={supplier} onChangeText={setSupplier} mode="outlined" style={addItemWideField} />
              <TextInput label="SKU / Barcode" value={sku} onChangeText={setSku} mode="outlined" style={addItemWideField} />
            </View>
            <TextInput label="Notes" value={notes} onChangeText={setNotes} mode="outlined" style={{ backgroundColor: colors.surface }} />
            <Button mode="contained" buttonColor={colors.primary} loading={busy} onPress={() => void saveManualItem()}>Save Item to Catalog</Button>
          </Card.Content>
        </Card>

        {/* Inventory Item Listing */}
        <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text variant="titleMedium" style={{ fontWeight: '700' }}>
                Stock Catalog ({items.length} items)
              </Text>
              {activeLocation !== 'all' && (
                <Chip compact style={{ backgroundColor: accents[0].bg }}>
                  {activeLocation}
                </Chip>
              )}
            </View>

            {items.length === 0 ? (
              <Text style={{ color: colors.muted, paddingVertical: spacing.md, textAlign: 'center' }}>
                No items match your active filter.
              </Text>
            ) : (
              inventoryRowsForWindow(items, visibleItemCount).map((item) => {
                const effectivePar = Math.round(item.parLevel * eventParMultiplier);
                const isBelowPar = item.onHand <= effectivePar;
                const isCritical = item.onHand === 0;

                return (
                  <View key={item._id} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: 4 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={{ fontWeight: '800', fontSize: 14 }}>{item.name}</Text>
                          {item.sku ? <Text style={{ color: colors.muted, fontSize: 11 }}>[{item.sku}]</Text> : null}
                        </View>
                        <Text style={{ color: colors.muted, fontSize: 12 }}>
                          {item.category} · Location: <Text style={{ fontWeight: '700', color: colors.charcoal }}>{item.area ?? 'Main Warehouse'}</Text> · {money(item.unitCostCents)}/{item.unit}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 2 }}>
                        <Chip compact style={{ backgroundColor: isCritical ? '#EF4444' : isBelowPar ? accents[4].bg : accents[2].bg }}>
                          <Text style={{ color: isCritical ? '#fff' : isBelowPar ? accents[4].fg : accents[2].fg, fontWeight: '700' }}>
                            {item.onHand} / {effectivePar} {item.unit}
                          </Text>
                        </Chip>
                        {eventParMultiplier > 1 && (
                          <Text style={{ fontSize: 10, color: colors.muted }}>Base Par: {item.parLevel}</Text>
                        )}
                      </View>
                    </View>

                    {/* Action Bar per Item */}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                      <Button compact mode="outlined" textColor={colors.primary} onPress={() => { setCountMode(true); setCountIndex(Math.max(0, countItems.findIndex((row) => row._id === item._id))); setCountValue(String(item.onHand)); setMessage(null); }}>
                        Count
                      </Button>
                      <Button compact mode="outlined" textColor={colors.success} onPress={() => void recordInventoryMovement(item._id, 'received', 1)}>
                        +1 In
                      </Button>
                      <Button compact mode="outlined" textColor={colors.danger} onPress={() => setWasteItem(item)}>
                        Waste
                      </Button>
                      <Button compact mode="outlined" textColor="#4F46E5" onPress={() => { setTransferItem(item); setTransferFromArea(item.area ?? 'Main Warehouse'); }}>
                        Transfer
                      </Button>
                      <Button compact mode="outlined" textColor={colors.muted} onPress={() => setHistoryItemId(historyItemId === item._id ? null : item._id)}>
                        {historyItemId === item._id ? 'Hide Log' : 'History'}
                      </Button>
                      <Button compact mode="outlined" textColor={colors.muted} onPress={() => {
                        if (editCostItemId === item._id) { setEditCostItemId(null); return; }
                        setEditCostItemId(item._id);
                        setEditCostValue(item.unitCostCents != null ? (item.unitCostCents / 100).toFixed(2) : '');
                      }}>
                        Cost
                      </Button>
                    </View>

                    {/* Inline Cost Editor */}
                    {editCostItemId === item._id && (
                      <View style={{ flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.xs }}>
                        <TextInput
                          label="New Unit Cost ($)"
                          value={editCostValue}
                          onChangeText={setEditCostValue}
                          keyboardType="numeric"
                          mode="outlined"
                          dense
                          style={{ flex: 1, backgroundColor: colors.surface }}
                        />
                        <Button compact mode="contained" buttonColor={colors.primary} onPress={() => void saveCostUpdate(item._id)}>Save</Button>
                        <Button compact mode="text" textColor={colors.muted} onPress={() => setEditCostItemId(null)}>Cancel</Button>
                      </View>
                    )}

                    {/* Inline Movement Timeline */}
                    {historyItemId === item._id && venue?.id && (
                      <View style={{ paddingLeft: spacing.sm, paddingTop: spacing.xs }}>
                        <MovementTimeline itemId={item._id} />
                      </View>
                    )}
                  </View>
                );
              })
            )}

            {visibleItemCount < items.length ? (
              <Button
                mode="outlined"
                textColor={colors.primary}
                onPress={() => setVisibleItemCount((count) => nextInventoryWindow(count, items.length))}
              >
                Show More Items ({items.length - visibleItemCount} remaining)
              </Button>
            ) : null}
          </Card.Content>
        </Card>

        {/* Inter-Location Transfer Modal */}
        <Portal>
          <Dialog visible={Boolean(transferItem)} onDismiss={() => setTransferItem(null)} style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
            <Dialog.Title style={{ fontWeight: '800' }}>Inter-Location Stock Transfer</Dialog.Title>
            <Dialog.Content style={{ gap: spacing.sm }}>
              {transferItem && (
                <>
                  <Text style={{ fontWeight: '700', fontSize: 14 }}>{transferItem.name}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>Current recorded on-hand: {transferItem.onHand} {transferItem.unit}</Text>

                  <View style={addItemRow}>
                    <TextInput label="From Area / Warehouse" value={transferFromArea} onChangeText={setTransferFromArea} mode="outlined" style={addItemWideField} />
                    <TextInput label="To Area / Concession Stand" value={transferToArea} onChangeText={setTransferToArea} placeholder="e.g. Stand 104, Suite Pantry 2" mode="outlined" style={addItemWideField} />
                  </View>

                  <TextInput label="Transfer Quantity" value={transferQty} onChangeText={setTransferQty} keyboardType="numeric" mode="outlined" style={{ backgroundColor: colors.surface }} />
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {['1', '6', '12', '24'].map((q) => (
                      <Chip key={q} compact onPress={() => setTransferQty(q)}>+{q} {transferItem.unit}</Chip>
                    ))}
                  </View>

                  <TextInput label="Transfer Notes (optional)" value={transferNotes} onChangeText={setTransferNotes} placeholder="e.g. Half-time surge restock" mode="outlined" style={{ backgroundColor: colors.surface }} />
                </>
              )}
            </Dialog.Content>
            <Dialog.Actions>
              <Button textColor={colors.muted} onPress={() => setTransferItem(null)}>Cancel</Button>
              <Button mode="contained" buttonColor="#4F46E5" loading={busy} onPress={() => void handleStockTransfer()}>Confirm Transfer</Button>
            </Dialog.Actions>
          </Dialog>
        </Portal>

        {/* Waste & Spoilage Logging Modal */}
        <Portal>
          <Dialog visible={Boolean(wasteItem)} onDismiss={() => setWasteItem(null)} style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
            <Dialog.Title style={{ fontWeight: '800', color: colors.danger }}>Log Waste / Spoilage</Dialog.Title>
            <Dialog.Content style={{ gap: spacing.sm }}>
              {wasteItem && (
                <>
                  <Text style={{ fontWeight: '700', fontSize: 14 }}>{wasteItem.name}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>Unit Cost: {money(wasteItem.unitCostCents)} · Location: {wasteItem.area ?? 'Warehouse'}</Text>

                  <Text style={{ fontWeight: '700', fontSize: 12, marginTop: 4 }}>Select Waste Reason:</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {(Object.keys(WASTE_REASON_LABELS) as WasteReason[]).map((r) => (
                      <Chip key={r} compact selected={wasteReason === r} onPress={() => setWasteReason(r)}>
                        {WASTE_REASON_LABELS[r]}
                      </Chip>
                    ))}
                  </View>

                  <TextInput label="Waste Quantity" value={wasteQty} onChangeText={setWasteQty} keyboardType="numeric" mode="outlined" style={{ backgroundColor: colors.surface }} />
                  <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 13 }}>
                    Financial Loss Impact: {money(Math.round(Number(wasteQty || 0) * (wasteItem.unitCostCents ?? 0)))}
                  </Text>

                  <TextInput label="Incident Details / Notes (optional)" value={wasteNotes} onChangeText={setWasteNotes} placeholder="e.g. Line pressure burst, drop incident" mode="outlined" style={{ backgroundColor: colors.surface }} />
                </>
              )}
            </Dialog.Content>
            <Dialog.Actions>
              <Button textColor={colors.muted} onPress={() => setWasteItem(null)}>Cancel</Button>
              <Button mode="contained" buttonColor={colors.danger} loading={busy} onPress={() => void handleLogWaste()}>Log Waste Movement</Button>
            </Dialog.Actions>
          </Dialog>
        </Portal>

        <InlineMessage message={message} />
      </ScrollView>
    </ManagerGate>
  );
}

// Expo Router renders this boundary around this route only, so a render
// error here shows a recovery card in place instead of unmounting the
// whole app through the root boundary.
export { RouteErrorBoundary as ErrorBoundary } from '../../components/ErrorBoundary';
