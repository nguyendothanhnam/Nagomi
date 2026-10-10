import AsyncStorage from '@react-native-async-storage/async-storage';
import { CommonActions, useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Avatar from '../components/Avatar'; // Sử dụng Avatar component
import UserService from '../services/UserService';

// Component hiển thị thông tin
const InfoRow = ({ label, value }) => (
    <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value || "Đang tải..."}</Text>
    </View>
);

export default function ProfileScreen({ navigation }) {
    const [currentUser, setCurrentUser] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isUploading, setIsUploading] = useState(false);

    // Load thông tin User từ AsyncStorage
    const loadUserData = async () => {
        setIsLoading(true);
        try {
            const userId = await AsyncStorage.getItem('userId');
            const username = await AsyncStorage.getItem('username');
            const email = await AsyncStorage.getItem('email');
            const avatarUrl = await AsyncStorage.getItem('avatarUrl');
            console.log("🔍 [DEBUG PROFILE] Loaded Email:", email);
            console.log("🔍 [DEBUG PROFILE] Loaded UserID:", userId);

            setCurrentUser({ id: userId, username, email, avatarUrl });
        } catch (e) {
            console.error("Lỗi load hồ sơ:", e);
        } finally {
            setIsLoading(false);
        }
    };

    useFocusEffect(
        useCallback(() => {
            // Hàm này sẽ chạy MỖI KHI màn hình Profile được focus (kể cả khi quay lại từ EditProfile)
            loadUserData();
        }, [])
    );

    // --- XỬ LÝ ĐỔI AVATAR ---
    const handleChangeUserAvatar = async () => {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') return Alert.alert("Lỗi", "Cần cấp quyền truy cập ảnh!");

        let result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: 'Images', allowsEditing: true, aspect: [1, 1], quality: 0.7,
        });

        if (result.canceled || !currentUser) return;

        setIsUploading(true);
        try {
            const serverPath = await UserService.uploadImage(result.assets[0].uri);

            if (serverPath) {
                await UserService.updateUserAvatar(currentUser.id, serverPath);

                // Cập nhật State và Cache
                const newAvatarUrlWithCacheBust = `${serverPath}?t=${new Date().getTime()}`;
                setCurrentUser(prevUser => ({
                    ...prevUser,
                    avatarUrl: newAvatarUrlWithCacheBust
                }));
                await AsyncStorage.setItem('avatarUrl', serverPath);

                Alert.alert("Thành công", "Đã cập nhật Avatar mới!");
            } else {
                Alert.alert("Lỗi", "Upload ảnh thất bại (Server trả về null)");
            }
        } catch (error) {
            console.error("❌ LỖI UPLOAD AVATAR CHI TIẾT:", error.response || error.message);
            Alert.alert("Lỗi", "Có lỗi xảy ra khi đổi Avatar.");
        } finally {
            setIsUploading(false);
        }
    };
    const handleProfileUpdated = useCallback((updatedData) => {
        // Cập nhật lại state local (currentUser) với dữ liệu mới
        setCurrentUser(prevUser => ({
            ...prevUser,
            username: updatedData.username,
            email: updatedData.email
        }));
    }, []);
    const handleEdit = () => {
        navigation.navigate('EditProfile', {
            userId: currentUser.id,
            initialUsername: currentUser.username,
            initialEmail: currentUser.email,
            // onProfileUpdated: handleProfileUpdated // Truyền callback để cập nhật ProfileScreen
        });
    };

    const handleLogout = async () => {
        try {
            //BƯỚC 1 (MỚI THÊM): Báo Server là tôi OFFLINE trước
            if (currentUser && currentUser.id) {
                console.log(`Đang đăng xuất user ${currentUser.id}...`);
                try {
                    // Gọi API cập nhật trạng thái thành OFFLINE
                    // Hàm này sẽ kích hoạt WebSocket bên Java gửi thông báo
                    await UserService.updateStatus(currentUser.id, 'OFFLINE');
                } catch (err) {
                    console.warn("Lỗi cập nhật trạng thái OFFLINE (không sao, vẫn tiếp tục logout):", err);
                }
            }

            //BƯỚC 2: Sau đó mới xóa Token trong máy
            await AsyncStorage.removeItem('userToken');
            await AsyncStorage.removeItem('userId');
            await AsyncStorage.clear();

            //BƯỚC 3: Điều hướng về Login
            if (Platform.OS === 'web') {
                if (typeof localStorage !== 'undefined') {
                    localStorage.clear();
                }
                window.location.reload();
            } else {
                navigation.dispatch(
                    CommonActions.reset({
                        index: 0,
                        routes: [{ name: 'Login' }],
                    })
                );
            }

        } catch (e) {
            console.error("Lỗi đăng xuất:", e);
            Alert.alert("Lỗi", "Không thể đăng xuất ngay lúc này.");
        }
    };
    const handleChangePasswordNavigation = () => {
        if (currentUser && currentUser.id) {
            navigation.navigate('ChangePassword', {
                userId: currentUser.id, // Truyền ID người dùng qua params
            });
        }
    };
    if (isLoading) {
        return <View style={styles.loadingContainer}><ActivityIndicator size="large" color="#5865F2" /></View>;
    }

    return (
        <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Hồ sơ cá nhân</Text>
            </View>

            <ScrollView style={styles.content}>

                {/* Khu vực Avatar */}
                <View style={styles.avatarSection}>
                    <TouchableOpacity onPress={handleChangeUserAvatar} disabled={isUploading}>
                        <View style={styles.avatarWrapper}>
                            {isUploading ? (
                                <ActivityIndicator size="large" color="#fff" />
                            ) : (
                                <Avatar uri={currentUser?.avatarUrl} name={currentUser?.username} size={100} />
                            )}
                            <View style={styles.cameraIcon}>
                                <Ionicons name="camera" size={20} color="white" />
                            </View>
                        </View>
                    </TouchableOpacity>
                    <Text style={styles.usernameText}>{currentUser?.username}</Text>
                </View>

                {/* Khu vực Thông tin */}
                <View style={styles.infoSection}>
                    <InfoRow label="TÊN TÀI KHOẢN" value={currentUser?.username} />
                    <InfoRow label="EMAIL" value={currentUser?.email} />
                </View>

                {/* Khu vực Nút chức năng */}
                <View style={styles.actionSection}>
                    {/* Nút Sửa (Placeholder) */}
                    <TouchableOpacity
                        style={[styles.actionButton, styles.editBtn]}
                        onPress={handleEdit}
                    >
                        <Text style={styles.actionButtonText}>SỬA THÔNG TIN</Text>
                    </TouchableOpacity>

                    {/* Nút Đổi Mật Khẩu (Placeholder) */}
                    <TouchableOpacity
                        style={[styles.actionButton, styles.passwordBtn]}
                        onPress={handleChangePasswordNavigation}
                    >
                        <Text style={styles.actionButtonText}>ĐỔI MẬT KHẨU</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={[styles.actionButton, styles.qrLoginBtn]} onPress={() => navigation.navigate('QrLoginScanner')}>
                        <Ionicons name="qr-code-outline" size={19} color="white" style={{ marginRight: 10 }} />
                        <Text style={styles.actionButtonText}>QUÉT MÃ ĐĂNG NHẬP</Text>
                    </TouchableOpacity>

                    {/* Nút Đăng Xuất */}
                    <TouchableOpacity style={[styles.actionButton, styles.logoutBtn]} onPress={handleLogout}>
                        <Ionicons name="log-out-outline" size={20} color="white" style={{ marginRight: 10 }} />
                        <Text style={styles.actionButtonText}>ĐĂNG XUẤT</Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#2f3136' },
    loadingContainer: { flex: 1, backgroundColor: '#2f3136', justifyContent: 'center', alignItems: 'center' },

    header: { flexDirection: 'row', alignItems: 'center', padding: 15, borderBottomWidth: 1, borderBottomColor: '#202225', backgroundColor: '#36393f' },
    backButton: { marginRight: 15 },
    headerTitle: { color: 'white', fontSize: 18, fontWeight: 'bold' },

    content: { padding: 20 },

    avatarSection: { alignItems: 'center', marginBottom: 30 },
    avatarWrapper: { position: 'relative', marginBottom: 10 },
    cameraIcon: { position: 'absolute', bottom: 0, right: 0, backgroundColor: '#5865F2', borderRadius: 15, width: 30, height: 30, justifyContent: 'center', alignItems: 'center', borderWidth: 3, borderColor: '#2f3136' },
    usernameText: { color: 'white', fontSize: 22, fontWeight: 'bold' },
    tagText: { color: '#b9bbbe', fontSize: 14 },

    infoSection: { backgroundColor: '#36393f', borderRadius: 8, padding: 15, marginBottom: 30 },
    infoRow: { marginBottom: 15 },
    infoLabel: { color: '#b9bbbe', fontSize: 12, fontWeight: 'bold', marginBottom: 5 },
    infoValue: { color: 'white', fontSize: 16 },

    actionSection: { paddingHorizontal: 10 },
    actionButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 15, borderRadius: 5, marginBottom: 15, width: '100%', alignSelf: 'center' },
    actionButtonText: { color: 'white', fontWeight: 'bold', fontSize: 16 },

    editBtn: { backgroundColor: '#4f545c' },
    passwordBtn: { backgroundColor: '#4f545c' },
    qrLoginBtn: { backgroundColor: '#5965ee' },
    logoutBtn: { backgroundColor: '#ed4245' }
});
