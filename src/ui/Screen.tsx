// The frame of every screen: Paper background, safe area, 20 pt side
// margins, left-aligned content, and a header with an optional title and the
// persistent Testnet chip.
//
// `scroll` wraps content in a ScrollView (with optional pull to refresh);
// `footer` pins actions to the bottom, above the home indicator.
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { TestnetChip } from './Chip';
import { Text } from './Text';
import { colors, SCREEN_MARGIN, space } from './theme';

export type ScreenProps = {
  title?: string;
  /** Element left of the Testnet chip (e.g. a seal, a close button). */
  headerLeft?: ReactNode;
  headerRight?: ReactNode;
  /** Hide the header row entirely (e.g. inside a native-stack header). */
  hideHeader?: boolean;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  footer?: ReactNode;
  /** Which safe-area edges to pad. Tab screens skip the bottom (the tab bar handles it). */
  edges?: Edge[];
  children: ReactNode;
  testID?: string;
};

export function Screen({
  title,
  headerLeft,
  headerRight,
  hideHeader,
  scroll,
  refreshing,
  onRefresh,
  footer,
  edges = ['top', 'bottom'],
  children,
  testID,
}: ScreenProps) {
  const header = hideHeader ? null : (
    <View style={styles.header}>
      <View style={styles.headerLeft}>{headerLeft}</View>
      <View style={styles.headerRight}>
        {headerRight}
        <TestnetChip />
      </View>
    </View>
  );
  const titleView = title ? (
    <Text variant="title" accessibilityRole="header" style={styles.title}>
      {title}
    </Text>
  ) : null;

  return (
    <SafeAreaView style={styles.root} edges={edges} testID={testID}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {header}
        {scroll ? (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}
          >
            {titleView}
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.flex, styles.content]}>
            {titleView}
            {children}
          </View>
        )}
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SCREEN_MARGIN,
    paddingTop: space.s,
    minHeight: 44,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: space.s, flexShrink: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  title: { marginBottom: space.l },
  content: { paddingHorizontal: SCREEN_MARGIN, paddingTop: space.l },
  scrollContent: { paddingHorizontal: SCREEN_MARGIN, paddingTop: space.l, paddingBottom: space.xxl },
  footer: { paddingHorizontal: SCREEN_MARGIN, paddingTop: space.m, paddingBottom: space.m, gap: space.s },
});
