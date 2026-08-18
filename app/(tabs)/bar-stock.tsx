import { useCallback, useMemo, useState } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Button, Card, Chip, Text, TextInput } from 'react-native-paper';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useAction, useMutation, useQuery } from '../../lib/railway-hooks';
import { api } from '../../lib/railway-api';
import type { Id } from '../../lib/ids';
import { accents, colors, radius, spacing } from '../../lib/theme';
import { useVenueAuth } from '../../lib/useVenueAuth';
import { errorMessage } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { ManagerGate } from '../../components/ManagerGate';
import {
  money,
  type VelocityRow,
  type ShrinkageData,
  type PurchaseOrderData,
  type CostHistoryEntry,
  type AgingReport,
} from '../../lib/bar-inventory-types';
import {
  VelocityCard,
  ShrinkageCard,
  PurchaseOrderCard,
  AgingCard,
  MovementTimeline,
} from '../../components/bar-stock/InventoryCards';
import { InlineMessage } from '../../components/InlineMessage';
import { SectionHeader } from '../../components/AppCard';
import { readPickedFileText } from '../../lib/picked-file';
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
};

type BarStock = {
  items: BarItem[];
  lowStockCount: number;
  totalValueCents: number;
};

type ParsedItem = Omit<BarItem, '_id' | 'area' | 'unitCostCents' | 'supplier' | 'notes'> & {
  area?: string;
  unitCostCents?: number;
  supplier?: string;
  notes?: string;
};

