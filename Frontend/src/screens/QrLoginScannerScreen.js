import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import axios from 'axios';
import { Ionicons } from '@expo/vector-icons';
import { BASE_URL } from '../utils/constants';

export default function QrLoginScannerScreen({ navigation }) {
    const [permission, requestPermission] = useCameraPermissions();
    const [sessionId, setSessionId] = useState(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [scanned, setScanned] = useState(false);

    const showMessage = (title, text) => {
        if (Platform.OS === 'web') window.alert(`${title}\n\n${text}`);
        else Alert.alert(title, text);
    };

    const handleBarcode = ({ data }) => {
        if (scanned) return;
        const match = /^nagomi-auth:([A-Za-z0-9_-]{40,50})$/.exec(String(data).trim());
        setScanned(true);
        if (!match) {
            setMessage('Mã QR không thuộc Nagomi. Hãy quét mã đăng nhập Nagomi trên trình duyệt.');
            return;
        }
        setMessage('Xác nhận để đăng nhập tài khoản Nagomi này trên trình duyệt đang hiển thị mã.');
        setSessionId(match[1]);
    };

    const confirm = async (approved) => {
        if (!sessionId) return;
        setBusy(true);
        try {
            const token = await AsyncStorage.getItem('userToken');
            if (!token) throw new Error('Bạn đã đăng xuất. Hãy đăng nhập lại rồi quét mã.');
            await axios.post(`${BASE_URL}/auth/qr/${approved ? 'approve' : 'deny'}`, { sessionId }, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (approved) {
                showMessage('Đã xác nhận', 'Trình duyệt sẽ đăng nhập vào tài khoản của bạn.');
                navigation.goBack();
            } else {
                setSessionId(null);
                setScanned(false);
                setMessage('Đã từ chối. Bạn có thể quét một mã khác.');
            }
        } catch (error) {
            const text = error.response?.data?.message || error.message || 'Không thể xử lý yêu cầu QR.';
            showMessage('Yêu cầu thất bại', text);
            setSessionId(null);
            setScanned(false);
        } finally {
            setBusy(false);
        }
    };

    if (!permission) {
        return <View style={styles.center}><ActivityIndicator color="#7b88ff" /></View>;
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={23} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.title}>Quét mã đăng nhập</Text>
            </View>
            {permission.granted ? (
                <View style={styles.cameraFrame}>
                    <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={scanned ? undefined : handleBarcode} />
                    <View pointerEvents="none" style={styles.scanFrame} />
                    <Text style={styles.cameraHint}>Đưa mã QR trên trình duyệt vào khung hình</Text>
                </View>
            ) : (
                <View style={styles.permissionBox}>
                    <Ionicons name="camera-outline" size={46} color="#91a0ff" />
                    <Text style={styles.permissionText}>Nagomi cần quyền camera để quét mã đăng nhập.</Text>
                    <TouchableOpacity style={styles.primaryButton} onPress={requestPermission}>
                        <Text style={styles.buttonText}>Cho phép camera</Text>
                    </TouchableOpacity>
                </View>
            )}
            <Text style={styles.message}>{message || 'Chỉ xác nhận mã trên trình duyệt do bạn mở.'}</Text>
            {scanned && !sessionId && (
                <TouchableOpacity style={styles.secondaryButton} onPress={() => { setScanned(false); setMessage(''); }}>
                    <Text style={styles.buttonText}>Quét lại</Text>
                </TouchableOpacity>
            )}

            <Modal transparent visible={Boolean(sessionId)} animationType="fade" onRequestClose={() => setSessionId(null)}>
                <View style={styles.modalBackdrop}>
                    <View style={styles.modalCard}>
                        <Ionicons name="desktop-outline" size={38} color="#8894ff" />
                        <Text style={styles.modalTitle}>Cho phép đăng nhập?</Text>
                        <Text style={styles.modalCopy}>Nagomi sẽ đăng nhập trên trình duyệt đang hiển thị mã QR bằng tài khoản hiện tại của bạn.</Text>
                        <TouchableOpacity style={styles.primaryButton} onPress={() => confirm(true)} disabled={busy}>
                            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Xác nhận đăng nhập</Text>}
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.denyButton} onPress={() => confirm(false)} disabled={busy}>
                            <Text style={styles.buttonText}>Từ chối</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#11151e', padding: 18 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#11151e' },
    header: { height: 52, flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
    backButton: { padding: 8, marginRight: 10 },
    title: { color: '#fff', fontSize: 18, fontWeight: '700' },
    cameraFrame: { height: 360, maxWidth: 480, width: '100%', alignSelf: 'center', borderRadius: 16, overflow: 'hidden', backgroundColor: '#252b36', justifyContent: 'flex-end', alignItems: 'center' },
    scanFrame: { width: 230, height: 230, borderWidth: 3, borderColor: '#7de1e9', borderRadius: 18, alignSelf: 'center', marginTop: 65 },
    cameraHint: { color: '#fff', backgroundColor: 'rgba(0,0,0,0.58)', width: '100%', textAlign: 'center', paddingVertical: 12, fontSize: 13 },
    permissionBox: { minHeight: 280, alignItems: 'center', justifyContent: 'center', gap: 16 },
    permissionText: { color: '#d4d7df', textAlign: 'center', maxWidth: 280, lineHeight: 21 },
    message: { color: '#b8bdc9', textAlign: 'center', marginTop: 22, lineHeight: 20 },
    primaryButton: { backgroundColor: '#5965ee', borderRadius: 7, paddingVertical: 13, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', minHeight: 45, marginTop: 12 },
    secondaryButton: { backgroundColor: '#3c4350', borderRadius: 7, padding: 12, alignSelf: 'center', marginTop: 14 },
    denyButton: { backgroundColor: '#414651', borderRadius: 7, paddingVertical: 13, alignItems: 'center', marginTop: 9 },
    buttonText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'center', alignItems: 'center', padding: 22 },
    modalCard: { width: '100%', maxWidth: 360, backgroundColor: '#252a34', borderRadius: 14, padding: 23, alignItems: 'stretch' },
    modalTitle: { color: '#fff', fontSize: 20, fontWeight: '700', marginTop: 14, textAlign: 'center' },
    modalCopy: { color: '#c4c8d2', fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 9, marginBottom: 8 },
});
