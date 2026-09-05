// @vitest-environment jsdom
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PremiumSpacesDirectory } from './PremiumSpacesDirectory';
import { groupPremiumSpaces, type PremiumSpaceGroup } from './premium-spaces';
import { COMPREHENSIVE_STADIUM_ZONES } from './zone-data';

// react-native-paper reaches into Flow-typed React Native source that Node
// cannot parse. The style sheet under test only needs the spacing constants
// from lib/theme, and these themes are read inside a function, never at import.
vi.mock('react-native-paper', () => ({
  MD3DarkTheme: { colors: {} },
  MD3LightTheme: { colors: {} },
}));

// The icon font pulls in native Expo modules that have no place in a DOM test;
// the directory only needs the glyph names to render.
vi.mock('@expo/vector-icons', () => ({
  MaterialCommunityIcons: ({ name }: { name: string }) => <span data-icon={name} />,
}));

// Real venue data, so the test never invents suite names, counts or statuses.
const GROUPS: PremiumSpaceGroup[] = groupPremiumSpaces(COMPREHENSIVE_STADIUM_ZONES);
const SUITES_300 = GROUPS.find((g) => g.id === '300-level-suites')!;
const CLUB_LEVEL = GROUPS.find((g) => g.id === '200-level-clubs')!;

let container: HTMLDivElement;
let root: Root;

function render(ui: React.ReactElement) {
  act(() => {
    root.render(ui);
  });
}

/** Buttons react-native-web emits for Pressable, in document order. */
function buttons(): HTMLElement[] {
  return Array.from(container.querySelectorAll('[role="button"]'));
}

function buttonByLabel(match: string): HTMLElement {
  const found = buttons().find((b) => b.getAttribute('aria-label')?.includes(match));
  if (!found) throw new Error(`No button matching "${match}". Saw: ${buttons().map((b) => b.getAttribute('aria-label')).join(' | ')}`);
  return found;
}

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('PremiumSpacesDirectory', () => {
  it('renders every group collapsed, with no unit rows, when nothing is expanded', () => {
    render(
      <PremiumSpacesDirectory
        groups={GROUPS}
        expandedGroupId={null}
        onToggleGroup={() => {}}
        onSelectUnit={() => {}}
      />,
    );

    const headers = buttons();
    expect(headers).toHaveLength(GROUPS.length);
    for (const header of headers) {
      expect(header.getAttribute('aria-expanded')).toBe('false');
    }

    // The compact list must not render the units of a collapsed group.
    expect(container.textContent).not.toContain(SUITES_300.units[0]!.code);
  });

  it('labels each group header with its title and unit count', () => {
    render(
      <PremiumSpacesDirectory
        groups={GROUPS}
        expandedGroupId={null}
        onToggleGroup={() => {}}
        onSelectUnit={() => {}}
      />,
    );

    const header = buttonByLabel(SUITES_300.title);
    expect(header.getAttribute('aria-label')).toBe(
      `${SUITES_300.title}, ${SUITES_300.units.length} spaces`,
    );
  });

  it('reports the tapped group so the parent can toggle it', () => {
    const onToggleGroup = vi.fn();
    render(
      <PremiumSpacesDirectory
        groups={GROUPS}
        expandedGroupId={null}
        onToggleGroup={onToggleGroup}
        onSelectUnit={() => {}}
      />,
    );

    click(buttonByLabel(CLUB_LEVEL.title));
    expect(onToggleGroup).toHaveBeenCalledWith(CLUB_LEVEL.id);
  });

  it('expands only the named group and marks it expanded', () => {
    render(
      <PremiumSpacesDirectory
        groups={GROUPS}
        expandedGroupId={CLUB_LEVEL.id}
        onToggleGroup={() => {}}
        onSelectUnit={() => {}}
      />,
    );

    expect(buttonByLabel(CLUB_LEVEL.title).getAttribute('aria-expanded')).toBe('true');
    expect(buttonByLabel(SUITES_300.title).getAttribute('aria-expanded')).toBe('false');

    // Club Level's units are on screen; the collapsed 300 group's are not.
    for (const unit of CLUB_LEVEL.units) {
      expect(container.textContent).toContain(unit.code);
    }
    expect(container.textContent).not.toContain(SUITES_300.units[0]!.code);
  });

  it('gives each unit row a status-bearing label and hands the unit back on press', () => {
    const onSelectUnit = vi.fn();
    render(
      <PremiumSpacesDirectory
        groups={GROUPS}
        expandedGroupId={CLUB_LEVEL.id}
        onToggleGroup={() => {}}
        onSelectUnit={onSelectUnit}
      />,
    );

    const unit = CLUB_LEVEL.units[0]!;
    const row = buttonByLabel(`Open ${unit.name}`);

    // Status is conveyed in text, not by colour alone.
    expect(row.getAttribute('aria-label')).toMatch(/^Open .+, status .+$/);

    click(row);
    // The parent receives the same unit identity the visual map would select.
    expect(onSelectUnit).toHaveBeenCalledWith(unit);
  });

  it('filters units by search query and drops groups with no match', () => {
    const unit = SUITES_300.units[0]!;
    render(
      <PremiumSpacesDirectory
        groups={GROUPS}
        expandedGroupId={SUITES_300.id}
        onToggleGroup={() => {}}
        onSelectUnit={() => {}}
        searchQuery={unit.code}
      />,
    );

    expect(buttons().some((b) => b.getAttribute('aria-label')?.includes(CLUB_LEVEL.title))).toBe(
      false,
    );
    expect(buttonByLabel(SUITES_300.title).getAttribute('aria-label')).toBe(
      `${SUITES_300.title}, 1 spaces`,
    );
  });
});
