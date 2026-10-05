import { useState } from 'react';
import { ActivityIndicator, Alert, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import UserService from '../services/UserService';

export default function RegisterScreen({ navigation }) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);

    // const handleRegister = async () => {
    //     if (!username || !password || !email) {
    //         Alert.alert("Lỗi", "Vui lòng điền đầy đủ thông tin!");
    //         return;
    //     }

    //     setLoading(true);
    //     try {
    //         // Gọi API Đăng ký
    //         const result = await UserService.register(username, password, email);

    //         // Backend trả về chuỗi "Đăng ký thành công!" hoặc JSON
    //         Alert.alert("Thành công", "Tạo tài khoản thành công! Hãy đăng nhập.", [
    //             { text: "OK", onPress: () => navigation.goBack() } // Quay lại màn hình Login
    //         ]);
    //     } catch (error) {
    //         Alert.alert("Thất bại", error.toString());
    //     } finally {
    //         setLoading(false);
    //     }
    // };
    const handleRegister = async () => {
        if (!username || !password || !email) {
            const msg = "Vui lòng điền đầy đủ thông tin!";
            if (Platform.OS === 'web') alert(msg); else Alert.alert("Lỗi", msg);
            return;
        }

        setLoading(true);
        try {
            await UserService.register(username, password, email);

            const successMsg = "Tạo tài khoản thành công! Hãy đăng nhập.";

            if (Platform.OS === 'web') {
                alert(successMsg);
                navigation.goBack();
            } else {
                Alert.alert("Thành công", successMsg, [
                    { text: "OK", onPress: () => navigation.goBack() }
                ]);
            }
        } catch (error) {
            // 'error' này chính là chuỗi "Username đã tồn tại!" từ Backend trả về
            const errorMsg = error.toString();

            if (Platform.OS === 'web') {
                alert(errorMsg);
            } else {
                Alert.alert("Thất bại", errorMsg);
            }
        } finally {
            setLoading(false);
        }
    };
    return (
        <View style={styles.container}>
            <Text style={styles.title}>Tạo tài khoản</Text>
            <Text style={styles.subtitle}>Tham gia cộng đồng ngay hôm nay</Text>

            <View style={styles.inputContainer}>
                <Text style={styles.label}>EMAIL</Text>
                <TextInput
                    style={styles.input}
                    value={email} onChangeText={setEmail}
                    placeholder="example@gmail.com" placeholderTextColor="#72767d"
                    keyboardType="email-address"
                    autoCapitalize="none"
                />

                <Text style={styles.label}>TÊN NGƯỜI DÙNG</Text>
                <TextInput
                    style={styles.input}
                    value={username} onChangeText={setUsername}
                    placeholder="Username" placeholderTextColor="#72767d"
                    autoCapitalize="none"
                />

                <Text style={styles.label}>MẬT KHẨU</Text>
                <TextInput
                    style={styles.input}
                    value={password} onChangeText={setPassword}
                    placeholder="********" placeholderTextColor="#72767d"
                    secureTextEntry
                />
            </View>

            <TouchableOpacity style={styles.button} onPress={handleRegister} disabled={loading}>
                {loading ? (
                    <ActivityIndicator color="#fff" />
                ) : (
                    <Text style={styles.buttonText}>ĐĂNG KÝ</Text>
                )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.linkButton} onPress={() => navigation.goBack()}>
                <Text style={styles.linkText}>Đã có tài khoản? Đăng nhập</Text>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#36393f' },
    title: { fontSize: 24, fontWeight: 'bold', color: '#fff', textAlign: 'center', marginBottom: 10 },
    subtitle: { fontSize: 16, color: '#b9bbbe', textAlign: 'center', marginBottom: 30 },
    inputContainer: { marginBottom: 20 },
    label: { color: '#b9bbbe', fontSize: 12, fontWeight: 'bold', marginBottom: 8, marginTop: 10 },
    input: { backgroundColor: '#202225', color: '#fff', padding: 15, borderRadius: 5, borderWidth: 1, borderColor: '#202225' },
    button: { backgroundColor: '#5865F2', padding: 15, borderRadius: 5, alignItems: 'center', marginTop: 10 },
    buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
    linkButton: { marginTop: 20, alignItems: 'center' },
    linkText: { color: '#00aff4' }
});