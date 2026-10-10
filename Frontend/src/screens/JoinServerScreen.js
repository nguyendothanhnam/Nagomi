import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import UserService from '../services/UserService';

export default function JoinServerScreen({ navigation }) {

    const [inviteCode, setInviteCode] = useState('');
    const [loading, setLoading] = useState(false);

    const handleJoin = async () => {
        if (!inviteCode.trim()) {
            return Alert.alert("Lỗi", "Vui lòng nhập mã mời.");
        }

        setLoading(true);
        try {
            // Gọi API tham gia
            const message = await UserService.joinServer(inviteCode.trim());

            // Thành công -> Báo & Quay lại
            Alert.alert("Thành công", message, [
                { text: "OK", onPress: () => navigation.navigate('Main') }
            ]);
        } catch (error) {
            const errorData = error.response?.data; // Lấy "ALREADY_JOINED"
            if (errorData === "ALREADY_JOINED") {
                Alert.alert("Thông báo", "Bạn đã là thành viên của nhóm này rồi.");
            } else {
                Alert.alert("Thất bại", errorData || "Lỗi tham gia.");
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color="#dcddde" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Tham gia Server</Text>
                <View style={{ width: 30 }} />
            </View>

            <View style={styles.content}>
                <Text style={styles.title}>Nhập mã mời để tham gia</Text>
                <Text style={styles.subtitle}>Mã mời có dạng: Nagomi-XXXXXXXX</Text>

                <Text style={styles.label}>MÃ MỜI *</Text>
                <TextInput
                    style={styles.input}
                    value={inviteCode}
                    onChangeText={setInviteCode}
                    placeholder="Ví dụ: Nagomi-A1B2C3D4"
                    placeholderTextColor="#72767d"
                    autoCapitalize="characters" // Tự động viết hoa
                />

                <TouchableOpacity
                    onPress={handleJoin}
                    style={styles.joinButton}
                    disabled={loading}
                >
                    {loading ? (
                        <ActivityIndicator color="white" />
                    ) : (
                        <Text style={styles.joinButtonText}>THAM GIA NGAY</Text>
                    )}
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#36393f' },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 15, borderBottomWidth: 1, borderBottomColor: '#202225' },
    headerTitle: { color: 'white', fontSize: 18, fontWeight: 'bold' },

    content: { padding: 20, alignItems: 'center' },
    title: { color: 'white', fontSize: 22, fontWeight: 'bold', marginBottom: 10, marginTop: 20 },
    subtitle: { color: '#b9bbbe', fontSize: 14, marginBottom: 30 },

    label: { color: '#b9bbbe', fontSize: 12, fontWeight: 'bold', alignSelf: 'flex-start', marginBottom: 8 },
    input: { backgroundColor: '#202225', color: 'white', padding: 15, borderRadius: 5, marginBottom: 20, fontSize: 16, width: '100%' },

    joinButton: { backgroundColor: '#3ba55d', padding: 15, borderRadius: 5, alignItems: 'center', width: '100%' },
    joinButtonText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
});
