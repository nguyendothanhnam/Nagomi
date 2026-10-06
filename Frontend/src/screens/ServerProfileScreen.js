
import { useFocusEffect } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from 'react-native-vector-icons/Ionicons';
import Avatar from '../components/Avatar';
import MemberSelectionModal from '../components/MemberSelectionModal'; // 👈 IMPORT MODAL MỚI
import UserService from '../services/UserService';
import SockJS from 'sockjs-client';
import Stomp from 'stompjs';
import { SOCKET_URL } from '../utils/constants';

// --- Component phụ: Hiển thị 1 thành viên ---
const MemberItem = ({ member, isCurrentUserOwner, isCurrentUserAdmin, onDeleteMember, onChangeRole }) => {
    const canDelete = (isCurrentUserOwner || isCurrentUserAdmin) && member.role !== 'OWNER';
    const canChangeRole = isCurrentUserOwner && member.role !== 'OWNER';
    return (
        <View style={styles.memberRow}>
            <View style={styles.memberInfo}>
                <Avatar uri={member.avatarUrl} name={member.username} size={36} style={{ marginRight: 10 }} />
                <View>
                    <Text style={styles.memberName}>{member.username}</Text>
                    <View style={styles.memberMeta}>
                        <View style={[styles.presenceDot, member.status === 'ONLINE' ? styles.onlineDot : styles.offlineDot]} />
                        <Text style={styles.memberStatus}>{member.status === 'ONLINE' ? 'Online' : 'Offline'}</Text>
                        <Text style={styles.memberRole}>{member.role === 'OWNER' ? 'CHỦ NHÓM' : member.role === 'ADMIN' ? 'QUẢN TRỊ' : 'THÀNH VIÊN'}</Text>
                    </View>
                </View>
            </View>

            {/* Nút Xóa (Chỉ hiện cho Chủ nhóm đang xem, và không xóa chính mình) */}
            {canDelete && (
                <TouchableOpacity style={styles.deleteButton} onPress={() => onDeleteMember(member.id, member.username)}>
                    <Ionicons name="close" size={18} color="#ed4245" />
                </TouchableOpacity>
            )}
            {canChangeRole && (
                <TouchableOpacity style={styles.roleButton} onPress={() => onChangeRole(member)}>
                    <Ionicons name="shield-checkmark-outline" size={18} color="#b9bbbe" />
                </TouchableOpacity>
            )}
        </View>
    );
};

