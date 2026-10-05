import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';

export default function AddServerOptionsScreen({ navigation, route }) {
    // Nhận callback từ MainLayout để mở Modal Tạo Server
    const { openCreateServerModal, userId } = route.params;

    // Hàm điều hướng khi chọn 'Tạo nhóm'
    const handleSelectCreateServer = () => {
        navigation.navigate('Main', { openCreateServer: true });
    };

    // Hàm điều hướng khi chọn 'Tham gia nhóm' (Placeholder)
    const handleSelectJoinServer = () => {
        navigation.navigate('JoinServer', {
            userId: userId, // Truyền userId đi tiếp
        });
    };

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color="#dcddde" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Thêm Server</Text>
                <View style={{ width: 30 }} />
            </View>

            <View style={styles.content}>
                <Text style={styles.contentTitle}>Tạo Server của bạn trong tích tắc</Text>

                {/* OPTION 1: TẠO NHÓM */}
                <TouchableOpacity style={styles.optionButton} onPress={handleSelectCreateServer}>
                    <View style={styles.optionIconContainer}>
                        <Ionicons name="add-circle" size={30} color="#5865F2" />
                    </View>
                    <View style={styles.optionTextContainer}>
                        <Text style={styles.optionTitle}>Tạo nhóm của riêng tôi</Text>
                        <Text style={styles.optionSubtitle}>Dành cho bạn bè và cộng đồng.</Text>
                    </View>
                </TouchableOpacity>

                {/* OPTION 2: THAM GIA NHÓM (Join Server) */}
                <TouchableOpacity style={styles.optionButton} onPress={handleSelectJoinServer}>
                    <View style={styles.optionIconContainer}>
                        <Ionicons name="compass" size={30} color="#3ba55d" />
                    </View>
                    <View style={styles.optionTextContainer}>
                        <Text style={styles.optionTitle}>Tham gia nhóm</Text>
                        <Text style={styles.optionSubtitle}>Tham gia server bằng link mời.</Text>
                    </View>
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
    contentTitle: { color: '#b9bbbe', fontSize: 14, marginBottom: 20, textAlign: 'center' },

    optionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 15,
        backgroundColor: '#40444b', // Màu nền nút
        borderRadius: 8,
        marginBottom: 10,
        paddingHorizontal: 15,
    },
    optionIconContainer: { marginRight: 15, width: 30, alignItems: 'center' },
    optionTextContainer: { flex: 1 },
    optionTitle: { color: 'white', fontWeight: 'bold', fontSize: 16 },
    optionSubtitle: { color: '#b9bbbe', fontSize: 12 },
});