import { useState } from 'react';
import { ActivityIndicator, Alert, Platform, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import AuthScreenLayout from '../components/AuthScreenLayout';
import UserService from '../services/UserService';

export default function RegisterScreen({ navigation }) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);

    const notify = (title, message) => {
        if (Platform.OS === 'web') window.alert(`${title}\n\n${message}`);
        else Alert.alert(title, message);
    };

    const handleRegister = async () => {
        if (!username.trim() || !password || !email.trim()) {
            notify('Thiếu thông tin', 'Vui lòng điền email, tên đăng nhập và mật khẩu.');
            return;
        }
        setLoading(true);
        try {
            await UserService.register(username.trim(), password, email.trim());
            notify('Tạo tài khoản thành công', 'Bạn có thể đăng nhập bằng tài khoản vừa tạo.');
            navigation.replace('Login');
        } catch (error) {
            const responseMessage = error.response?.data;
            notify('Không thể đăng ký', typeof responseMessage === 'string' ? responseMessage : 'Đã xảy ra lỗi. Hãy kiểm tra kết nối máy chủ.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthScreenLayout mode="register" navigation={navigation}>
            <Text style={styles.subtitle}>Tạo tài khoản Nagomi của bạn</Text>
            <Text style={styles.label}>EMAIL</Text>
            <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="example@email.com" placeholderTextColor="#777b85" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
            <Text style={styles.label}>TÊN NGƯỜI DÙNG</Text>
            <TextInput style={styles.input} value={username} onChangeText={setUsername} placeholder="Tên đăng nhập" placeholderTextColor="#777b85" autoCapitalize="none" autoCorrect={false} />
            <Text style={styles.label}>MẬT KHẨU</Text>
            <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="Tạo mật khẩu" placeholderTextColor="#777b85" secureTextEntry />
            <TouchableOpacity style={[styles.button, loading && styles.buttonDisabled]} onPress={handleRegister} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>TẠO TÀI KHOẢN</Text>}
            </TouchableOpacity>
            <Text style={styles.note}>Bằng việc đăng ký, bạn đồng ý với các quy tắc cộng đồng Nagomi.</Text>
        </AuthScreenLayout>
    );
}

const styles = StyleSheet.create({
    subtitle: { color: '#c5c7ce', fontSize: 13, marginBottom: 13 },
    label: { color: '#c5c7ce', fontSize: 10, fontWeight: '700', marginBottom: 6, marginTop: 10, letterSpacing: 0.25 },
    input: { height: 42, borderRadius: 5, paddingHorizontal: 12, backgroundColor: '#202226', borderWidth: 1, borderColor: 'rgba(0,0,0,0.22)', color: '#f2f3f5', fontSize: 14 },
    button: { height: 42, borderRadius: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5965ee', shadowColor: '#6875ff', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 5, marginTop: 17 },
    buttonDisabled: { opacity: 0.7 },
    buttonText: { color: '#fff', fontWeight: '800', fontSize: 13 },
    note: { color: '#9ea2ad', textAlign: 'center', fontSize: 11, marginTop: 10, lineHeight: 16 },
});
