// Memoized presentational cards extracted from app/(tabs)/bar-stock.tsx.
// These render heavy query-driven data (velocity, shrinkage, purchase order,
// aging, movement history, location breakdown). Wrapping them in React.memo
// means they no longer re-render when unrelated screen state changes.
import { memo } from 'react';
import { View } from 'react-native';
import { Button, Card, Chip, Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '../../lib/railway-hooks';
import { api } from '../../lib/railway-api';
import { accents, colors, radius, spacing } from '../../lib/theme';
import {
  money,
  type AgingReport,
  type LocationStockSummary,
  type MovementRow,
  type PurchaseOrderData,
  type ShrinkageData,
  type VelocityRow,
} from '../../lib/bar-inventory-types';

const MOVEMENT_LABELS: Record<string, string> = {
  count: 'Count Audit',
  received: 'Stock Received',
  waste: 'Waste Logged',
  comp: 'Comp / Spill',
  transfer: 'Inter-Location Transfer',
  correction: 'Correction',
};

const MOVEMENT_COLORS: Record<string, string> = {
  count: colors.primary,
  received: colors.success,
  waste: colors.danger,
  comp: colors.warning,
  transfer: '#6366F1', // Indigo for transfers
  correction: colors.muted,
};

export const MovementTimeline = memo(function MovementTimeline({ itemId }: { itemId: string }) {
  const data = useQuery(api.barInventory.getItemMovements, { itemId, limit: 30 }) as
    | { itemName: string; movements: MovementRow[] }
    | null
    | undefined;
  if (!data) return <Text style={{ color: colors.muted }}>Loading history...</Text>;
  if (data.movements.length === 0) return <Text style={{ color: colors.muted }}>No movements recorded yet.</Text>;
  return (
    <View style={{ gap: 2 }}>
      {data.movements.map((m) => {
        const color = MOVEMENT_COLORS[m.movementType] ?? colors.muted;
        const date = new Date(m.createdAt);
        const isTransfer = m.movementType === 'transfer' || m.notes?.includes('[transfer:');
        return (
          <View key={m._id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, marginTop: 5 }} />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontWeight: '700', color, fontSize: 13 }}>
                  {MOVEMENT_LABELS[m.movementType] ?? m.movementType}
                  {m.movementType !== 'count' && !isTransfer ? ` ${m.quantity > 0 ? '+' : ''}${m.quantity}` : ` → ${m.nextOnHand}`}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 11 }}>
                  {m.previousOnHand} → {m.nextOnHand}
                </Text>
              </View>
              <Text style={{ color: colors.muted, fontSize: 11 }}>
                {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} {date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · {m.createdBy}
              </Text>
              {m.notes ? (
                <View style={{ marginTop: 2 }}>
                  <Text style={{ color: colors.charcoal, fontSize: 12 }}>{m.notes}</Text>
                </View>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
});

export const LocationBreakdownCard = memo(function LocationBreakdownCard({
  summaries,
  activeArea,
  onSelectArea,
}: {
  summaries: LocationStockSummary[] | undefined;
  activeArea: string;
  onSelectArea: (area: string) => void;
}) {
  if (!summaries || summaries.length === 0) return null;
  return (
    <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
      <Card.Content style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <MaterialCommunityIcons name="domain" size={20} color={colors.primary} />
            <Text variant="titleMedium" style={{ fontWeight: '700' }}>Venue Outlet Breakdown</Text>
          </View>
          <Chip compact style={{ backgroundColor: accents[0].bg }}>
            {summaries.length} Locations
          </Chip>
        </View>
        <Text style={{ color: colors.muted, fontSize: 12 }}>
          Live stock distribution across concession stands, suites, bars, and central warehouse.
        </Text>

        <View style={{ gap: spacing.xs, marginTop: 4 }}>
          {summaries.map((loc) => {
            const isSelected = activeArea.toLowerCase() === loc.area.toLowerCase();
            return (
              <View
                key={loc.area}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingVertical: 8,
                  paddingHorizontal: 10,
                  backgroundColor: isSelected ? `${colors.primary}12` : 'transparent',
                  borderRadius: radius.sharp,
                  borderWidth: 1,
                  borderColor: isSelected ? colors.primary : colors.border,
                }}
              >
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ fontWeight: '700', fontSize: 13, color: isSelected ? colors.primary : colors.charcoal }}>
                      {loc.area}
                    </Text>
                    {loc.belowParCount > 0 && (
                      <Chip compact style={{ backgroundColor: accents[4].bg, height: 20 }}>
                        <Text style={{ color: accents[4].fg, fontSize: 10, fontWeight: '700' }}>{loc.belowParCount} low</Text>
                      </Chip>
                    )}
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>
                    {loc.itemCount} items · {loc.totalUnits} total units · {money(loc.totalValueCents)}
                  </Text>
                </View>
                <Button
                  compact
                  mode={isSelected ? 'contained' : 'outlined'}
                  buttonColor={isSelected ? colors.primary : undefined}
                  textColor={isSelected ? '#fff' : colors.primary}
                  onPress={() => onSelectArea(isSelected ? 'all' : loc.area)}
                  style={{ borderRadius: 6 }}
                >
                  {isSelected ? 'Viewing' : 'Filter'}
                </Button>
              </View>
            );
          })}
        </View>
      </Card.Content>
    </Card>
  );
});

