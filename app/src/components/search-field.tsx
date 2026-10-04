import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { C, F, R } from '@/constants/theme';
import { useStore } from '@/lib/store';
import { CHROME_MAX } from '@/lib/text-scale';

const LABEL = 'Search classes, groups and places';

/** The one search box, on the list and on the map. What is typed is shared between them. */
export function SearchField() {
  const { query, setQuery } = useStore();
  return (
    <View style={s.search}>
      <SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={18} tintColor={C.muted} />
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={LABEL}
        placeholderTextColor={C.muted}
        returnKeyType="search"
        autoCorrect={false}
        maxFontSizeMultiplier={CHROME_MAX}
        style={s.input}
        accessibilityLabel={LABEL}
      />
      {!!query && (
        <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
          <SymbolView name={{ ios: 'xmark.circle.fill', android: 'close', web: 'close' }} size={18} tintColor={C.muted} />
        </Pressable>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.card, borderRadius: R.pill, borderWidth: 1, borderColor: C.line, paddingHorizontal: 14, paddingVertical: 2 },
  input: { flex: 1, fontFamily: F.textMedium, fontSize: 16, color: C.ink, paddingVertical: 10 },
});
