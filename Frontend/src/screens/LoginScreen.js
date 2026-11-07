import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import axios from 'axios';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import AuthScreenLayout from '../components/AuthScreenLayout';
import { BASE_URL } from '../utils/constants';

export default function LoginScreen({ navigation }) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [qrSession, setQrSession] = useState(null);
    const [qrStatus, setQrStatus] = useState('LOADING');
    const isFocused = useIsFocused();

    const notify = (title, message) => {
        if (Platform.OS === 'web') window.alert(`${title}\n\n${message}`);
        else Alert.alert(title, message);
    };

    const saveLogin = async (user) => {
        await AsyncStorage.setItem('userToken', user.token);
        await AsyncStorage.setItem('userId', user.id.toString());
        await AsyncStorage.setItem('username', user.username || '');
        await AsyncStorage.setItem('email', user.email || '');
        if (user.avatarUrl) await AsyncStorage.setItem('avatarUrl', user.avatarUrl);
        else await AsyncStorage.removeItem('avatarUrl');
        navigation.replace('Main');
    };

    const startQrSession = async () => {
        setQrSession(null);
        setQrStatus('LOADING');
        try {
            const response = await axios.post(`${BASE_URL}/auth/qr/start`);
            setQrSession(response.data);
            setQrStatus('PENDING');
        } catch (error) {
            setQrStatus('UNAVAILABLE');
        }
    };

    useEffect(() => { startQrSession(); }, []);

    useEffect(() => {
        if (!isFocused || !qrSession || qrStatus !== 'PENDING') return undefined;
        let cancelled = false;
        let timer;
        const pollStatus = async () => {
            try {
                const response = await axios.get(`${BASE_URL}/auth/qr/status`, {
                    params: { sessionId: qrSession.sessionId },
                    headers: { 'X-QR-Poll-Secret': qrSession.pollSecret },
                    timeout: 8000,
                });
                if (cancelled) return;
                const result = response.data;
                if (result.status === 'APPROVED' && result.login?.token) {
                    setQrStatus('APPROVED');
                    await saveLogin(result.login);
                } else if (['EXPIRED', 'CONSUMED'].includes(result.status)) {
                    setQrStatus('EXPIRED');
                } else if (result.status === 'DENIED') {
                    setQrStatus('DENIED');
                } else {
                    timer = setTimeout(pollStatus, 1400);
                }
            } catch (error) {
                if (!cancelled) timer = setTimeout(pollStatus, 2500);
            }
        };
        pollStatus();
        return () => { cancelled = true; clearTimeout(timer); };
    }, [isFocused, qrSession, qrStatus]);

    const handleLogin = async () => {
        if (!username.trim() || !password) {
            notify('Thiếu thông tin', 'Vui lòng nhập tên đăng nhập và mật khẩu.');
            return;
        }
        setLoading(true);
        try {
            const response = await axios.post(`${BASE_URL}/auth/login`, {
                username: username.trim(), password,
            });
            if (response.data?.id && response.data?.token) await saveLogin(response.data);
            else notify('Đăng nhập thất bại', 'Tên đăng nhập hoặc mật khẩu không đúng.');
        } catch (error) {
            const serverMessage = error.response?.data;
            notify('Không thể đăng nhập', typeof serverMessage === 'string'
                ? serverMessage
                : 'Không thể kết nối máy chủ. Hãy kiểm tra backend và địa chỉ IP trong cấu hình.');
        } finally {
            setLoading(false);
        }
    };

    const qrDescription = {
        PENDING: 'Mở Nagomi trên điện thoại, vào Hồ sơ và chọn quét mã để xác nhận.',
        LOADING: 'Đang tạo mã đăng nhập an toàn…',
        APPROVED: 'Đã xác nhận. Đang đăng nhập…',
        EXPIRED: 'Mã đã hết hạn. Hãy tạo mã mới.',
        DENIED: 'Yêu cầu đã bị từ chối. Bạn có thể tạo mã mới.',
        UNAVAILABLE: 'Không kết nối được máy chủ để tạo mã.',
    }[qrStatus];

    const qrContent = (
        <View style={styles.qrContent}>
            <View style={styles.qrTile}>
                {qrSession && ['PENDING', 'APPROVED'].includes(qrStatus)
                    ? <QRCode value={qrSession.qrPayload} size={106} color="#17191e" backgroundColor="#fff" />
                    : <Ionicons name={qrStatus === 'LOADING' ? 'sync-outline' : 'qr-code-outline'} size={62} color="#25282d" />}
            </View>
            {['EXPIRED', 'DENIED', 'UNAVAILABLE'].includes(qrStatus) && (
                <TouchableOpacity onPress={startQrSession} style={styles.refreshQr}>
                    <Ionicons name="refresh" size={15} color="#68d2e5" />
                    <Text style={styles.refreshQrText}>Tạo mã mới</Text>
                </TouchableOpacity>
            )}
        </View>
    );

    return (
        <AuthScreenLayout mode="login" navigation={navigation} qrContent={qrContent} qrDescription={qrDescription}>
            <Text style={styles.subtitle}>Rất vui được gặp lại bạn!</Text>
            <Text style={styles.label}>TÊN ĐĂNG NHẬP</Text>
            <TextInput style={styles.input} placeholder="Nhập tên đăng nhập" placeholderTextColor="#777b85"
                value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} returnKeyType="next" />
            <Text style={[styles.label, styles.passwordLabel]}>MẬT KHẨU</Text>
            <View style={styles.passwordWrap}>
                <TextInput style={[styles.input, styles.passwordInput]} placeholder="Nhập mật khẩu" placeholderTextColor="#777b85"
                    secureTextEntry={!showPassword} value={password} onChangeText={setPassword}
                    onSubmitEditing={handleLogin} returnKeyType="go" />
                <TouchableOpacity style={styles.eyeButton} onPress={() => setShowPassword(value => !value)}
                    accessibilityLabel={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>
                    <Ionicons name={showPassword ? 'eye-outline' : 'eye-off-outline'} size={19} color="#b6bac3" />
                </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.forgotButton} onPress={() => notify('Quên mật khẩu', 'Chức năng đặt lại mật khẩu chưa được bật. Vui lòng liên hệ quản trị viên.')}>
                <Text style={styles.forgotText}>Quên mật khẩu?</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, loading && styles.buttonDisabled]} onPress={handleLogin} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>ĐĂNG NHẬP</Text>}
            </TouchableOpacity>
            <View style={styles.registerPrompt}>
                <Text style={styles.promptText}>Cần một tài khoản? </Text>
                <TouchableOpacity onPress={() => navigation.navigate('Register')}><Text style={styles.linkText}>Đăng ký ngay</Text></TouchableOpacity>
            </View>
        </AuthScreenLayout>
    );
}

