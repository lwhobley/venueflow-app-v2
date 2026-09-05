import React, { useState } from 'react';
import { StyleSheet, View, TouchableOpacity, Modal, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useWorkspaceResolution, useSwitchWorkspace } from '../lib/workspace-routing';
import { useAppearanceStore, designPalettes } from '../lib/theme';

export function DepartmentSwitcher() {
  const [modalVisible, setModalVisible] = useState(false);
  const router = useRouter();
  const themeMode = useAppearanceStore((s) => s.mode);
  const palette = designPalettes[themeMode];

  const { data: workspace, isLoading } = useWorkspaceResolution();
  const switchMutation = useSwitchWorkspace();

  if (isLoading || !workspace || !workspace.assigned) {
    return null;
  }

  // If user only belongs to 1 department, show current department badge without switcher modal
  if (workspace.departments.length <= 1) {
    const currentDept = workspace.primaryDepartment ?? workspace.departments[0];
    return (
      <View style={[styles.badgeContainer, { backgroundColor: palette.surface }]}>
        <MaterialCommunityIcons name="domain" size={16} color={palette.primary} />
        <Text variant="labelMedium" style={{ color: palette.charcoal, marginLeft: 6, fontWeight: '600' }}>
          {currentDept?.name ?? 'Assigned'}
        </Text>
      </View>
    );
  }

  const primaryDept = workspace.primaryDepartment;

  const handleSelectDepartment = async (deptId: string, defaultRoute: string) => {
    try {
      await switchMutation.mutateAsync(deptId);
      setModalVisible(false);
      router.replace(defaultRoute as any);
    } catch {
      // Keep state on failure
    }
  };

  return (
    <>
      <TouchableOpacity
        style={[styles.switcherButton, { backgroundColor: palette.surface, borderColor: palette.border }]}
        onPress={() => setModalVisible(true)}
        activeOpacity={0.7}
      >
        <MaterialCommunityIcons name="domain" size={16} color={palette.primary} />
        <Text variant="labelMedium" style={{ color: palette.charcoal, marginHorizontal: 6, fontWeight: '600' }}>
          {primaryDept?.name ?? 'Switch Workspace'}
        </Text>
        <MaterialCommunityIcons name="chevron-down" size={16} color={palette.muted} />
      </TouchableOpacity>

      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setModalVisible(false)}
        >
          <View style={[styles.modalContent, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={styles.modalHeader}>
              <Text variant="titleMedium" style={{ color: palette.charcoal, fontWeight: '700' }}>
                Operational Workspaces
              </Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <MaterialCommunityIcons name="close" size={20} color={palette.muted} />
              </TouchableOpacity>
            </View>

            <Text variant="bodySmall" style={{ color: palette.muted, marginBottom: 12 }}>
              Select an authorized department workspace to land in.
            </Text>

            {workspace.departments.map((dept) => {
              const isSelected = dept.id === primaryDept?.id;
              return (
                <TouchableOpacity
                  key={dept.id}
                  style={[
                    styles.deptItem,
                    {
                      backgroundColor: isSelected ? `${palette.primary}15` : 'transparent',
                      borderColor: isSelected ? palette.primary : palette.border,
                    },
                  ]}
                  onPress={() => handleSelectDepartment(dept.id, dept.defaultRoute)}
                  disabled={switchMutation.isPending}
                >
                  <View style={styles.deptItemLeft}>
                    <MaterialCommunityIcons
                      name={isSelected ? 'check-circle' : 'circle-outline'}
                      size={20}
                      color={isSelected ? palette.primary : palette.muted}
                    />
                    <View style={{ marginLeft: 10 }}>
                      <Text variant="bodyMedium" style={{ color: palette.charcoal, fontWeight: isSelected ? '700' : '500' }}>
                        {dept.name}
                      </Text>
                      <Text variant="labelSmall" style={{ color: palette.muted }}>
                        {dept.code.toUpperCase()}
                      </Text>
                    </View>
                  </View>

                  {switchMutation.isPending && isSelected && (
                    <ActivityIndicator size="small" color={palette.primary} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  badgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  switcherButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    elevation: 5,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  deptItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  deptItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
