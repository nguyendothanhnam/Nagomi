import { Ionicons } from '@expo/vector-icons';
import { useWindowDimensions, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const trees = [
    { left: '-5%', width: 180, height: 310, color: '#071725' },
    { left: '12%', width: 115, height: 230, color: '#0a1c2a' },
    { right: '8%', width: 150, height: 280, color: '#0a1728' },
    { right: '-7%', width: 210, height: 360, color: '#071522' },
];

export default function AuthScreenLayout({ mode, navigation, children, qrContent, qrDescription }) {
    const { width } = useWindowDimensions();
    const wide = width >= 720;

    return (
        <View style={styles.root}>
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <View style={[styles.glow, styles.glowBlue]} />
                <View style={[styles.glow, styles.glowViolet]} />
                <View style={[styles.glow, styles.glowTeal]} />
                <View style={styles.forestFloor} />
                {trees.map((tree, index) => (
                    <View key={index} style={[styles.tree, tree, { borderBottomWidth: tree.height, borderLeftWidth: tree.width / 2, borderRightWidth: tree.width / 2 }]} />
                ))}
                <View style={[styles.windowLight, { left: '8%', bottom: '30%' }]} />
                <View style={[styles.windowLight, { right: '12%', bottom: '24%' }]} />
                <View style={[styles.windowLight, { left: '18%', bottom: '17%' }]} />
                <View style={[styles.windowLight, { right: '25%', bottom: '12%' }]} />
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
                <View style={[styles.frame, wide && styles.frameWide]}>
                    <View style={styles.brandRow}>
                        <Text style={styles.brandMark}>🌸🎮</Text>
                        <Text style={styles.brandName}>Nagomi</Text>
                    </View>
                    <Text style={styles.tagline}>Chào mừng bạn đến với Nagomi</Text>

                    <View style={styles.panel}>
                        <View style={[styles.panelColumns, wide && styles.panelColumnsWide]}>
                            <View style={styles.formColumn}>
                                <View style={styles.tabs}>
                                    <TouchableOpacity style={styles.tab} onPress={() => navigation.navigate('Login')}>
                                        <Text style={[styles.tabText, mode === 'login' && styles.activeTabText]}>ĐĂNG NHẬP</Text>
                                        {mode === 'login' && <View style={styles.tabUnderline} />}
                                    </TouchableOpacity>
                                    <TouchableOpacity style={styles.tab} onPress={() => navigation.navigate('Register')}>
                                        <Text style={[styles.tabText, mode === 'register' && styles.activeTabText]}>ĐĂNG KÝ</Text>
                                        {mode === 'register' && <View style={styles.tabUnderline} />}
                                    </TouchableOpacity>
                                </View>
                                {children}
                            </View>

                            {mode === 'login' && <View style={styles.qrColumn}>
                                {qrContent || <View style={styles.qrTile}><Ionicons name="qr-code-outline" size={82} color="#25282d" /></View>}
                                <Text style={styles.qrHeading}>Đăng nhập bằng mã QR</Text>
                                <Text style={styles.qrCopy}>{qrDescription || 'Mở Nagomi trên điện thoại để quét và xác nhận đăng nhập.'}</Text>
                            </View>}
                        </View>
                    </View>
                </View>
            </ScrollView>
            <View pointerEvents="none" style={styles.sparkle}><Ionicons name="sparkles" size={36} color="rgba(226,220,255,0.78)" /></View>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, minHeight: '100%', backgroundColor: '#081321', justifyContent: 'center', overflow: 'hidden' },
    scrollContent: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 30, paddingHorizontal: 18 },
    frame: { width: '100%', maxWidth: 510, padding: 15, borderWidth: 1, borderColor: 'rgba(225,235,255,0.3)', borderRadius: 12, backgroundColor: 'rgba(13,22,35,0.66)', shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 28, shadowOffset: { width: 0, height: 16 }, elevation: 15 },
    frameWide: { padding: 18 },
    brandRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 9, marginTop: 0 },
    brandMark: { fontSize: 33 },
    brandName: { color: '#f7f7fb', fontSize: 30, fontWeight: '800', letterSpacing: 0.2 },
    tagline: { color: '#d8dde6', textAlign: 'center', fontSize: 13, marginTop: 2, marginBottom: 16 },
    panel: { backgroundColor: 'rgba(42,45,52,0.96)', borderRadius: 10, padding: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.035)' },
    panelColumns: { flexDirection: 'column' },
    panelColumnsWide: { flexDirection: 'row', gap: 25 },
    formColumn: { flex: 1, minWidth: 0 },
    tabs: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
    tab: { width: '48%', minHeight: 40, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
    tabText: { color: '#a8aab1', fontWeight: '800', fontSize: 16 },
    activeTabText: { color: '#f5f5f8' },
    tabUnderline: { position: 'absolute', bottom: -1, width: '76%', height: 2, backgroundColor: '#51c4db' },
    qrColumn: { alignItems: 'center', justifyContent: 'center', paddingTop: 18, paddingHorizontal: 6 },
    qrTile: { width: 116, height: 116, backgroundColor: '#fff', borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginBottom: 13 },
    qrHeading: { color: '#f4f4f6', fontSize: 14, fontWeight: '700', textAlign: 'center', marginBottom: 4 },
    qrCopy: { color: '#c4c5cb', fontSize: 13, textAlign: 'center', maxWidth: 180, lineHeight: 18 },
    glow: { position: 'absolute', borderRadius: 999, opacity: 0.45 },
    glowBlue: { width: 330, height: 330, backgroundColor: '#087f9f', left: -140, top: '20%', shadowColor: '#03a9c7', shadowOpacity: 0.9, shadowRadius: 90 },
    glowViolet: { width: 360, height: 360, backgroundColor: '#5a347e', right: -125, top: -120, shadowColor: '#9c4cbb', shadowOpacity: 0.9, shadowRadius: 100 },
    glowTeal: { width: 260, height: 260, backgroundColor: '#07564f', right: '28%', bottom: -190, shadowColor: '#00bca7', shadowOpacity: 0.8, shadowRadius: 80 },
    forestFloor: { position: 'absolute', left: -80, right: -80, bottom: -160, height: 330, borderRadius: 300, backgroundColor: '#07111c', opacity: 0.92 },
    tree: { position: 'absolute', bottom: 0, width: 0, height: 0, borderBottomColor: '#06101a', borderLeftColor: 'transparent', borderRightColor: 'transparent', opacity: 0.88 },
    windowLight: { position: 'absolute', width: 8, height: 13, backgroundColor: '#ffd79a', borderRadius: 2, opacity: 0.9, shadowColor: '#ffc66e', shadowOpacity: 1, shadowRadius: 13, elevation: 8 },
    sparkle: { position: 'absolute', right: 22, bottom: 18, opacity: 0.8 },
});