const styles = StyleSheet.create({
    subtitle: { color: '#c5c7ce', fontSize: 13, marginBottom: 15 },
    label: { color: '#c5c7ce', fontSize: 10, fontWeight: '700', marginBottom: 6, letterSpacing: 0.25 },
    passwordLabel: { marginTop: 13 },
    input: { height: 43, borderRadius: 5, paddingHorizontal: 12, backgroundColor: '#202226', borderWidth: 1, borderColor: 'rgba(0,0,0,0.22)', color: '#f2f3f5', fontSize: 14 },
    passwordWrap: { position: 'relative', justifyContent: 'center' },
    passwordInput: { paddingRight: 44 },
    eyeButton: { position: 'absolute', right: 12, height: 42, justifyContent: 'center', alignItems: 'center' },
    forgotButton: { alignSelf: 'flex-end', paddingVertical: 9 },
    forgotText: { color: '#53c5dd', fontSize: 12 },
    button: { height: 42, borderRadius: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5965ee', shadowColor: '#6875ff', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 5, marginTop: 2 },
    buttonDisabled: { opacity: 0.7 },
    buttonText: { color: '#fff', fontWeight: '800', fontSize: 13, letterSpacing: 0.3 },
    registerPrompt: { flexDirection: 'row', marginTop: 9, alignItems: 'center' },
    promptText: { color: '#e0e1e5', fontSize: 12 },
    linkText: { color: '#53c5dd', fontSize: 12, fontWeight: '600' },
    qrContent: { alignItems: 'center' },
    qrTile: { width: 116, height: 116, backgroundColor: '#fff', borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginBottom: 9 },
    refreshQr: { flexDirection: 'row', alignItems: 'center', gap: 5, padding: 8 },
    refreshQrText: { color: '#68d2e5', fontSize: 12, fontWeight: '600' },
});
