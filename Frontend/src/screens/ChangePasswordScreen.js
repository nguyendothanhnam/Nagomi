import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import UserService from '../services/UserService';

export default function ChangePasswordScreen({ navigation, route }) {
    // Nhận userId từ màn hình Profile
    const { userId } = route.params;

    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);

    const handleChangePassword = async () => {
        if (!oldPassword || !newPassword || !confirmPassword) {
            return Alert.alert("Lỗi", "Vui lòng nhập đầy đủ các trường.");
        }
        if (newPassword !== confirmPassword) {
            return Alert.alert("Lỗi", "Mật khẩu mới và Xác nhận mật khẩu mới không khớp.");
        }
        if (newPassword.length < 6) {
            return Alert.alert("Lỗi", "Mật khẩu mới phải có ít nhất 6 ký tự.");
        }

        setLoading(true);
        try {
            // 1. Gọi API đổi mật khẩu
            const message = await UserService.changePassword(userId, oldPassword, newPassword);

            Alert.alert("Thành công", message, [
                {
                    text: "Đóng",
                    onPress: () => navigation.goBack()
                }
            ]);
        } catch (error) {
            let errorMessage = "Đã xảy ra lỗi không xác định (Lỗi kết nối hoặc Server).";
            if (error.response && error.response.data) {
                // error.response.data chứa chuỗi lỗi chi tiết từ Server (ví dụ: "Mật khẩu cũ không đúng.")
                errorMessage = error.response.data;
            }
            // 2. HIỆN THỊ ALERT LÊN MÀN HÌNH
            Alert.alert("Thất bại", errorMessage);
        } finally {
            setLoading(false);
            // Xóa dữ liệu sau khi thử đổi
            setOldPassword('');
            setNewPassword('');
            setConfirmPassword('');
        }
    };

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color="#dcddde" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Đổi mật khẩu</Text>
                <View style={{ width: 30 }} />
            </View>

            <View style={styles.content}>

                <Text style={styles.label}>MẬT KHẨU CŨ</Text>
                <TextInput
                    style={styles.input}
                    value={oldPassword}
                    onChangeText={setOldPassword}
                    placeholder="Nhập mật khẩu cũ"
                    placeholderTextColor="#72767d"
                    secureTextEntry
                />

                <Text style={styles.label}>MẬT KHẨU MỚI</Text>
                <TextInput
                    style={styles.input}
                    value={newPassword}
                    onChangeText={setNewPassword}
                    placeholder="Nhập mật khẩu mới"
                    placeholderTextColor="#72767d"
                    secureTextEntry
                />

                <Text style={styles.label}>XÁC NHẬN MẬT KHẨU MỚI</Text>
                <TextInput
                    style={styles.input}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    placeholder="Xác nhận mật khẩu mới"
                    placeholderTextColor="#72767d"
                    secureTextEntry
                />

                <TouchableOpacity
                    onPress={handleChangePassword}
                    style={styles.changeButton}
                    disabled={loading}
                >
                    {loading ? (
                        <ActivityIndicator color="white" />
                    ) : (
                        <Text style={styles.changeButtonText}>ĐỔI MẬT KHẨU</Text>
                    )}
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#2f3136' },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 15, backgroundColor: '#36393f', borderBottomWidth: 1, borderBottomColor: '#202225' },
    backButton: { padding: 5 },
    headerTitle: { color: 'white', fontSize: 18, fontWeight: 'bold' },

    content: { padding: 20 },
    label: { color: '#b9bbbe', fontSize: 12, fontWeight: 'bold', marginBottom: 5, marginTop: 10 },
    input: { backgroundColor: '#36393f', color: 'white', padding: 12, borderRadius: 4, marginBottom: 10, fontSize: 16, borderWidth: 1, borderColor: '#4f545c' },

    changeButton: { backgroundColor: '#ed4245', padding: 15, borderRadius: 5, alignItems: 'center', marginTop: 20 },
    changeButtonText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
});
