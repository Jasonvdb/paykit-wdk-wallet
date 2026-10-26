// Font loading. Only the weights the design uses are bundled: importing a
// weight's subpath pulls in just that .ttf file.
//
// - Bricolage Grotesque 600 for amounts and titles.
// - Atkinson Hyperlegible Next 400/700 for reading: it keeps confusable
//   characters (0/O, 1/l/I) apart, which matters in a wallet.
// - Atkinson Hyperlegible Mono only for keys, addresses and hashes.
import { useFonts } from 'expo-font';
import { BricolageGrotesque_600SemiBold } from '@expo-google-fonts/bricolage-grotesque/600SemiBold';
import { AtkinsonHyperlegibleNext_400Regular } from '@expo-google-fonts/atkinson-hyperlegible-next/400Regular';
import { AtkinsonHyperlegibleNext_700Bold } from '@expo-google-fonts/atkinson-hyperlegible-next/700Bold';
import { AtkinsonHyperlegibleMono_400Regular } from '@expo-google-fonts/atkinson-hyperlegible-mono/400Regular';

/** Returns true once the fonts are ready (or failed: then system fonts are used). */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts({
    BricolageGrotesque_600SemiBold,
    AtkinsonHyperlegibleNext_400Regular,
    AtkinsonHyperlegibleNext_700Bold,
    AtkinsonHyperlegibleMono_400Regular,
  });
  return loaded || error !== null;
}