type MovementType = 'count' | 'received' | 'waste' | 'transfer';
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
  // Inventory (stock levels) is visible to every venue member; edits below stay
  // manager-only. The velocity/prep-board/report queries remain manager-gated.
  const stock = useQuery(api.barInventory.getBarStock, isReady && venue?.id ? { venueId: venue.id } : 'skip') as BarStock | null | undefined;
  const velocity = useQuery(api.barInventory.getUsageVelocity, isReady && canManage && venue?.id ? { venueId: venue.id } : 'skip') as VelocityRow[] | null | undefined;
  const prepBoard = useQuery(api.barInventory.listPrepBoard, isReady && canManage && venue?.id ? { venueId: venue.id } : 'skip') as PrepBoard | null | undefined;
  const upsertBarItem = useMutation(api.barInventory.upsertBarItem);
  const recordMovement = useMutation(api.barInventory.recordBarStockMovement);
  const importParsed = useMutation(api.barInventory.importParsedBarItems);
  const parseInput = useAction(api.barInventory.parseBarInventoryInput);
  const updateCost = useMutation(api.barInventory.updateItemCost);
  const lookupSku = useAction(api.barInventory.lookupBySku);
  const sendPoEmail = useMutation(api.barInventory.sendPurchaseOrderEmail);
  const sendDigest = useMutation(api.barInventory.sendInventoryDigest);
  const upsertPrepBoardItem = useMutation(api.barInventory.upsertPrepBoardItem);
  const updatePrepBoardItemStatus = useMutation(api.barInventory.updatePrepBoardItemStatus);

  const [name, setName] = useState('');
  const [category, setCategory] = useState<Category>('spirit');
  const [area, setArea] = useState('');
  const [unit, setUnit] = useState('bottle');
  const [parLevel, setParLevel] = useState('0');
  const [onHand, setOnHand] = useState('0');
  const [unitCost, setUnitCost] = useState('');
  const [supplier, setSupplier] = useState('');
  const [notes, setNotes] = useState('');
  const [parseText, setParseText] = useState('');
  const [parsedItems, setParsedItems] = useState<ParsedItem[]>([]);
  const [parseNotes, setParseNotes] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'beverage' | 'food'>('beverage');
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

  const allItems = useMemo(() => (stock?.items ?? []) as BarItem[], [stock]);

  const items = useMemo(() => {
    return allItems.filter(item => {
      const isFood = foodCategories.includes(item.category as any);
      return activeTab === 'beverage' ? !isFood : isFood;
    });
  }, [allItems, activeTab]);

  const lowItems = useMemo(() => items.filter((item) => item.onHand <= item.parLevel), [items]);

  const activeLowStockCount = lowItems.length;
  const activeTotalValueCents = useMemo(() => {
    return items.reduce((sum, item) => sum + (item.onHand * (item.unitCostCents ?? 0)), 0);
  }, [items]);

  const prepItems = useMemo(() => prepBoard?.items ?? [], [prepBoard]);
  const activePrepItems = prepItems.filter((item) => item.status === 'open' && item.kind === 'prep');
  const activeEightySixItems = prepItems.filter((item) => item.status === 'open' && item.kind === 'eighty_six');

  // Group items by area for count workflow
  const countItems = useMemo(() => {
    const sorted = [...items].sort((a, b) => {
      const aArea = a.area ?? 'zzz';
      const bArea = b.area ?? 'zzz';
      if (aArea !== bArea) return aArea.localeCompare(bArea);
      return a.name.localeCompare(b.name);
    });
    return sorted;
  }, [items]);

  const saveManualItem = async () => {
    if (!venue?.id) return;
    setBusy(true);
    setMessage(null);
    try {
      await upsertBarItem({
        venueId: venue.id, name, category, area: area.trim() || undefined, unit,
        parLevel: Number(parLevel || 0), onHand: Number(onHand || 0),
        unitCostCents: unitCost ? Math.round(Number(unitCost) * 100) : undefined,
        supplier: supplier.trim() || undefined, notes: notes.trim() || undefined,
      });
      setName(''); setParLevel('0'); setOnHand('0'); setUnitCost(''); setSupplier(''); setNotes('');
      setMessage(t('barStock.messages.itemSaved'));
    } catch (e) {
      setMessage(errorMessage(e, t('barStock.messages.errorSaveItem')));
    } finally { setBusy(false); }
  };

  const parseWithAi = async (image?: { base64: string; mimeType?: string }) => {
    if (!venue?.id) return;
    setBusy(true); setMessage(null);
    try {
      const result = await parseInput({ venueId: venue.id, text: parseText.trim() || undefined, imageBase64: image?.base64, imageMimeType: image?.mimeType });
      setParsedItems(result.items as ParsedItem[]);
      setParseNotes(result.notes || null);
      setMessage(t('barStock.messages.parsedItems', { count: result.items.length }));
    } catch (e) { setMessage(errorMessage(e, t('barStock.messages.errorParseInput'))); }
    finally { setBusy(false); }
  };

  const pickCsv = async () => {
    setBusy(true); setMessage(null);
    try {
      const doc = await DocumentPicker.getDocumentAsync({ type: ['text/*', 'text/csv', 'application/csv'], copyToCacheDirectory: true });
      if (doc.canceled || !doc.assets[0]?.uri) return;
      const text = await readPickedFileText(doc.assets[0]);
      setParseText(text);
      setMessage(t('barStock.messages.loadedForParsing', { name: doc.assets[0].name ?? t('barStock.messages.uploadFallback') }));
    } catch (e) { setMessage(errorMessage(e, t('barStock.messages.errorLoadCsv'))); }
    finally { setBusy(false); }
  };

  const pickPhoto = async () => {
    setBusy(true); setMessage(null);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.status !== 'granted') { setMessage(t('barStock.messages.photoPermissionRequired')); return; }
      const image = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, base64: true, quality: 0.8 });
      if (image.canceled || !image.assets[0]?.base64) return;
      await parseWithAi({ base64: image.assets[0].base64, mimeType: image.assets[0].mimeType });
    } catch (e) { setMessage(errorMessage(e, t('barStock.messages.errorLoadPhoto'))); }
    finally { setBusy(false); }
  };

  const importItems = async () => {
    if (!venue?.id || parsedItems.length === 0) return;
    setBusy(true);
    try {
      const result = await importParsed({ venueId: venue.id, items: parsedItems });
      setParsedItems([]); setParseText('');
      setMessage(t('barStock.messages.importedItems', { count: result.imported }));
    } catch (e) { setMessage(errorMessage(e, t('barStock.messages.errorImportItems'))); }
    finally { setBusy(false); }
  };

  const recordInventoryMovement = async (itemId: Id<'barInventoryItems'>, movementType: MovementType, quantity: number) => {
    if (!venue?.id) { setMessage(t('barStock.messages.noVenue')); return; }
    setMessage(null);
    try { await recordMovement({ venueId: venue.id, itemId, movementType, quantity }); }
    catch (e) { setMessage(errorMessage(e, t('barStock.messages.errorUpdateStockCount'))); }
  };

  const submitCount = useCallback(async () => {
    if (!venue?.id || countIndex >= countItems.length) return;
    const item = countItems[countIndex];
    const qty = Number(countValue);
    if (isNaN(qty) || qty < 0) { setMessage(t('barStock.messages.invalidCount')); return; }
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
    } catch (e) { setMessage(errorMessage(e, t('barStock.messages.errorRecordCount'))); }
  }, [venue?.id, countIndex, countItems, countValue, recordMovement, t]);

  const openScanner = async () => {
    setScanMsg(null); setScannedItem(null);
    if (Platform.OS === 'web') { setScanMsg(t('barStock.messages.scanningNotAvailableWeb')); return; }
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) { setScanMsg(t('barStock.messages.cameraPermissionRequired')); return; }
    }
    setShowScanner(true);
  };

  const onBarcodeScanned = useCallback(async ({ data }: { data: string }) => {
    if (scanBusy || !data) return;
    setScanBusy(true); setScanMsg(null);
    try {
      const item = await lookupSku({ sku: data });
      setScannedItem(item as BarItem);
      setShowScanner(false);
    } catch {
      setScanMsg(t('barStock.messages.barcodeNotFound', { code: data }));
      setShowScanner(false);
    } finally { setScanBusy(false); }
  }, [scanBusy, lookupSku, t]);

  const saveCostUpdate = async (itemId: string) => {
    const cents = Math.round(Number(editCostValue) * 100);
    if (isNaN(cents) || cents < 0) { setMessage(t('barStock.messages.invalidPrice')); return; }
    try {
      await updateCost({ itemId, unitCostCents: cents });
      setEditCostItemId(null); setEditCostValue('');
      setMessage(t('barStock.messages.costUpdated'));
    } catch (e) { setMessage(errorMessage(e, t('barStock.messages.errorUpdateCost'))); }
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

  // Non-managers get a read-only inventory view: current stock levels and the
  // reorder list, with no edit controls. Financial figures (unit cost, value on
  // hand) stay manager-only.
  if (!canManage) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        <SectionHeader kicker={t('barStock.header.kicker')} title={t('barStock.header.title')} subtitle={t('barStock.header.staffSubtitle')} />

        {profileLoading || stock === undefined ? (
          <Text style={{ color: colors.muted }}>{t('barStock.common.loading')}</Text>
        ) : (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {[
                { label: t('barStock.metrics.items'), value: String(items.length), a: accents[0] },
                { label: t('barStock.metrics.belowPar'), value: String(lowItems.length), a: accents[4] },
              ].map((metric) => (
                <Card key={metric.label} style={{ backgroundColor: metric.a.bg, width: '48%', flexGrow: 1, borderRadius: radius.sharp }}>
                  <Card.Content>
                    <Text style={{ color: metric.a.fg, fontSize: 22, fontWeight: '800' }}>{metric.value}</Text>
                    <Text style={{ color: colors.charcoal }}>{metric.label}</Text>
                  </Card.Content>
                </Card>
              ))}
            </View>

            {lowItems.length > 0 ? (
              <Card style={{ backgroundColor: accents[4].bg, borderRadius: radius.sharp }}>
                <Card.Content style={{ gap: spacing.sm }}>
                  <Text variant="titleMedium" style={{ color: accents[4].fg, fontWeight: '700' }}>{t('barStock.list.reorderListTitle')}</Text>
                  {lowItems.slice(0, 8).map((item) => (
                    <Text key={item._id} style={{ color: colors.charcoal }}>{t('barStock.list.reorderLine', { name: item.name, onHand: item.onHand, unit: item.unit, parLevel: item.parLevel })}</Text>
                  ))}
                </Card.Content>
              </Card>
            ) : null}

            <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
              <Card.Content style={{ gap: spacing.sm }}>
                <Text variant="titleMedium" style={{ fontWeight: '700' }}>{t('barStock.list.stockListTitle')}</Text>
                {items.length === 0 ? (
                  <Text style={{ color: colors.muted }}>{t('barStock.list.empty')}</Text>
                ) : (
                  items.map((item) => (
                    <View key={item._id} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontWeight: '700' }}>{item.name}</Text>
                        <Text style={{ color: colors.muted }}>{item.category} · {item.area ?? t('barStock.list.unassigned')}</Text>
                      </View>
                      <Chip compact style={{ backgroundColor: item.onHand <= item.parLevel ? accents[4].bg : accents[2].bg }}>
                        {item.onHand} / {item.parLevel}
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

  // countItems can shrink out from under an open count session (e.g. another
  // device deletes an item mid-count via a background refetch) — snap back to
  // the normal screen instead of indexing past the end.
  if (countMode && countIndex >= countItems.length) {
    setCountMode(false);
    setCountIndex(0);
  }

  // Count workflow overlay
  if (countMode && countItems.length > 0 && countIndex < countItems.length) {
    const current = countItems[countIndex];
    const prevArea = countIndex > 0 ? countItems[countIndex - 1].area : null;
    const isNewArea = current.area !== prevArea;
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="headlineMedium" style={{ color: colors.primary, fontWeight: '800' }}>{t('barStock.count.title')}</Text>
          <Button compact mode="outlined" textColor={colors.danger} onPress={() => { setCountMode(false); setCountIndex(0); }}>{t('barStock.count.exit')}</Button>
        </View>
        <Text style={{ color: colors.muted }}>{t('barStock.count.itemOf', { current: countIndex + 1, total: countItems.length })}</Text>
        <View style={{ height: 4, backgroundColor: colors.border, borderRadius: 2, overflow: 'hidden' }}>
          <View style={{ height: 4, width: `${Math.round(((countIndex + 1) / countItems.length) * 100)}%`, backgroundColor: colors.primary, borderRadius: 2 }} />
        </View>
        {isNewArea && (
          <Card style={{ backgroundColor: accents[1].bg, borderRadius: radius.sharp }}>
            <Card.Content style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <MaterialCommunityIcons name="map-marker" size={18} color={accents[1].fg} />
              <Text style={{ color: accents[1].fg, fontWeight: '700' }}>{t('barStock.count.area', { area: current.area ?? t('barStock.count.unassigned') })}</Text>
            </Card.Content>
          </Card>
        )}
        <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleLarge" style={{ fontWeight: '800' }}>{current.name}</Text>
            <Text style={{ color: colors.muted }}>{t('barStock.count.categoryLine', { category: current.category, unit: current.unit, parLevel: current.parLevel })}</Text>
            <Text style={{ color: colors.muted }}>{t('barStock.count.currentOnHand', { onHand: current.onHand })}</Text>
            <TextInput
              label={t('barStock.count.actualCount')}
              value={countValue}
              onChangeText={setCountValue}
              keyboardType="numeric"
              mode="outlined"
              style={{ backgroundColor: colors.surface }}
              autoFocus
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {countIndex > 0 && (
                <Button compact mode="outlined" textColor={colors.muted} onPress={() => { setCountIndex(countIndex - 1); setCountValue(String(countItems[countIndex - 1].onHand)); }}>{t('barStock.count.back')}</Button>
              )}
              <Button compact mode="outlined" textColor={colors.muted} onPress={() => {
                if (countIndex + 1 < countItems.length) { setCountIndex(countIndex + 1); setCountValue(String(countItems[countIndex + 1].onHand)); }
                else { setCountMode(false); setCountIndex(0); setMessage(t('barStock.messages.countFinishedSkipped')); }
              }}>{t('barStock.count.skip')}</Button>
              <Button mode="contained" buttonColor={colors.primary} onPress={() => void submitCount()} style={{ flex: 1 }}>
                {countIndex + 1 < countItems.length ? t('barStock.count.saveNext') : t('barStock.count.saveFinish')}
              </Button>
            </View>
          </Card.Content>
        </Card>
        <InlineMessage message={message} />
      </ScrollView>
    );
  }

  return (
    <ManagerGate canManage={canManage} profileLoading={profileLoading} feature={t('barStock.header.title')}>
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      <SectionHeader kicker={t('barStock.header.kicker')} title={t('barStock.header.title')} subtitle={t('barStock.header.managerSubtitle')} />

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
          Beverage
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
          Food
        </Button>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {[
          { label: t('barStock.metrics.items'), value: String(items.length), a: accents[0] },
          { label: t('barStock.metrics.belowPar'), value: String(activeLowStockCount), a: accents[4] },
          { label: t('barStock.metrics.valueOnHand'), value: money(activeTotalValueCents), a: accents[2] },
        ].map((metric) => (
          <Card key={metric.label} style={{ backgroundColor: metric.a.bg, width: '31%', flexGrow: 1, borderRadius: radius.sharp }}>
            <Card.Content>
              <Text style={{ color: metric.a.fg, fontSize: 22, fontWeight: '800' }}>{metric.value}</Text>
              <Text style={{ color: colors.charcoal }}>{metric.label}</Text>
            </Card.Content>
          </Card>
        ))}
      </View>

      {/* Count workflow + Export buttons */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <Button
          mode="contained"
          buttonColor={colors.primary}
          icon="clipboard-check"
          disabled={items.length === 0}
          onPress={() => { setCountMode(true); setCountIndex(0); setCountValue(String(countItems[0]?.onHand ?? 0)); setMessage(null); }}
        >
          {t('barStock.actions.startCount')}
        </Button>
        <Button compact mode="outlined" textColor={colors.primary} icon="barcode-scan" onPress={() => void openScanner()}>
          {t('barStock.actions.scanBarcode')}
        </Button>
        <Button compact mode="outlined" textColor={colors.primary} onPress={() => setShowShrinkage((v) => !v)}>
          {showShrinkage ? t('barStock.actions.hideShrinkage') : t('barStock.actions.shrinkageReport')}
        </Button>
        <Button compact mode="outlined" textColor={colors.primary} onPress={() => setShowPurchaseOrder((v) => !v)}>
          {showPurchaseOrder ? t('barStock.actions.hideOrder') : t('barStock.actions.purchaseOrder')}
        </Button>
        <Button compact mode="outlined" textColor={colors.primary} onPress={() => setShowStockCsv((v) => !v)}>
          {showStockCsv ? t('barStock.actions.hideStockCsv') : t('barStock.actions.exportStock')}
        </Button>
        <Button compact mode="outlined" textColor={colors.primary} onPress={() => setShowMovementCsv((v) => !v)}>
          {showMovementCsv ? t('barStock.actions.hideLogCsv') : t('barStock.actions.exportMovementLog')}
        </Button>
        <Button compact mode="outlined" textColor={colors.primary} onPress={() => setShowAgingReport((v) => !v)}>
          {showAgingReport ? t('barStock.actions.hideAging') : t('barStock.actions.agingReport')}
        </Button>
        <Button compact mode="outlined" textColor={colors.primary} icon="email-send-outline" onPress={async () => {
          setBusy(true); setMessage(null);
          try {
            const r = await sendDigest({});
            setMessage(r.sent ? t('barStock.messages.digestEmailed', { belowPar: r.belowParCount, shrinkage: `$${(r.shrinkageCents / 100).toFixed(2)}` }) : t('barStock.messages.digestNotSent'));
          } catch (e) { setMessage(errorMessage(e, t('barStock.messages.errorSendDigest'))); }
          finally { setBusy(false); }
        }}>
          {t('barStock.actions.emailDigest')}
        </Button>
      </View>

      <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing.sm }}>
            <View style={{ flex: 1, minWidth: 220 }}>
              <Text variant="titleMedium" style={{ fontWeight: '700' }}>{t('barStock.prep.title')}</Text>
              <Text style={{ color: colors.muted }}>
                {t('barStock.prep.subtitle')}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              <Chip compact>{t('barStock.prep.prepCount', { count: prepBoard?.prepCount ?? 0 })}</Chip>
              <Chip compact style={{ backgroundColor: (prepBoard?.eightySixCount ?? 0) > 0 ? accents[4].bg : accents[2].bg }}>
                {t('barStock.prep.eightySixCount', { count: prepBoard?.eightySixCount ?? 0 })}
              </Chip>
            </View>
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <Chip selected={prepKind === 'prep'} onPress={() => setPrepKind('prep')}>{t('barStock.prep.prepChip')}</Chip>
            <Chip selected={prepKind === 'eighty_six'} onPress={() => setPrepKind('eighty_six')}>{t('barStock.prep.eightySixChip')}</Chip>
          </View>

          <TextInput
            label={prepKind === 'prep' ? t('barStock.prep.prepItemLabel') : t('barStock.prep.eightySixItemLabel')}
            value={prepTitle}
            onChangeText={setPrepTitle}
            mode="outlined"
            style={{ backgroundColor: colors.surface }}
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            <TextInput label={t('barStock.prep.qtyLabel')} value={prepQuantity} onChangeText={setPrepQuantity} keyboardType="numeric" mode="outlined" style={{ flexGrow: 1, flexBasis: 90, backgroundColor: colors.surface }} />
            <TextInput label={t('barStock.prep.unitLabel')} value={prepUnit} onChangeText={setPrepUnit} mode="outlined" style={{ flexGrow: 1, flexBasis: 110, backgroundColor: colors.surface }} />
            <TextInput label={t('barStock.prep.stationLabel')} value={prepStation} onChangeText={setPrepStation} mode="outlined" style={{ flexGrow: 1, flexBasis: 130, backgroundColor: colors.surface }} />
            <TextInput label={t('barStock.prep.dueDateLabel')} placeholder="YYYY-MM-DD" value={prepDueDate} onChangeText={setPrepDueDate} mode="outlined" style={{ flexGrow: 1, flexBasis: 140, backgroundColor: colors.surface }} />
          </View>
          <TextInput label={t('barStock.prep.notesLabel')} value={prepNotes} onChangeText={setPrepNotes} mode="outlined" style={{ backgroundColor: colors.surface }} />
          <Button mode="contained" buttonColor={colors.primary} icon={prepKind === 'prep' ? 'clipboard-plus-outline' : 'minus-circle-outline'} onPress={() => void savePrepBoardItem()} style={{ alignSelf: 'flex-start' }}>
            {t('barStock.prep.addToBoard')}
          </Button>

          {activeEightySixItems.length > 0 ? (
            <View style={{ gap: spacing.xs }}>
              <Text style={{ color: colors.danger, fontWeight: '800' }}>{t('barStock.prep.eightySixListTitle')}</Text>
              {activeEightySixItems.map((item) => (
                <View key={item._id} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: 4 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: '700' }}>{item.title}</Text>
                      <Text style={{ color: colors.muted }}>
                        {[item.station, item.quantity != null ? `${item.quantity} ${item.unit ?? ''}`.trim() : null, item.dueDate].filter(Boolean).join(' - ') || t('barStock.prep.noStationAssigned')}
                      </Text>
                      {item.notes ? <Text style={{ color: colors.muted, fontSize: 12 }}>{item.notes}</Text> : null}
                    </View>
                    <Button compact mode="outlined" textColor={colors.primary} onPress={() => void setPrepBoardStatus(item._id, 'done')}>{t('barStock.prep.done')}</Button>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          <View style={{ gap: spacing.xs }}>
            <Text style={{ fontWeight: '800' }}>{t('barStock.prep.prepListTitle')}</Text>
            {activePrepItems.length === 0 ? (
              <Text style={{ color: colors.muted }}>{t('barStock.prep.noOpenPrepItems')}</Text>
            ) : (
              activePrepItems.map((item) => (
                <View key={item._id} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: 4 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: '700' }}>{item.title}</Text>
                      <Text style={{ color: colors.muted }}>
                        {[item.station, item.quantity != null ? `${item.quantity} ${item.unit ?? ''}`.trim() : null, item.dueDate].filter(Boolean).join(' - ') || t('barStock.prep.noStationAssigned')}
                      </Text>
                      {item.notes ? <Text style={{ color: colors.muted, fontSize: 12 }}>{item.notes}</Text> : null}
                    </View>
                    <Button compact mode="outlined" textColor={colors.primary} onPress={() => void setPrepBoardStatus(item._id, 'done')}>{t('barStock.prep.done')}</Button>
                  </View>
                </View>
              ))
            )}
          </View>
        </Card.Content>
      </Card>

      {/* Scanned item result */}
      {scannedItem && (
        <Card style={{ backgroundColor: accents[0].bg, borderRadius: radius.sharp }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text variant="titleMedium" style={{ color: accents[0].fg, fontWeight: '700' }}>{t('barStock.scan.scannedName', { name: scannedItem.name })}</Text>
              <Button compact mode="text" textColor={accents[0].fg} onPress={() => setScannedItem(null)}>✕</Button>
            </View>
            <Text style={{ color: colors.charcoal }}>{scannedItem.category} · {scannedItem.area ?? t('barStock.list.unassigned')} · {money(scannedItem.unitCostCents)} / {scannedItem.unit}</Text>
            <Text style={{ color: colors.charcoal }}>{t('barStock.scan.onHandPar', { onHand: scannedItem.onHand, parLevel: scannedItem.parLevel })}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              <Button compact mode="contained" buttonColor={colors.success} onPress={() => { void recordInventoryMovement(scannedItem._id, 'received', 1); }}>{t('barStock.scan.plusOneReceived')}</Button>
              <Button compact mode="contained" buttonColor={colors.danger} onPress={() => { void recordInventoryMovement(scannedItem._id, 'waste', -1); }}>{t('barStock.scan.minusOneWaste')}</Button>
              <Button compact mode="outlined" textColor={colors.muted} onPress={() => setScannedItem(null)}>{t('barStock.scan.dismiss')}</Button>
            </View>
          </Card.Content>
        </Card>
      )}
      {scanMsg && !showScanner && <Text style={{ color: colors.danger }}>{scanMsg}</Text>}

      {/* Shrinkage / variance report */}
      {showShrinkage && <ShrinkageCard data={shrinkageData} />}

      {/* Purchase order */}
      {showPurchaseOrder && (
        <PurchaseOrderCard
          purchaseOrder={purchaseOrder}
          csv={purchaseOrderCsv}
          showCsv={showPurchaseOrderCsv}
          busy={busy}
          onToggleCsv={() => setShowPurchaseOrderCsv((v) => !v)}
          onEmail={async () => {
            setBusy(true); setMessage(null);
            try {
              const r = await sendPoEmail({});
              setMessage(r.sent ? t('barStock.messages.poEmailed', { count: r.itemCount }) : r.reason ?? t('barStock.messages.notSent'));
            } catch (e) { setMessage(errorMessage(e, t('barStock.messages.errorSendPoEmail'))); }
            finally { setBusy(false); }
          }}
        />
      )}

      {/* Aging report */}
      {showAgingReport && <AgingCard report={agingReport} />}

      {showStockCsv && (
        <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleMedium" style={{ fontWeight: '700' }}>{t('barStock.csv.stockSnapshotTitle')}</Text>
            <Text selectable style={{ color: colors.charcoal, fontFamily: 'monospace', fontSize: 12 }}>
              {stockCsv ?? t('barStock.csv.loadingExport')}
            </Text>
          </Card.Content>
        </Card>
      )}

      {showMovementCsv && (
        <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleMedium" style={{ fontWeight: '700' }}>{t('barStock.csv.movementLogTitle')}</Text>
            <Text selectable style={{ color: colors.charcoal, fontFamily: 'monospace', fontSize: 12 }}>
              {movementCsv ?? t('barStock.csv.loadingExport')}
            </Text>
          </Card.Content>
        </Card>
      )}

      {/* Usage velocity */}
      <VelocityCard velocity={velocity} />

      <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>{t('barStock.import.title')}</Text>
          <TextInput label={t('barStock.import.pasteLabel')} value={parseText} onChangeText={setParseText} mode="outlined" multiline style={{ backgroundColor: colors.surface }} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            <Button mode="contained" buttonColor={colors.primary} loading={busy} onPress={() => void parseWithAi()}>{t('barStock.import.parseText')}</Button>
            <Button mode="outlined" textColor={colors.primary} disabled={busy} onPress={() => void pickCsv()}>{t('barStock.import.uploadCsv')}</Button>
            <Button mode="outlined" textColor={colors.primary} disabled={busy} onPress={() => void pickPhoto()}>{t('barStock.import.photoInvoice')}</Button>
          </View>
          {parseNotes ? <Text style={{ color: colors.muted }}>{parseNotes}</Text> : null}
          {parsedItems.length > 0 ? (
            <View style={{ gap: spacing.sm }}>
              <Text style={{ fontWeight: '700' }}>{t('barStock.import.reviewParsedItems')}</Text>
              {parsedItems.slice(0, 8).map((item, index) => (
                <View key={`${item.name}-${index}`} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm }}>
                  <Text style={{ fontWeight: '700' }}>{item.name}</Text>
                  <Text style={{ color: colors.muted }}>{t('barStock.import.parsedLine', { category: item.category, onHand: item.onHand ?? 0, unit: item.unit, parLevel: item.parLevel ?? 0 })}</Text>
                </View>
              ))}
              <Button mode="contained" buttonColor={colors.primary} loading={busy} onPress={() => void importItems()}>{t('barStock.import.importParsedItems')}</Button>
            </View>
          ) : null}
          <InlineMessage message={message} />
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>{t('barStock.form.title')}</Text>
          <TextInput label={t('barStock.form.nameLabel')} value={name} onChangeText={setName} mode="outlined" style={{ backgroundColor: colors.surface }} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {(activeTab === 'beverage' 
              ? (['spirit', 'wine', 'beer', 'mixer', 'garnish', 'supply', 'other'] as const) 
              : foodCategories
            ).map((item) => (
              <Chip key={item} selected={category === item} onPress={() => setCategory(item)}>{item}</Chip>
            ))}
          </View>
          <View style={addItemRow}>
            <TextInput label={t('barStock.form.areaLabel')} value={area} onChangeText={setArea} mode="outlined" style={addItemWideField} />
            <TextInput label={t('barStock.form.unitLabel')} value={unit} onChangeText={setUnit} mode="outlined" style={addItemWideField} />
          </View>
          <View style={addItemRow}>
            <TextInput label={t('barStock.form.parLabel')} value={parLevel} onChangeText={setParLevel} keyboardType="numeric" mode="outlined" style={addItemNumberField} />
            <TextInput label={t('barStock.form.onHandLabel')} value={onHand} onChangeText={setOnHand} keyboardType="numeric" mode="outlined" style={addItemNumberField} />
            <TextInput label={t('barStock.form.unitCostLabel')} value={unitCost} onChangeText={setUnitCost} keyboardType="numeric" mode="outlined" style={addItemNumberField} />
          </View>
          <TextInput label={t('barStock.form.supplierLabel')} value={supplier} onChangeText={setSupplier} mode="outlined" style={{ backgroundColor: colors.surface }} />
          <TextInput label={t('barStock.form.notesLabel')} value={notes} onChangeText={setNotes} mode="outlined" style={{ backgroundColor: colors.surface }} />
          <Button mode="contained" buttonColor={colors.primary} loading={busy} onPress={() => void saveManualItem()}>{t('barStock.form.saveItem')}</Button>
        </Card.Content>
      </Card>

      {lowItems.length > 0 ? (
        <Card style={{ backgroundColor: accents[4].bg, borderRadius: radius.sharp }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleMedium" style={{ color: accents[4].fg, fontWeight: '700' }}>{t('barStock.list.reorderListTitle')}</Text>
            {lowItems.slice(0, 8).map((item) => (
              <Text key={item._id} style={{ color: colors.charcoal }}>{t('barStock.list.reorderLine', { name: item.name, onHand: item.onHand, unit: item.unit, parLevel: item.parLevel })}</Text>
            ))}
          </Card.Content>
        </Card>
      ) : null}

      <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>{t('barStock.list.stockListTitle')}</Text>
          {items.length === 0 ? (
            <Text style={{ color: colors.muted }}>{t('barStock.list.empty')}</Text>
          ) : (
            inventoryRowsForWindow(items, visibleItemCount).map((item) => (
              <View key={item._id} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: 4 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700' }}>{item.name}</Text>
                    <Text style={{ color: colors.muted }}>{item.category} · {item.area ?? t('barStock.list.unassigned')} · {money(item.unitCostCents)} / {item.unit}</Text>
                  </View>
                  <Chip compact style={{ backgroundColor: item.onHand <= item.parLevel ? accents[4].bg : accents[2].bg }}>
                    {item.onHand} / {item.parLevel}
                  </Chip>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  <Button compact mode="outlined" textColor={colors.primary} onPress={() => { setCountMode(true); setCountIndex(Math.max(0, countItems.findIndex((row) => row._id === item._id))); setCountValue(String(item.onHand)); setMessage(null); }}>{t('barStock.list.count')}</Button>
                  <Button compact mode="outlined" textColor={colors.primary} onPress={() => void recordInventoryMovement(item._id, 'received', 1)}>{t('barStock.list.plusOne')}</Button>
                  <Button compact mode="outlined" textColor={colors.primary} onPress={() => void recordInventoryMovement(item._id, 'waste', -1)}>{t('barStock.list.minusOne')}</Button>
                  <Button compact mode="outlined" textColor={colors.muted} onPress={() => setHistoryItemId(historyItemId === item._id ? null : item._id)}>
                    {historyItemId === item._id ? t('barStock.list.hideHistory') : t('barStock.list.history')}
                  </Button>
                  <Button compact mode="outlined" textColor={colors.muted} onPress={() => {
                    if (costHistoryItemId === item._id) { setCostHistoryItemId(null); return; }
                    setCostHistoryItemId(item._id);
                  }}>
                    {costHistoryItemId === item._id ? t('barStock.list.hidePrice') : t('barStock.list.priceHistory')}
                  </Button>
                  <Button compact mode="outlined" textColor={colors.muted} onPress={() => {
                    if (editCostItemId === item._id) { setEditCostItemId(null); return; }
                    setEditCostItemId(item._id);
                    setEditCostValue(item.unitCostCents != null ? (item.unitCostCents / 100).toFixed(2) : '');
                  }}>
                    {t('barStock.list.updateCost')}
                  </Button>
                </View>
                {editCostItemId === item._id && (
                  <View style={{ flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.xs }}>
                    <TextInput
                      label={t('barStock.list.newUnitCostLabel')}
                      value={editCostValue}
                      onChangeText={setEditCostValue}
                      keyboardType="numeric"
                      mode="outlined"
                      dense
                      style={{ flex: 1, backgroundColor: colors.surface }}
                    />
                    <Button compact mode="contained" buttonColor={colors.primary} onPress={() => void saveCostUpdate(item._id)}>{t('barStock.list.save')}</Button>
                    <Button compact mode="text" textColor={colors.muted} onPress={() => setEditCostItemId(null)}>{t('barStock.list.cancel')}</Button>
                  </View>
                )}
                {historyItemId === item._id && venue?.id && (
                  <View style={{ paddingLeft: spacing.sm, paddingTop: spacing.xs }}>
                    <MovementTimeline itemId={item._id} />
                  </View>
                )}
                {costHistoryItemId === item._id && (
                  <View style={{ paddingLeft: spacing.sm, paddingTop: spacing.xs, gap: 4 }}>
                    {!costHistory ? (
                      <Text style={{ color: colors.muted, fontSize: 12 }}>{t('barStock.list.loadingPriceHistory')}</Text>
                    ) : costHistory.entries.length === 0 ? (
                      <Text style={{ color: colors.muted, fontSize: 12 }}>{t('barStock.list.noPriceHistory', { cost: money(costHistory.currentCostCents) })}</Text>
                    ) : (
                      costHistory.entries.map((entry) => (
                        <View key={entry._id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                          <View>
                            <Text style={{ fontSize: 12 }}>
                              {money(entry.oldCostCents)} → <Text style={{ fontWeight: '700', color: entry.newCostCents > entry.oldCostCents ? colors.danger : colors.success }}>{money(entry.newCostCents)}</Text>
                            </Text>
                            <Text style={{ color: colors.muted, fontSize: 11 }}>{entry.changedBy}</Text>
                          </View>
                          <Text style={{ color: colors.muted, fontSize: 11 }}>
                            {new Date(entry.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
                          </Text>
                        </View>
                      ))
                    )}
                  </View>
                )}
              </View>
            ))
          )}
          {visibleItemCount < items.length ? (
            <Button
              mode="outlined"
              textColor={colors.primary}
              onPress={() => setVisibleItemCount((count) => nextInventoryWindow(count, items.length))}
            >
              {t('barStock.list.showMore', { remaining: items.length - visibleItemCount })}
            </Button>
          ) : null}
        </Card.Content>
      </Card>
    </ScrollView>
    </ManagerGate>
  );
}
