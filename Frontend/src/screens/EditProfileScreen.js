import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState } from 'react';
import { ActivityIndicator, Alert, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from 'react-native-vector-icons/Ionicons';
import UserService from '../services/UserService';

export default function EditProfileScreen({ navigation, route }) {
    // Nhận dữ liệu người dùng hiện tại và hàm callback từ ProfileScreen
    const { userId, initialUsername, initialEmail } = route.params;

    const [username, setUsername] = useState(initialUsername);
    const [email, setEmail] = useState(initialEmail);
    const [loading, setLoading] = useState(false);
    // Hàm hiển thị thông báo dùng chung
    const showNotify = (title, message, onPressOk) => {
        if (Platform.OS === 'web') {
            alert(`${title}: ${message}`);
            if (onPressOk) onPressOk();
        } else {
            Alert.alert(title, message, [{ text: "OK", onPress: onPressOk }]);
        }
    };

    // const handleSave = async () => {
    //     if (!username.trim() || !email.trim()) {
    //         return Alert.alert("Lỗi", "Tên tài khoản và Email không được để trống.");
    //     }

    //     setLoading(true);
    //     try {
    //         // 1. Gọi API cập nhật
    //         const message = await UserService.updateUserProfile(userId, username, email);

    //         // 2. Cập nhật AsyncStorage (Đảm bảo dữ liệu mới nhất được lưu)
    //         await AsyncStorage.setItem('username', username);
    //         await AsyncStorage.setItem('email', email);

    //         Alert.alert("Thành công", message);
    //         navigation.goBack(); // Quay lại màn hình Profile
    //     } catch (error) {
    //         Alert.alert("Thất bại", error.toString());
    //     } finally {
    //         setLoading(false);
    //     }
    // };
    const handleSave = async () => {
        const cleanUsername = username.trim();
        const cleanEmail = email.trim();

        if (!cleanUsername || !cleanEmail) {
            return showNotify("Lỗi", "Tên tài khoản và Email không được để trống.");
        }

        setLoading(true);
        try {
            // 1. Gọi API cập nhật
            const message = await UserService.updateUserProfile(userId, cleanUsername, cleanEmail);

            // 2. Cập nhật AsyncStorage
            await AsyncStorage.setItem('username', cleanUsername);
            await AsyncStorage.setItem('email', cleanEmail);

            // 3. Thông báo thành công
            showNotify("Thành công", message, () => {
                navigation.goBack();
            });

        } catch (error) {
            // 👇 Xử lý lỗi từ Backend (ví dụ: "Username đã tồn tại!")
            // const errorMsg = error.toString();
            showNotify("Thất bại Username đã tồn tại!", "");
        } finally {
            setLoading(false);
        }
    };
    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <Ionicons name="close-outline" size={30} color="#dcddde" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Sửa thông tin</Text>
                <TouchableOpacity onPress={handleSave} style={styles.saveButton} disabled={loading}>
                    {loading ? (
                        <ActivityIndicator color="white" />
                    ) : (
                        <Text style={styles.saveButtonText}>LƯU</Text>
                    )}
                </TouchableOpacity>
            </View>

            <View style={styles.content}>
                <Text style={styles.label}>TÊN TÀI KHOẢN</Text>
                <TextInput
                    style={styles.input}
                    value={username}
                    onChangeText={setUsername}
                    placeholder="Tên tài khoản"
                    placeholderTextColor="#72767d"
                />

                <Text style={styles.label}>EMAIL</Text>
                <TextInput
                    style={styles.input}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="Email"
                    placeholderTextColor="#72767d"
                    keyboardType="email-address"
                />
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#2f3136' },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 10, backgroundColor: '#36393f', borderBottomWidth: 1, borderBottomColor: '#202225' },
    backButton: { padding: 5 },
    headerTitle: { color: 'white', fontSize: 18, fontWeight: 'bold' },
    saveButton: { backgroundColor: '#5865F2', paddingHorizontal: 15, paddingVertical: 8, borderRadius: 3, minWidth: 80, alignItems: 'center' },
    saveButtonText: { color: 'white', fontWeight: 'bold' },

    content: { padding: 20 },
    label: { color: '#b9bbbe', fontSize: 12, fontWeight: 'bold', marginBottom: 5 },
    input: { backgroundColor: '#36393f', color: 'white', padding: 12, borderRadius: 4, marginBottom: 20, fontSize: 16 },
});