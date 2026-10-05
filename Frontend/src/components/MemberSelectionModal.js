// src/components/MemberSelectionModal.js

import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import UserService from '../services/UserService';
import Avatar from './Avatar';

const MemberSelectionModal = ({ serverId, visible, onClose, onMemberInvited }) => {
    const [myFriends, setMyFriends] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [invitingIds, setInvitingIds] = useState([]);


    useEffect(() => {
        if (visible) {
            loadFriendsForInvite();
        }
    }, [visible]);

    const loadFriendsForInvite = async () => {
        setIsLoading(true);
        try {
            const userId = await UserService.getUserId(); // Lấy ID người dùng
            if (!userId) return;

            // 1. Lấy danh sách bạn bè
            const friends = await UserService.getFriends(parseInt(userId));
            // 2. Lấy danh sách ID thành viên của server
            const memberIds = await UserService.getServerMembers(serverId);

            // Lọc ra bạn bè chưa tham gia nhóm
            const friendsNotJoined = friends.filter(f => !memberIds.includes(f.id));

            setMyFriends(friendsNotJoined);
        } catch (e) {
            console.error("Lỗi tải danh sách mời:", e);
            Alert.alert("Lỗi", "Không thể tải danh sách bạn bè.");
            setMyFriends([]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleInvite = async (friendId, username) => {
        // Tránh bấm nhiều lần cho cùng 1 người
        if (invitingIds.includes(friendId)) return;

        setInvitingIds(prev => [...prev, friendId]);

        try {
            const myId = await UserService.getUserId();

            // 👇 SỬA TẠI ĐÂY: Gọi API gửi lời mời (Chờ xác nhận)
            const result = await UserService.sendServerInvite(serverId, myId, friendId);

            const successMsg = `Đã gửi lời mời tới ${username}. Chờ họ xác nhận nhé!`;
            if (Platform.OS === 'web') {
                alert(successMsg);
            } else {
                Alert.alert("Thông báo", successMsg);
            }
            // Xóa người vừa mời khỏi danh sách tạm thời trên Modal 
            // (Vì lời mời đã ở trạng thái PENDING, không nên hiện nút mời tiếp)
            setMyFriends(prev => prev.filter(f => String(f.id) !== String(friendId)));

            // Lưu ý: Không cần gọi onMemberInvited() vì danh sách thành viên 
            // chính thức chưa thay đổi cho đến khi họ chấp nhận.
        } catch (error) {
            const errorMessage = typeof error === 'string' ? error : (error.response?.data || "Mời thất bại.");
            if (Platform.OS === 'web') alert(errorMessage); else Alert.alert("Thất bại", errorMessage);
        } finally {
            setInvitingIds(prev => prev.filter(id => id !== friendId));
        }
    };
    const renderFriendRow = ({ item }) => {
        const isInviting = invitingIds.includes(item.id);
        return (
            <View style={styles.inviteRow}>
                <View style={styles.inviteInfo}>
                    <Avatar uri={item.avatarUrl} name={item.username} size={36} style={{ marginRight: 10 }} />
                    <Text style={styles.inviteName}>{item.username}</Text>
                </View>
                <TouchableOpacity
                    style={[styles.inviteBtnDiscord, isInviting && { opacity: 0.5 }]}
                    onPress={() => handleInvite(item.id, item.username)}
                    disabled={isInviting}
                >
                    {isInviting ? (
                        <ActivityIndicator size="small" color="#3ba55d" />
                    ) : (
                        <Text style={styles.inviteBtnText}>Mời</Text>
                    )}
                </TouchableOpacity>
            </View>
        );
    };

    return (
        <Modal transparent={true} visible={visible} animationType="slide" onRequestClose={onClose}>
            <View style={styles.modalOverlay}>
                <View style={[styles.modalView, { height: '80%' }]}>
                    <Text style={styles.modalTitle}>Mời bạn bè vào nhóm</Text>

                    {isLoading ? (
                        <View style={{ flex: 1, justifyContent: 'center' }}>
                            <ActivityIndicator size="large" color="#5865F2" />
                        </View>
                    ) : (
                        <FlatList
                            data={myFriends}
                            keyExtractor={item => item.id.toString()}
                            renderItem={renderFriendRow}
                            ListEmptyComponent={<Text style={styles.emptyText}>Tất cả bạn bè đã tham gia nhóm này.</Text>}
                            contentContainerStyle={{ flexGrow: 1 }}
                        />
                    )}

                    <TouchableOpacity onPress={onClose} style={styles.modalCloseBtnDiscord}>
                        <Text style={{ color: 'white', fontWeight: 'bold' }}>Đóng</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.8)' },
    modalView: { width: '90%', backgroundColor: '#36393f', borderRadius: 10, padding: 20 },
    modalTitle: { fontSize: 20, fontWeight: 'bold', color: 'white', marginBottom: 15, textAlign: 'center' },
    emptyText: { color: '#b9bbbe', textAlign: 'center', marginTop: 20 },
    inviteRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#2f3136' },
    inviteInfo: { flexDirection: 'row', alignItems: 'center' },
    inviteName: { color: 'white', fontWeight: 'bold', fontSize: 16 },
    inviteBtnDiscord: { borderWidth: 1, borderColor: '#3ba55d', paddingHorizontal: 16, paddingVertical: 6, borderRadius: 3, backgroundColor: 'transparent' },
    inviteBtnText: { color: '#3ba55d', fontWeight: 'bold', fontSize: 12 },
    modalCloseBtnDiscord: { marginTop: 15, width: '100%', paddingVertical: 12, backgroundColor: '#4f545c', borderRadius: 3, alignItems: 'center' },
});

export default MemberSelectionModal;