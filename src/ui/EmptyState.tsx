// What a screen shows when it has nothing to show: say so, and offer the
// next action ("No requests yet. Ask a contact for money").
import { StyleSheet, View } from 'react-native';

import { Button } from './Button';
import { Text } from './Text';
import { space } from './theme';

export type EmptyStateProps = {
  title: string;
  message?: string;
  action?: { label: string; onPress: () => void };
};

export function EmptyState({ title, message, action }: EmptyStateProps) {
  return (
    <View style={styles.root}>
      <Text variant="heading">{title}</Text>
      {message ? (
        <Text variant="body" color="graphite">
          {message}
        </Text>
      ) : null}
      {action ? <Button label={action.label} onPress={action.onPress} variant="secondary" compact /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingVertical: space.xxl, gap: space.m, alignItems: 'flex-start' },
});