export const EventStockoutRiskCard = memo(function EventStockoutRiskCard({
  velocity,
  activeMultiplier,
}: {
  velocity: VelocityRow[] | null | undefined;
  activeMultiplier: number;
}) {
  if (!velocity || velocity.length === 0) return null;

  // Filter items with burn rate or low days until empty
  const riskItems = velocity
    .filter((v) => v.daysUntilEmpty !== null && v.daysUntilEmpty <= (7 * activeMultiplier))
    .sort((a, b) => (a.daysUntilEmpty ?? 999) - (b.daysUntilEmpty ?? 999))
    .slice(0, 8);

  if (riskItems.length === 0) return null;

  return (
    <Card style={{ backgroundColor: '#FEF2F2', borderColor: '#FECACA', borderWidth: 1, borderRadius: 16 }}>
      <Card.Content style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <MaterialCommunityIcons name="alert-decagram" size={20} color={colors.danger} />
            <Text variant="titleMedium" style={{ fontWeight: '800', color: colors.danger }}>
              Event Stockout Warnings
            </Text>
          </View>
          <Chip compact style={{ backgroundColor: `${colors.danger}22` }}>
            <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 11 }}>
              {activeMultiplier > 1 ? `${activeMultiplier}x Event Surge` : 'High Velocity'}
            </Text>
          </Chip>
        </View>
        <Text style={{ color: '#991B1B', fontSize: 12 }}>
          Items projected to deplete rapidly based on active 4-week consumption and event par multiplier.
        </Text>

        <View style={{ gap: 4, marginTop: 4 }}>
          {riskItems.map((item) => (
            <View key={item._id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#FEE2E2' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700', fontSize: 13, color: '#7F1D1D' }}>{item.name}</Text>
                <Text style={{ color: '#991B1B', fontSize: 11 }}>
                  On hand: {item.onHand} {item.unit} · Par: {Math.round(item.parLevel * activeMultiplier)} · Velocity: {item.perWeek}/wk
                </Text>
              </View>
              <View style={{ backgroundColor: '#EF4444', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 11 }}>
                  {item.daysUntilEmpty !== null ? `${item.daysUntilEmpty}d left` : 'Critical'}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </Card.Content>
    </Card>
  );
});

export const VelocityCard = memo(function VelocityCard({ velocity }: { velocity: VelocityRow[] | null | undefined }) {
  if (!velocity || velocity.length === 0 || !velocity.some((v) => v.perWeek > 0)) return null;
  return (
    <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
      <Card.Content style={{ gap: spacing.sm }}>
        <Text variant="titleMedium" style={{ fontWeight: '700' }}>Usage Velocity & Depletion</Text>
        <Text style={{ color: colors.muted, fontSize: 12 }}>4-week rolling consumption across all stadium outlets.</Text>
        {velocity
          .filter((v) => v.perWeek > 0)
          .sort((a, b) => (a.daysUntilEmpty ?? Infinity) - (b.daysUntilEmpty ?? Infinity))
          .slice(0, 12)
          .map((v) => {
            const urgent = v.daysUntilEmpty !== null && v.daysUntilEmpty <= 7;
            const warning = v.daysUntilEmpty !== null && v.daysUntilEmpty <= 14;
            return (
              <View key={v._id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '600', fontSize: 13 }}>{v.name}</Text>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>{v.perWeek} {v.unit}/wk · {v.usageLast4Weeks} used in 4wk</Text>
                </View>
                <View style={{ backgroundColor: urgent ? `${colors.danger}22` : warning ? `${colors.warning}22` : `${colors.success}22`, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Text style={{ color: urgent ? colors.danger : warning ? colors.warning : colors.success, fontWeight: '700', fontSize: 12 }}>
                    {v.daysUntilEmpty !== null ? `${v.daysUntilEmpty}d left` : 'N/A'}
                  </Text>
                </View>
              </View>
            );
          })}
      </Card.Content>
    </Card>
  );
});

export const ShrinkageCard = memo(function ShrinkageCard({ data }: { data: ShrinkageData | null | undefined }) {
  return (
    <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
      <Card.Content style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Shrinkage & Waste Report (30 days)</Text>
          {data?.totals.totalShrinkageCents ? (
            <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 16 }}>
              {money(data.totals.totalShrinkageCents)}
            </Text>
          ) : null}
        </View>

        {!data ? (
          <Text style={{ color: colors.muted }}>Loading...</Text>
        ) : data.rows.length === 0 ? (
          <Text style={{ color: colors.muted }}>No waste or comp movements recorded in the past 30 days.</Text>
        ) : (
          <>
            {data.reasonBreakdown && data.reasonBreakdown.length > 0 && (
              <View style={{ backgroundColor: colors.background, padding: spacing.sm, borderRadius: radius.sharp, gap: 6, marginVertical: 4 }}>
                <Text style={{ fontWeight: '700', fontSize: 12, color: colors.charcoal }}>Loss Breakdown by Reason:</Text>
                {data.reasonBreakdown.map((rb) => (
                  <View key={rb.reason} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontSize: 12, color: colors.muted }}>• {rb.label} ({rb.count} logs / {rb.units} units)</Text>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: colors.danger }}>{money(rb.costCents)}</Text>
                  </View>
                ))}
              </View>
            )}

            <Text style={{ fontWeight: '700', fontSize: 12, color: colors.muted, marginTop: 4 }}>Category Summary:</Text>
            {data.rows.map((row) => (
              <View key={row.category} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontWeight: '700', textTransform: 'capitalize' }}>{row.category}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <Text style={{ color: colors.danger, fontWeight: '700' }}>{money(row.totalShrinkageCents)}</Text>
                    {row.shrinkagePct !== null && (
                      <Chip compact style={{ backgroundColor: row.shrinkagePct > 15 ? `${colors.danger}22` : `${colors.warning}22` }}>
                        <Text style={{ color: row.shrinkagePct > 15 ? colors.danger : colors.warning, fontSize: 11, fontWeight: '700' }}>{row.shrinkagePct}%</Text>
                      </Chip>
                    )}
                  </View>
                </View>
                <Text style={{ color: colors.muted, fontSize: 11 }}>
                  Waste {row.wasteUnits} · Comp {row.compUnits} · vs. received {row.receivedUnits}
                </Text>
              </View>
            ))}
          </>
        )}
      </Card.Content>
    </Card>
  );
});