export default function ServerProfileScreen({ route, navigation }) {
    const { server, currentUser } = route.params;

    const [currentServer, setCurrentServer] = useState(server);
    // Tạm thời dùng list có sẵn từ server.members. Backend cần phải trả về list này.
    const [members, setMembers] = useState(server.members || [{
        id: server.owner.id,
        username: server.owner.username,
        avatarUrl: server.owner.avatarUrl,
        // Giả định owner là member duy nhất nếu không có list members
    }]);

    const [isUploading, setIsUploading] = useState(false);
    const [inviteModalVisible, setInviteModalVisible] = useState(false); // 👈 STATE MODAL MỜI
    const isCurrentUserOwner = String(currentServer.owner.id) === String(currentUser.id);
    const currentMembership = members.find(member => String(member.id) === String(currentUser.id));
    const isCurrentUserAdmin = currentMembership?.role === 'ADMIN';

    useEffect(() => {
        const socket = new SockJS(SOCKET_URL);
        const client = Stomp.over(socket);
        client.debug = null;
        client.connect({}, () => {
            client.subscribe('/topic/status', message => {
                const presence = JSON.parse(message.body);
                setMembers(previous => previous.map(member => String(member.id) === String(presence.id)
                    ? { ...member, status: presence.status }
                    : member));
            });
        });
        return () => {
            if (client.connected) client.disconnect();
            else socket.close();
        };
    }, []);

    // --- LOGIC TẢI LẠI THÀNH VIÊN SAU KHI MỜI/XÓA ---
    const reloadMembers = useCallback(async () => {
        try {
            const serverId = currentServer.id;

            // 🔥 GỌI API THỰC TẾ ĐỂ LẤY SERVER OBJECT (Có danh sách members mới nhất)
            // Yêu cầu: Bạn phải có hàm UserService.getServerById() và Backend API GET /api/servers/{id}
            const [serverData, memberData] = await Promise.all([
                UserService.getServerById(serverId),
                UserService.getServerMemberDetails(serverId)
            ]);
            if (Array.isArray(memberData)) setMembers(memberData);
            if (serverData) setCurrentServer(serverData);
        } catch (e) {
            console.error("❌ Lỗi tải lại thành viên khi focus:", e);
            // Alert.alert("Lỗi tải", "Không thể cập nhật danh sách nhóm."); 
        }
    }, [currentServer.id]);

    // --- CHỨC NĂNG 1: SAO CHÉP LINK MỜI ---
    const handleCopyInviteLink = async () => {
        if (!isCurrentUserOwner) return Alert.alert("Lỗi", "Bạn không có quyền này.");

        try {
            const inviteCode = await UserService.getInviteLink(currentServer.id);
            if (inviteCode) {
                await Clipboard.setStringAsync(inviteCode);
                Alert.alert("Thành công", `Đã sao chép mã mời: ${inviteCode}`);
            } else {
                Alert.alert("Lỗi", "Không thể lấy link mời.");
            }
        } catch (e) {
            Alert.alert("Lỗi", "Không thể lấy link mời.");
        }
    };

    // --- CHỨC NĂNG 2: ĐỔI ICON SERVER (UPLOAD) ---
    const handleEditIcon = async () => {
        if (!isCurrentUserOwner) return; // Chỉ chủ nhóm mới được đổi

        try {
            // 1. Xin quyền và Chọn ảnh
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== 'granted') return Alert.alert("Lỗi", "Cần cấp quyền truy cập ảnh!");

            let result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: 'Images', allowsEditing: true, aspect: [1, 1], quality: 0.7,
            });

            if (result.canceled) return;

            setIsUploading(true);

            // 2. Upload ảnh lên Server và nhận đường dẫn
            const serverPath = await UserService.uploadImage(result.assets[0].uri);

            if (serverPath) {
                // 3. GỌI API CẬP NHẬT ĐỂ LƯU ĐƯỜNG DẪN MỚI VÀO DATABASE
                const updatedServer = await UserService.updateServerInfo(
                    currentServer.id,
                    { iconUrl: serverPath } // Truyền data cần cập nhật
                );

                // 4. Cập nhật State với Cache Busting
                const newIconUrlWithCacheBust = `${serverPath}?t=${new Date().getTime()}`;

                // Cập nhật currentServer với icon mới (để giao diện thay đổi ngay)
                setCurrentServer(prev => ({
                    ...prev,
                    iconUrl: newIconUrlWithCacheBust,
                }));

                Alert.alert("Thành công", "Đã cập nhật Icon nhóm.");
            } else {
                Alert.alert("Lỗi", "Upload ảnh thất bại (Server trả về null).");
            }
        } catch (error) {
            console.error("Lỗi đổi icon:", error);
            // Hiển thị lỗi từ Backend nếu có (ví dụ: "Cập nhật server thất bại.")
            const errorMessage = error.response?.data || "Có lỗi xảy ra khi đổi Icon.";
            Alert.alert("Lỗi", errorMessage.toString());
        } finally {
            setIsUploading(false);
        }
    };

    // --- CHỨC NĂNG 3: MỜI THÀNH VIÊN (Mở modal cục bộ) ---
    const handleInviteMember = () => {
        setInviteModalVisible(true); // 👈 Dùng state cục bộ
    };
    useFocusEffect(
        useCallback(() => {
            console.log("🔄 Đang tải lại danh sách thành viên...");
            // Hàm này sẽ chạy mỗi khi màn hình được mở (focus)
            reloadMembers();

            return () => {
                // Cleanup function (không cần thiết ở đây)
            };
        }, [reloadMembers])
    );
    // --- CHỨC NĂNG 4: XÓA THÀNH VIÊN ---
    const handleDeleteMember = (memberId, username) => {
        // Chủ nhóm không thể tự xóa mình
        if (String(memberId) === String(currentUser.id)) {
            return Alert.alert("Lỗi", "Không thể xóa chính bạn khỏi nhóm.");
        }

        Alert.alert(
            "Xóa thành viên",
            `Bạn có chắc chắn muốn xóa ${username} khỏi nhóm?`,
            [
                { text: "Hủy", style: "cancel" },
                {
                    text: "Đồng ý",
                    onPress: async () => {
                        try {
                            // 👇 GỌI API THỰC TẾ
                            const message = await UserService.deleteMember(currentServer.id, memberId);
                            // Cập nhật State để loại bỏ thành viên ngay lập tức
                            await reloadMembers();
                            // Nếu cần, bạn có thể gọi reloadMembers() ở đây
                        } catch (e) {
                            Alert.alert("Lỗi", e.toString()); // Hiển thị lỗi từ Backend
                        }
                    }
                }
            ]
        );
    };

    const handleChangeRole = (member) => {
        const nextRole = member.role === 'ADMIN' ? 'MEMBER' : 'ADMIN';
        Alert.alert('Phân quyền thành viên', `Đổi ${member.username} thành ${nextRole === 'ADMIN' ? 'quản trị viên' : 'thành viên'}?`, [
            { text: 'Hủy', style: 'cancel' },
            { text: 'Xác nhận', onPress: async () => {
                try {
                    await UserService.updateServerMemberRole(currentServer.id, member.id, nextRole);
                    await reloadMembers();
                } catch (error) {
                    Alert.alert('Lỗi', String(error.response?.data || error));
                }
            } }
        ]);
    };

    // --- CHỨC NĂNG 5: CHỈNH SỬA TÊN NHÓM ---
    const handleEditName = () => {
        if (!isCurrentUserOwner) return;

        // Sử dụng Alert.prompt để nhập liệu (chỉ hỗ trợ trên iOS/Android)
        Alert.prompt(
            "Đổi tên nhóm",
            "Nhập tên mới cho nhóm của bạn:",
            [
                {
                    text: "Hủy",
                    style: "cancel",
                },
                {
                    text: "Đổi tên",
                    onPress: async (newName) => {
                        // 1. Kiểm tra tên hợp lệ
                        if (!newName || newName.trim() === "") {
                            return Alert.alert("Lỗi", "Tên nhóm không được để trống.");
                        }

                        // 2. Gọi API cập nhật
                        try {
                            // GỌI API: Tên server mới sẽ được gửi trong {name: newName}
                            const updatedServer = await UserService.updateServerInfo(
                                currentServer.id,
                                { name: newName.trim() }
                            );

                            // 3. Cập nhật State Frontend
                            setCurrentServer(prev => ({
                                ...prev,
                                name: updatedServer.name // Lấy tên đã được Backend chấp nhận
                            }));

                            Alert.alert("Thành công", `Đã đổi tên nhóm thành: ${updatedServer.name}`);

                        } catch (error) {
                            console.error("Lỗi đổi tên nhóm:", error);
                            const errorMessage = error.toString();
                            Alert.alert("Lỗi", errorMessage);
                        }
                    },
                },
            ],
            'plain-text', // Kiểu nhập liệu
            currentServer.name // Giá trị mặc định
        );
    };

    const handleLeaveServer = () => {
        Alert.alert(
            "Rời khỏi máy chủ",
            `Bạn có chắc chắn muốn rời khỏi ${currentServer.name}? Bạn sẽ cần mã mời mới để tham gia lại.`,
            [
                { text: "Hủy", style: "cancel" },
                {
                    text: "Rời nhóm",
                    style: "destructive",
                    onPress: async () => {
                        try {
                            // Gọi API xử lý rời nhóm
                            await UserService.leaveServer(currentServer.id);
                            Alert.alert("Thành công", "Bạn đã rời khỏi máy chủ.");
                            // Quay lại màn hình Main sau khi rời thành công
                            navigation.navigate('Main');
                        } catch (error) {
                            const errorMsg = error.response?.data || "Không thể rời nhóm lúc này.";
                            Alert.alert("Lỗi", errorMsg);
                        }
                    }
                }
            ]
        );
    };
    const handleDeleteServer = () => {
        Alert.alert(
            "Giải tán nhóm",
            `Hành động này không thể hoàn tác. Bạn có chắc chắn muốn xóa nhóm "${currentServer.name}"?`,
            [
                { text: "Hủy", style: "cancel" },
                {
                    text: "XÓA NHÓM",
                    style: "destructive",
                    onPress: async () => {
                        try {
                            // Gọi API xóa nhóm
                            await UserService.deleteServer(currentServer.id);
                            Alert.alert("Thành công", "Nhóm đã được giải tán.");
                            navigation.navigate('Main');
                        } catch (error) {
                            console.log("--- DEBUG XÓA NHÓM ---");
                            console.log("Mã lỗi HTTP:", error.response?.status); // Ví dụ: 400, 403, 500
                            console.log("Nội dung lỗi từ Backend:", error.response?.data);

                            const errorMsg = error.response?.data || "Không thể xóa nhóm.";
                            Alert.alert("Lỗi", errorMsg);
                        }
                    }
                }
            ]
        );
    };
    // --- GIAO DIỆN ---
    return (
        <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Hồ sơ nhóm</Text>
            </View>

            <ScrollView style={styles.content}>

                {/* 1. THÔNG TIN CHUNG (AVATAR & TÊN) */}
                <View style={styles.profileSection}>
                    <TouchableOpacity onPress={handleEditIcon} disabled={!isCurrentUserOwner || isUploading}>
                        <View style={styles.avatarWrapper}>
                            {isUploading ? (
                                <ActivityIndicator size="large" color="white" style={{ width: 100, height: 100, borderRadius: 50, backgroundColor: '#36393f' }} />
                            ) : (
                                <Avatar uri={currentServer.iconUrl} name={currentServer.name} size={100} />
                            )}
                            {isCurrentUserOwner && (
                                <View style={styles.cameraIcon}>
                                    <Ionicons name="create" size={20} color="white" />
                                </View>
                            )}
                        </View>
                    </TouchableOpacity>

                    <TouchableOpacity onPress={handleEditName} disabled={!isCurrentUserOwner}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Text style={styles.serverName}>{currentServer.name}</Text>
                            {isCurrentUserOwner && <Ionicons name="pencil" size={16} color="#b9bbbe" style={{ marginLeft: 8 }} />}
                        </View>
                    </TouchableOpacity>

                    <Text style={styles.ownerText}>Chủ nhóm: {currentServer.owner.username}</Text>
                </View>

                {/* 2. CHỨC NĂNG CHÍNH */}
                <View style={styles.buttonGroup}>
                    {/* Nút Sao chép Link (Chỉ cho Chủ nhóm) */}
                    {(isCurrentUserOwner || isCurrentUserAdmin) && (
                        <TouchableOpacity style={[styles.actionButton, { backgroundColor: '#5865F2' }]} onPress={handleCopyInviteLink}>
                            <Ionicons name="link-outline" size={20} color="white" style={{ marginRight: 10 }} />
                            <Text style={styles.actionButtonText}>SAO CHÉP LINK MỜI</Text>
                        </TouchableOpacity>,

                        <TouchableOpacity style={[styles.actionButton, { backgroundColor: '#3ba55d' }]} onPress={handleInviteMember}>
                            <Ionicons name="person-add-outline" size={20} color="white" style={{ marginRight: 10 }} />
                            <Text style={styles.actionButtonText}>MỜI THÀNH VIÊN</Text>
                        </TouchableOpacity>
                    )}

                </View>

                {/* 3. DANH SÁCH THÀNH VIÊN */}
                <Text style={styles.memberListTitle}>Thành viên ({members.length})</Text>
                <View style={styles.memberListContainer}>
                    {members.map(member => (
                        <MemberItem
                            key={member.id}
                            member={member}
                            isCurrentUserOwner={isCurrentUserOwner}
                            isCurrentUserAdmin={isCurrentUserAdmin}
                            onDeleteMember={handleDeleteMember}
                            onChangeRole={handleChangeRole}
                        />
                    ))}
                </View>


                {!isCurrentUserOwner && (
                    <TouchableOpacity
                        style={styles.leaveServerButton}
                        onPress={handleLeaveServer}
                    >
                        <Ionicons name="log-out-outline" size={20} color="#ed4245" style={{ marginRight: 10 }} />
                        <Text style={styles.leaveServerButtonText}>RỜI KHỎI MÁY CHỦ</Text>
                    </TouchableOpacity>
                )}
                {isCurrentUserOwner && (
                    <TouchableOpacity style={styles.deleteServerButton} onPress={handleDeleteServer}>
                        <Ionicons name="trash-outline" size={20} color="#ed4245" style={{ marginRight: 10 }} />
                        <Text style={styles.deleteServerButtonText}>GIẢI TÁN NHÓM</Text>
                    </TouchableOpacity>
                )}
            </ScrollView>

            {/* MODAL MỜI THÀNH VIÊN (Tự quản lý) */}
            <MemberSelectionModal
                serverId={currentServer.id}
                visible={inviteModalVisible}
                onClose={() => setInviteModalVisible(false)}
                onMemberInvited={reloadMembers} // Tải lại danh sách thành viên sau khi mời thành công
            />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#2f3136' },
    header: { flexDirection: 'row', alignItems: 'center', padding: 15, borderBottomWidth: 1, borderBottomColor: '#202225', backgroundColor: '#36393f' },
    backButton: { marginRight: 15 },
    headerTitle: { color: 'white', fontSize: 18, fontWeight: 'bold' },
    content: { padding: 15 },
    profileSection: { alignItems: 'center', paddingVertical: 20, marginBottom: 20, backgroundColor: '#36393f', borderRadius: 8 },
    avatarWrapper: { position: 'relative', marginBottom: 15 },
    cameraIcon: { position: 'absolute', bottom: 0, right: 0, backgroundColor: '#5865F2', borderRadius: 15, width: 30, height: 30, justifyContent: 'center', alignItems: 'center', borderWidth: 3, borderColor: '#36393f' },
    serverName: { color: 'white', fontSize: 24, fontWeight: 'bold', marginBottom: 5 },
    ownerText: { color: '#b9bbbe', fontSize: 14 },
    buttonGroup: { marginBottom: 20 },
    actionButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 12, borderRadius: 5, marginBottom: 10 },
    actionButtonText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
    memberListTitle: { color: '#b9bbbe', fontSize: 14, fontWeight: 'bold', marginBottom: 10, paddingHorizontal: 10 },
    memberListContainer: { backgroundColor: '#36393f', borderRadius: 8, padding: 10 },
    memberRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#2f3136' },
    memberInfo: { flexDirection: 'row', alignItems: 'center' },
    memberName: { color: 'white', fontSize: 16, fontWeight: '500' },
    memberRole: { color: '#5865F2', fontSize: 10, marginLeft: 8, fontWeight: 'bold' },
    memberMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
    presenceDot: { width: 7, height: 7, borderRadius: 4, marginRight: 4 },
    onlineDot: { backgroundColor: '#3ba55d' },
    offlineDot: { backgroundColor: '#747f8d' },
    memberStatus: { color: '#b9bbbe', fontSize: 11 },
    roleButton: { padding: 8, marginRight: 4 },
    deleteButton: { padding: 5, backgroundColor: 'rgba(237, 66, 69, 0.2)', borderRadius: 5 },
    leaveServerButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 15,
        backgroundColor: '#36393f',
        borderRadius: 5,
        marginTop: 30,
        marginBottom: 40, // Khoảng cách để không bị dính đáy
        borderWidth: 1,
        borderColor: '#ed4245',
    },
    leaveServerButtonText: {
        color: '#ed4245',
        fontWeight: 'bold',
        fontSize: 14,
    },
    deleteServerButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 15,
        backgroundColor: 'rgba(237, 66, 69, 0.1)',
        borderRadius: 5,
        marginTop: 30,
        marginBottom: 40,
        borderWidth: 1,
        borderColor: '#ed4245',
    },
    deleteServerButtonText: {
        color: '#ed4245',
        fontWeight: 'bold',
        fontSize: 14,
    },
});
