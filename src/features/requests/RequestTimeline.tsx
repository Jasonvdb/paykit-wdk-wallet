// The vertical status timeline of a payment request:
//
//   ● Requested
//   ● Accepted
//   ◉ Paid (proof)        <- current step: a Seal ring
//   ○ Verified
//   ○ Receipt
//
// Done steps are filled Seal dots joined by a solid line; the current step
// is a Seal ring; steps not reached are Rule rings. Where the request
// ended the normal way (declined, canceled, expired) the dot is Graphite:
// that is an outcome, not an error. Only a failure (a proof that didn't
// check out) is an Alert dot (docs/DESIGN.md: Alert is for errors). The
// steps and their words come from src/paykit/requestStatus.ts
// (requestTimeline).
import { StyleSheet, View } from 'react-native';

import type { TimelineStep } from '../../paykit';
import { Text, colors, space } from '../../ui';

const DOT = 14;

export function RequestTimeline({ steps, testID }: { steps: TimelineStep[]; testID?: string }) {
  return (
    <View testID={testID}>
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        return (
          <View key={step.key} style={styles.step} testID={`timeline-${step.key}-${step.state}`}>
            <View style={styles.rail}>
              <View style={[styles.dot, dotStyle(step.state)]} />
              {last ? null : <View style={[styles.line, step.state === 'done' ? styles.lineDone : styles.lineTodo]} />}
            </View>
            <View style={[styles.text, last ? null : styles.textSpacing]}>
              <Text variant={step.state === 'current' ? 'bodyStrong' : 'body'} color={step.state === 'todo' || step.state === 'ended' ? 'graphite' : step.state === 'failed' ? 'alert' : 'ink'}>
                {step.label}
              </Text>
              {step.detail ? (
                <Text variant="caption" color="graphite">
                  {step.detail}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function dotStyle(state: TimelineStep['state']) {
  switch (state) {
    case 'done':
      return styles.done;
    case 'current':
      return styles.current;
    case 'ended':
      return styles.ended;
    case 'failed':
      return styles.failed;
    default:
      return styles.todo;
  }
}

const styles = StyleSheet.create({
  step: { flexDirection: 'row', gap: space.m },
  rail: { width: DOT, alignItems: 'center' },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, marginTop: 4 },
  done: { backgroundColor: colors.seal },
  current: { borderWidth: 3, borderColor: colors.seal, backgroundColor: colors.sheet },
  todo: { borderWidth: 2, borderColor: colors.rule, backgroundColor: colors.paper },
  ended: { backgroundColor: colors.graphite },
  failed: { backgroundColor: colors.alert },
  line: { width: 2, flex: 1, marginVertical: 2 },
  lineDone: { backgroundColor: colors.seal },
  lineTodo: { backgroundColor: colors.rule },
  text: { flex: 1, gap: 2 },
  textSpacing: { paddingBottom: space.l },
});