export const PurchaseOrderCard = memo(function PurchaseOrderCard({
  purchaseOrder,
  csv,
  showCsv,
  busy,
  onToggleCsv,
  onEmail,
}: {
  purchaseOrder: PurchaseOrderData | null | undefined;
  csv: string | null | undefined;
  showCsv: boolean;
  busy: boolean;
  onToggleCsv: () => void;
  onEmail: () => void;
}) {
  return (
    <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
      <Card.Content style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Purchase order draft</Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button compact mode="outlined" textColor={colors.primary} onPress={onToggleCsv}>
              {showCsv ? 'Hide CSV' : 'Export CSV'}
            </Button>
            <Button compact mode="contained" buttonColor={colors.primary} icon="email-send-outline" loading={busy} onPress={onEmail}>
              Email PO
            </Button>
          </View>
        </View>
        {!purchaseOrder ? (
          <Text style={{ color: colors.muted }}>Loading...</Text>
        ) : purchaseOrder.itemCount === 0 ? (
          <Text style={{ color: colors.muted }}>All items are at or above par level.</Text>
        ) : (
          <>
            <Text style={{ color: colors.muted }}>{purchaseOrder.itemCount} items below par across {purchaseOrder.groups.length} supplier{purchaseOrder.groups.length !== 1 ? 's' : ''}</Text>
            {purchaseOrder.groups.map((group) => (
              <View key={group.supplier} style={{ gap: 4 }}>
                <Text style={{ fontWeight: '700', color: colors.primary, marginTop: spacing.sm }}>{group.supplier}</Text>
                {group.lines.map((line) => (
                  <View key={line._id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={{ fontWeight: '600', fontSize: 13 }}>{line.name}</Text>
                        {line.isPredictive && (
                          <View style={{ backgroundColor: accents[2].bg, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 }}>
                            <Text style={{ color: accents[2].fg, fontSize: 9, fontWeight: '700' }}>SMART BOOST</Text>
                          </View>
                        )}
                      </View>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>
                        {line.sku ? `SKU: ${line.sku} · ` : ''}{line.onHand} on hand / par {line.parLevel}
                        {line.dailyVelocity > 0 ? ` · Velocity: ${line.dailyVelocity}/day (7d: ${line.predictedDemand})` : ''}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ fontWeight: '700' }}>× {line.qtyToOrder} {line.unit}</Text>
                      {line.lineTotalCents !== null && (
                        <Text style={{ color: colors.muted, fontSize: 11 }}>{money(line.lineTotalCents)}</Text>
                      )}
                    </View>
                  </View>
                ))}
                {group.groupTotalCents > 0 && (
                  <Text style={{ color: colors.muted, textAlign: 'right', fontSize: 12 }}>Subtotal: {money(group.groupTotalCents)}</Text>
                )}
              </View>
            ))}
            {purchaseOrder.grandTotalCents > 0 && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
                <Text style={{ fontWeight: '700' }}>Est. total</Text>
                <Text style={{ fontWeight: '700', color: colors.primary }}>{money(purchaseOrder.grandTotalCents)}</Text>
              </View>
            )}
            {showCsv && (
              <Card style={{ backgroundColor: colors.background, borderRadius: 12, marginTop: spacing.sm }}>
                <Card.Content>
                  <Text selectable style={{ fontFamily: 'monospace', fontSize: 11, color: colors.charcoal }}>
                    {csv ?? 'Loading CSV...'}
                  </Text>
                </Card.Content>
              </Card>
            )}
          </>
        )}
      </Card.Content>
    </Card>
  );
});

