import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { BASE_URL } from '../utils/constants';

export default function LoginScreen({ navigation }) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');

    const handleLogin = async () => {
        if (!username || !password) {
            Alert.alert("Thông báo", "Vui lòng nhập đầy đủ thông tin!");
            return;
        }

        try {
            console.log("Đang gọi API tới:", BASE_URL);

            // Gọi API Java Spring Boot
            const response = await axios.post(`${BASE_URL}/auth/login`, {
                username: username,
                password: password
            });

            console.log("Kết quả:", response.data);

            // Kiểm tra kết quả trả về
            if (response.data && response.data.id) {
                console.log("🔍 [DEBUG LOGIN] Email nhận được từ Server:", response.data.email); // 👈 THÊM DÒNG NÀY
                await AsyncStorage.setItem('userToken', response.data.token);
                await AsyncStorage.setItem('userId', response.data.id.toString());
                await AsyncStorage.setItem('username', response.data.username);
                const emailToSave = response.data.email || '';
                await AsyncStorage.setItem('email', emailToSave);

                if (response.data.avatarUrl) {
                    await AsyncStorage.setItem('avatarUrl', response.data.avatarUrl);
                } else {
                    await AsyncStorage.removeItem('avatarUrl'); // Xóa avatar cũ nếu user này ko có
                }
                // Sau này sẽ chuyển sang màn hình Chat ở đây
                navigation.navigate('Main');

            } else {
                Alert.alert("Thất bại", "Tài khoản hoặc mật khẩu không đúng.");
            }

        } catch (error) {
            console.error("Lỗi đăng nhập:", error);
            Alert.alert("Lỗi kết nối", "Không thể kết nối tới Server Java. Hãy kiểm tra lại IP.");
        }
    };

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Welcome Back!</Text>
            <Text style={styles.subtitle}>Clone Discord App</Text>

            <View style={styles.inputContainer}>
                <TextInput
                    style={styles.input}
                    placeholder="Tên đăng nhập"
                    placeholderTextColor="#aaa"
                    value={username}
                    onChangeText={setUsername}
                />
                <TextInput
                    style={styles.input}
                    placeholder="Mật khẩu"
                    placeholderTextColor="#aaa"
                    secureTextEntry
                    value={password}
                    onChangeText={setPassword}
                />
            </View>

            <TouchableOpacity style={styles.button} onPress={handleLogin}>
                <Text style={styles.buttonText}>ĐĂNG NHẬP</Text>
            </TouchableOpacity>
            <View style={{ marginTop: 20, flexDirection: 'row', justifyContent: 'center' }}>
                <Text style={{ color: '#72767d' }}>Cần một tài khoản? </Text>
                <TouchableOpacity onPress={() => navigation.navigate('Register')}>
                    <Text style={{ color: '#00aff4', fontWeight: 'bold' }}>Đăng ký</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        padding: 20,
        backgroundColor: '#36393f' // Màu nền đặc trưng Discord
    },
    title: {
        fontSize: 28,
        fontWeight: 'bold',
        color: '#fff',
        textAlign: 'center',
        marginBottom: 5
    },
    subtitle: {
        fontSize: 16,
        color: '#b9bbbe',
        textAlign: 'center',
        marginBottom: 40
    },
    inputContainer: {
        marginBottom: 20
    },
    input: {
        backgroundColor: '#202225',
        color: '#fff',
        padding: 15,
        marginBottom: 15,
        borderRadius: 5,
        borderWidth: 1,
        borderColor: '#202225'
    },
    button: {
        backgroundColor: '#5865F2', // Màu xanh Discord
        padding: 15,
        borderRadius: 5,
        alignItems: 'center'
    },
    buttonText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 16
    }
});