// Memoized presentational cards extracted from app/(tabs)/bar-stock.tsx.
// These render heavy query-driven data (velocity, shrinkage, purchase order,
// aging, movement history). Wrapping them in React.memo means they no longer
// re-render when unrelated screen state changes (e.g. every keystroke in the
// add-item form), which was the main render-cost issue on this screen.
import { memo } from 'react';
import { View } from 'react-native';
import { Button, Card, Chip, Text } from 'react-native-paper';
import { asArray } from '../../lib/format';
import { useQuery } from '../../lib/railway-hooks';
import { api } from '../../lib/railway-api';
import { accents, colors, spacing } from '../../lib/theme';
import {
  money,
  type AgingReport,
  type MovementRow,
  type PurchaseOrderData,
  type ShrinkageData,
  type VelocityRow,
} from '../../lib/bar-inventory-types';

const MOVEMENT_LABELS: Record<string, string> = {
  count: 'Count',
  received: 'Received',
  waste: 'Waste',
  comp: 'Comp',
  transfer: 'Transfer',
  correction: 'Correction',
};

const MOVEMENT_COLORS: Record<string, string> = {
  count: colors.primary,
  received: colors.success,
  waste: colors.danger,
  comp: colors.warning,
  transfer: colors.muted,
  correction: colors.muted,
};

export const MovementTimeline = memo(function MovementTimeline({ itemId }: { itemId: string }) {
  const data = useQuery(api.barInventory.getItemMovements, { itemId, limit: 30 }) as
    | { itemName: string; movements: MovementRow[] }
    | null
    | undefined;
  if (!data) return <Text style={{ color: colors.muted }}>Loading history...</Text>;
  const movements = asArray<MovementRow>(data.movements);
  if (movements.length === 0) return <Text style={{ color: colors.muted }}>No movements recorded yet.</Text>;
  return (
    <View style={{ gap: 2 }}>
      {movements.map((m) => {
        const color = MOVEMENT_COLORS[m.movementType] ?? colors.muted;
        const date = new Date(m.createdAt);
        return (
          <View key={m._id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, marginTop: 5 }} />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontWeight: '700', color, fontSize: 13 }}>
                  {MOVEMENT_LABELS[m.movementType] ?? m.movementType}
                  {m.movementType !== 'count' ? ` ${m.quantity > 0 ? '+' : ''}${m.quantity}` : ` → ${m.nextOnHand}`}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 11 }}>
                  {m.previousOnHand} → {m.nextOnHand}
                </Text>
              </View>
              <Text style={{ color: colors.muted, fontSize: 11 }}>
                {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} {date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · {m.createdBy}
              </Text>
              {m.notes ? <Text style={{ color: colors.charcoal, fontSize: 12 }}>{m.notes}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
});

export const VelocityCard = memo(function VelocityCard({ velocity }: { velocity: VelocityRow[] | null | undefined }) {
  const rows = asArray<VelocityRow>(velocity);
  if (rows.length === 0 || !rows.some((v) => v.perWeek > 0)) return null;
  return (
    <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
      <Card.Content style={{ gap: spacing.sm }}>
        <Text variant="titleMedium" style={{ fontWeight: '700' }}>Usage velocity</Text>
        <Text style={{ color: colors.muted, fontSize: 12 }}>4-week rolling consumption. Items with no recorded usage are hidden.</Text>
        {rows
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
        <Text variant="titleMedium" style={{ fontWeight: '700' }}>Shrinkage report (30 days)</Text>
        {!data ? (
          <Text style={{ color: colors.muted }}>Loading...</Text>
        ) : asArray(data.rows).length === 0 ? (
          <Text style={{ color: colors.muted }}>No waste or comp movements recorded in the past 30 days.</Text>
        ) : (
          <>
            {asArray<ShrinkageData['rows'][number]>(data.rows).map((row) => (
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
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.sm }}>
              <Text style={{ fontWeight: '700' }}>Total shrinkage cost</Text>
              <Text style={{ fontWeight: '700', color: colors.danger }}>{money(data.totals.totalShrinkageCents)}</Text>
            </View>
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
            <Text style={{ color: colors.muted }}>{purchaseOrder.itemCount} items below par across {asArray(purchaseOrder.groups).length} supplier{asArray(purchaseOrder.groups).length !== 1 ? 's' : ''}</Text>
            {asArray<any>(purchaseOrder.groups).map((group: any) => (
              <View key={group.supplier} style={{ gap: 4 }}>
                <Text style={{ fontWeight: '700', color: colors.primary, marginTop: spacing.sm }}>{group.supplier}</Text>
                {asArray<any>(group.lines).map((line: any) => (
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
            <Text style={{ fontWeight: '700', color: asArray<any>(report.uncountedItems).length > 0 ? colors.warning : colors.muted }}>
              {asArray<any>(report.uncountedItems).length} item{asArray<any>(report.uncountedItems).length !== 1 ? 's' : ''} not counted in 7+ days
            </Text>
            {asArray<any>(report.uncountedItems).slice(0, 8).map((item) => (
              <View key={item._id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <Text style={{ fontSize: 13 }}>{item.name}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  {item.daysSinceCount !== null ? `${item.daysSinceCount}d ago` : 'never counted'}
                </Text>
              </View>
            ))}
            {asArray<any>(report.uncountedItems).length > 8 && (
              <Text style={{ color: colors.muted, fontSize: 12 }}>+{asArray<any>(report.uncountedItems).length - 8} more</Text>
            )}

            {asArray<any>(report.noActivityItems).length > 0 && (
              <>
                <Text style={{ fontWeight: '700', color: colors.muted, marginTop: spacing.sm }}>
                  {asArray<any>(report.noActivityItems).length} item{asArray<any>(report.noActivityItems).length !== 1 ? 's' : ''} with no movement in 30 days
                </Text>
                {asArray<any>(report.noActivityItems).slice(0, 6).map((item) => (
                  <Text key={item._id} style={{ color: colors.charcoal, fontSize: 12 }}>
                    {item.name} — {item.onHand} on hand
                  </Text>
                ))}
              </>
            )}

            {asArray<any>(report.staleCostItems).length > 0 && (
              <>
                <Text style={{ fontWeight: '700', color: colors.muted, marginTop: spacing.sm }}>
                  {asArray<any>(report.staleCostItems).length} item{asArray<any>(report.staleCostItems).length !== 1 ? 's' : ''} missing unit cost
                </Text>
                {asArray<any>(report.staleCostItems).slice(0, 6).map((item) => (
                  <Text key={item._id} style={{ color: colors.charcoal, fontSize: 12 }}>{item.name}</Text>
                ))}
              </>
            )}

            {asArray<any>(report.uncountedItems).length === 0 && asArray<any>(report.noActivityItems).length === 0 && asArray<any>(report.staleCostItems).length === 0 && (
              <Text style={{ color: colors.muted }}>All items are up to date.</Text>
            )}
          </>
        )}
      </Card.Content>
    </Card>
  );
});
