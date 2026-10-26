// Requests tab: Incoming (contacts asked you) and Sent (you asked them),
// each row a payment request with its status in words.
//
// The list is the SDK's observeState snapshot (`paymentRequests`, refreshed
// every sync round), split by local role: payer = Incoming, payee = Sent.
// Newest activity first. The Incoming segment counts the requests waiting
// for your answer. Rows open Request detail.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { MainTabScreenProps } from '../../navigation/types';
import { useConnectionNotice, usePaymentRequests } from '../../paykit';
import { Button, Divider, EmptyState, Screen, SegmentedControl, Text, space } from '../../ui';
import { RequestRow } from './RequestRow';
import { useNow } from './useNow';

type Segment = 'incoming' | 'sent';

export function RequestsScreen({ navigation }: MainTabScreenProps<'Requests'>) {
  const notice = useConnectionNotice();
  const requests = usePaymentRequests();
  const nowMs = useNow(5_000);
  const incoming = requests.filter((r) => r.role === 'payer');
  const sent = requests.filter((r) => r.role === 'payee');
  const [segment, setSegment] = useState<Segment>('incoming');
  const shown = segment === 'incoming' ? incoming : sent;
  const waitingForYou = incoming.filter((r) => r.state === 'proposed').length;

  return (
    <Screen
      scroll
      title="Requests"
      edges={['top']}
      testID="requests-screen"
      headerRight={<Button label="Request" compact variant="secondary" onPress={() => navigation.navigate('RequestMoney')} testID="requests-new" />}
    >
      {notice ? (
        <Text color="graphite">{notice.message}</Text>
      ) : (
        <>
          <SegmentedControl
            accessibilityLabel="Requests"
            value={segment}
            onChange={setSegment}
            options={[
              { value: 'incoming', label: waitingForYou > 0 ? `Incoming (${waitingForYou})` : 'Incoming', testID: 'requests-incoming' },
              { value: 'sent', label: 'Sent', testID: 'requests-sent' },
            ]}
          />
          <View style={styles.list}>
            {shown.length === 0 ? (
              segment === 'incoming' ? (
                <EmptyState
                  title="No requests for you"
                  message="When a contact asks you for money, it shows up here. You can ask them too."
                  action={{ label: 'Request money', onPress: () => navigation.navigate('RequestMoney') }}
                />
              ) : (
                <EmptyState
                  title="No requests yet"
                  message="Ask a contact for money: once, or on a schedule."
                  action={{ label: 'Request money', onPress: () => navigation.navigate('RequestMoney') }}
                />
              )
            ) : (
              shown.map((view, index) => (
                <View key={`${view.counterparty}:${view.requestId}`}>
                  {index > 0 ? <Divider inset={52} /> : null}
                  <RequestRow
                    view={view}
                    nowMs={nowMs}
                    onPress={() => navigation.navigate('RequestDetail', { counterparty: view.counterparty, requestId: view.requestId })}
                  />
                </View>
              ))
            )}
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { marginTop: space.l, marginBottom: space.xl },
});