export const AgingCard = memo(function AgingCard({ report }: { report: AgingReport | null | undefined }) {
  return (
    <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
      <Card.Content style={{ gap: spacing.sm }}>
        <Text variant="titleMedium" style={{ fontWeight: '700' }}>Inventory aging</Text>
        {!report ? (
          <Text style={{ color: colors.muted }}>Loading...</Text>
        ) : (
          <>
            <Text style={{ fontWeight: '700', color: report.uncountedItems.length > 0 ? colors.warning : colors.muted }}>
              {report.uncountedItems.length} item{report.uncountedItems.length !== 1 ? 's' : ''} not counted in 7+ days
            </Text>
            {report.uncountedItems.slice(0, 8).map((item) => (
              <View key={item._id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <Text style={{ fontSize: 13 }}>{item.name}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  {item.daysSinceCount !== null ? `${item.daysSinceCount}d ago` : 'never counted'}
                </Text>
              </View>
            ))}
            {report.uncountedItems.length > 8 && (
              <Text style={{ color: colors.muted, fontSize: 12 }}>+{report.uncountedItems.length - 8} more</Text>
            )}

            {report.noActivityItems.length > 0 && (
              <>
                <Text style={{ fontWeight: '700', color: colors.muted, marginTop: spacing.sm }}>
                  {report.noActivityItems.length} item{report.noActivityItems.length !== 1 ? 's' : ''} with no movement in 30 days
                </Text>
                {report.noActivityItems.slice(0, 6).map((item) => (
                  <Text key={item._id} style={{ color: colors.charcoal, fontSize: 12 }}>
                    {item.name} — {item.onHand} on hand
                  </Text>
                ))}
              </>
            )}

            {report.staleCostItems.length > 0 && (
              <>
                <Text style={{ fontWeight: '700', color: colors.muted, marginTop: spacing.sm }}>
                  {report.staleCostItems.length} item{report.staleCostItems.length !== 1 ? 's' : ''} missing unit cost
                </Text>
                {report.staleCostItems.slice(0, 6).map((item) => (
                  <Text key={item._id} style={{ color: colors.charcoal, fontSize: 12 }}>{item.name}</Text>
                ))}
              </>
            )}

            {report.uncountedItems.length === 0 && report.noActivityItems.length === 0 && report.staleCostItems.length === 0 && (
              <Text style={{ color: colors.muted }}>All items are up to date.</Text>
            )}
          </>
        )}
      </Card.Content>
    </Card>
  );
});
