// You > Bitcoin from contacts: each contact pays you at their own BTC
// address (a separate WDK account, see src/paykit/addressCache.ts), so the
// money is attributable to them. Sends spend only from the main account
// (index 0), so "Collect" moves a contact account's balance there.
//
// Collect is "almost everything": WDK keeps back a dust-sized change output
// (src/wallet/useBtcContactAccount.ts), so a few hundred sats can stay.
//
// One row component per account, because WDK's account hooks are bound to
// one account index each.
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { shortKey, useContacts, usePaykitService, type PaykitService } from '../../paykit';
import { AssetAmount, Button, Divider, Text, space } from '../../ui';
import { sendErrorMessage, useBtcContactAccount } from '../../wallet';

type ContactAccount = { pubky: string; accountIndex: number };

/** The contact -> BTC account map, kept current as contacts are added. */
function useContactAccounts(service: PaykitService | undefined): ContactAccount[] {
  const [accounts, setAccounts] = useState<ContactAccount[]>(() => service?.addressCache.allContactAccounts() ?? []);
  useEffect(() => {
    if (!service) return;
    const update = () => setAccounts(service.addressCache.allContactAccounts());
    update();
    return service.addressCache.subscribe(update);
  }, [service]);
  return accounts;
}

export function ContactAccountsSection() {
  const service = usePaykitService();
  const accounts = useContactAccounts(service);
  const contacts = useContacts();
  const nameOf = (pubky: string) => contacts.find((contact) => contact.publicKey === pubky)?.name ?? shortKey(pubky);

  return (
    <View style={styles.root}>
      <Text color="graphite" variant="secondary">
        Each contact pays you at their own Bitcoin address. Collect moves that money to your main account so you can spend it.
      </Text>
      {accounts.length === 0 ? (
        <Text color="graphite">{service ? 'No contact accounts yet. Add someone in People.' : 'Connecting…'}</Text>
      ) : (
        accounts.map((account, index) => (
          <View key={account.accountIndex}>
            {index > 0 ? <Divider /> : null}
            <ContactAccountRow name={nameOf(account.pubky)} accountIndex={account.accountIndex} />
          </View>
        ))
      )}
    </View>
  );
}

function ContactAccountRow({ name, accountIndex }: { name: string; accountIndex: number }) {
  const account = useBtcContactAccount(accountIndex);
  const [collecting, setCollecting] = useState(false);
  const [message, setMessage] = useState<{ text: string; explorerUrl?: string; tone: 'graphite' | 'alert' }>();

  const onCollect = async () => {
    setCollecting(true);
    setMessage(undefined);
    try {
      const result = await account.collect();
      if (result) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setMessage({ text: 'Moving to your main account. It arrives with the next block.', explorerUrl: result.explorerUrl, tone: 'graphite' });
      } else {
        setMessage({ text: 'Too little to move: it would all go to the network fee.', tone: 'graphite' });
      }
    } catch (e) {
      setMessage({ text: sendErrorMessage(e, 'btc'), tone: 'alert' });
    } finally {
      setCollecting(false);
    }
  };

  const explorerUrl = message?.explorerUrl;
  return (
    <View style={styles.row} testID={`contact-account-${accountIndex}`}>
      <View style={styles.rowTop}>
        <View style={styles.rowText}>
          <Text numberOfLines={1}>{name}</Text>
          <Text variant="caption" color="graphite">
            Account {accountIndex}
          </Text>
        </View>
        <AssetAmount value={account.sats} asset="btc" size="small" />
      </View>
      <View style={styles.actions}>
        <Button
          label="Collect"
          variant="secondary"
          compact
          onPress={onCollect}
          loading={collecting}
          disabled={!account.sats}
          testID={`collect-${accountIndex}`}
        />
        <Button label="Refresh" variant="secondary" compact onPress={() => void account.refresh().catch(() => undefined)} disabled={collecting} />
      </View>
      {message ? (
        <View style={styles.message}>
          <Text variant="caption" color={message.tone}>
            {message.text}
          </Text>
          {explorerUrl ? <Button label="View on explorer" variant="secondary" compact onPress={() => void Linking.openURL(explorerUrl)} /> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.m },
  row: { paddingVertical: space.m, gap: space.s },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  rowText: { flex: 1 },
  actions: { flexDirection: 'row', gap: space.s },
  message: { gap: space.s, alignItems: 'flex-start' },
});
