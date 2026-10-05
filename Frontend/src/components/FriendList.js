import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Dimensions,
    FlatList,
    KeyboardAvoidingView,
    Modal,
    Platform,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import UserService from '../services/UserService';
import Avatar from './Avatar';

const { width } = Dimensions.get('window');

// Item Bạn bè
const FriendItem = ({ friend, onPress, onOptionPress }) => (
    <TouchableOpacity style={styles.friendItem} onPress={onPress}>
        <Avatar uri={friend.avatarUrl} name={friend.username} size={40} style={{ marginRight: 10 }} />
        <View style={{ flex: 1 }}>
            <Text style={styles.friendName}>{friend.username || "Không tên"}</Text>
            <Text style={styles.friendStatus}>
                <View style={[styles.statusIndicator, friend.status === 'ONLINE' ? styles.onlineStatus : { backgroundColor: 'gray' }]} />
                {friend.status === 'ONLINE' ? 'Online' : 'Offline'}
            </Text>
        </View>
        <TouchableOpacity style={styles.moreBtn} onPress={() => onOptionPress(friend)}>
            <Ionicons name="ellipsis-vertical" size={20} color="#b9bbbe" />
        </TouchableOpacity>
    </TouchableOpacity>
);

// Item Lời mời
const RequestItem = ({ request, type, onAccept, onCancel }) => {
    const isReceived = type === 'received';
    const targetName = isReceived ? request.sender.username : request.receiver.username;
    const messageStr = isReceived ? "muốn kết bạn." : "Đang chờ...";
    return (
        <View style={styles.requestItem}>
            <View style={{ flex: 1 }}><Text style={styles.requestText}><Text style={{ fontWeight: 'bold', color: 'white' }}>{targetName}</Text> {messageStr}</Text></View>
            <View style={{ flexDirection: 'row' }}>
                {isReceived && <TouchableOpacity style={[styles.actionBtn, styles.acceptBtn]} onPress={() => onAccept(request.id)}><Ionicons name="checkmark" size={18} color="white" /></TouchableOpacity>}
                <TouchableOpacity style={[styles.actionBtn, styles.cancelBtn]} onPress={() => onCancel(request.id)}><Ionicons name="close" size={18} color="white" /></TouchableOpacity>
            </View>
        </View>
    );
};
// Item Lời mời vào Máy chủ
const ServerInviteItem = ({ invite, onRespond }) => (
    <View style={styles.requestItem}>
        <View style={{ flex: 1 }}>
            <Text style={styles.requestText}>
                <Text style={{ fontWeight: 'bold', color: 'white' }}>{invite.inviter.username}</Text>
                {" mời bạn vào nhóm "}
                <Text style={{ fontWeight: 'bold', color: '#5865F2' }}>{invite.server.name}</Text>
            </Text>
        </View>
        <View style={{ flexDirection: 'row' }}>
            <TouchableOpacity
                style={[styles.actionBtn, styles.acceptBtn]}
                onPress={() => onRespond(invite.id, true)}
            >
                <Ionicons name="checkmark" size={18} color="white" />
            </TouchableOpacity>
            <TouchableOpacity
                style={[styles.actionBtn, styles.cancelBtn]}
                onPress={() => onRespond(invite.id, false)}
            >
                <Ionicons name="close" size={18} color="white" />
            </TouchableOpacity>
        </View>
    </View>
);
export default function FriendList({ navigation }) {
    const [currentUser, setCurrentUser] = useState(null);
    const [friends, setFriends] = useState([]);
    const [pendingRequests, setPendingRequests] = useState([]);
    const [sentRequests, setSentRequests] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [profileModalVisible, setProfileModalVisible] = useState(false);
    const [profileData, setProfileData] = useState(null);
    // Modal states cũ
    const [addModalVisible, setAddModalVisible] = useState(false);
    const [requestsModalVisible, setRequestsModalVisible] = useState(false);
    const [friendNameInput, setFriendNameInput] = useState('');

    const [optionModalVisible, setOptionModalVisible] = useState(false);
    const [selectedFriend, setSelectedFriend] = useState(null);

    const [searchQuery, setSearchQuery] = useState('');

    const [serverInvites, setServerInvites] = useState([]);
    const loadCurrentUser = async () => {
        try {
            const id = await AsyncStorage.getItem('userId');
            const username = await AsyncStorage.getItem('username');
            const avatarUrl = await AsyncStorage.getItem('avatarUrl');
            if (id) {
                const finalUsername = username ? username : `User ${id}`;
                const userFromStorage = { id: id, username: finalUsername, avatarUrl };
                setCurrentUser(userFromStorage);
                return userFromStorage;
            }
        } catch (e) { console.error(e); }
        return null;
    };
    const handleViewProfile = async () => {
        if (!selectedFriend) return;
        try {
            setOptionModalVisible(false); // Đóng menu 3 chấm
            const data = await UserService.getProfileDetail(currentUser.id, selectedFriend.id);
            setProfileData(data);
            setProfileModalVisible(true); // Mở Modal hồ sơ
        } catch (error) {
            Alert.alert("Lỗi", "Không thể tải hồ sơ.");
        }
    };
    const fetchData = useCallback(async (isBackground = false) => {
        if (!isBackground) setIsLoading(true);

        try {
            const user = currentUser || await loadCurrentUser();
            if (user && user.id) {
                const userId = parseInt(user.id);
                const [friendsData, requestsData, sentData, serverInvitesData] = await Promise.all([
                    UserService.getFriends(userId),
                    UserService.getPendingRequests(userId),
                    UserService.getSentRequests(userId),
                    UserService.getServerInvites(userId)
                ]);
                // Cập nhật State
                setFriends(friendsData);
                setPendingRequests(requestsData);
                setSentRequests(sentData);
                setServerInvites(serverInvitesData);
            }
        } catch (error) {
            console.error("Lỗi fetchData:", error);
        } finally {
            if (!isBackground) setIsLoading(false);
        }
    }, [currentUser]);

    useFocusEffect(
        useCallback(() => {
            fetchData(false);
        }, [fetchData])
    );

    useEffect(() => {
        const interval = setInterval(() => {
            fetchData(true);
        }, 5000);

        return () => clearInterval(interval);
    }, [fetchData]);

    const handleChat = (friend) => {
        if (!currentUser) return;
        navigation.navigate('Chat', {
            myId: currentUser.id, friendId: friend.id, friendUsername: friend.username
        });
    };


    const handleOptionPress = (friend) => {
        setSelectedFriend(friend);
        setOptionModalVisible(true);
    };


    const handleUnfriend = async () => {
        if (!selectedFriend) return;

        const performUnfriend = async () => {
            try {
                await UserService.unfriend(currentUser.id, selectedFriend.id);
                setOptionModalVisible(false); // Đóng menu tùy chọn
                fetchData();
            } catch (error) {
                console.error("Lỗi xóa bạn:", error);
                const msg = "Không thể xóa bạn lúc này.";
                if (Platform.OS === 'web') alert(msg); else Alert.alert("Lỗi", msg);
            }
        };

        const confirmMsg = `Xóa ${selectedFriend.username} khỏi danh sách bạn bè?`;

        if (Platform.OS === 'web') {
            // Dùng confirm mặc định của trình duyệt trên Web
            if (window.confirm(confirmMsg)) {
                performUnfriend();
            }
        } else {
            // Dùng Alert của hệ điều hành trên Mobile
            Alert.alert("Xác nhận", confirmMsg, [
                { text: "Hủy", style: "cancel" },
                { text: "Xóa", style: "destructive", onPress: performUnfriend }
            ]);
        }
    };
    const handleRespondServerInvite = async (inviteId, accept) => {
        try {
            await UserService.respondToServerInvite(inviteId, accept);
            const msg = accept ? "Bạn đã tham gia máy chủ!" : "Đã từ chối lời mời.";

            if (Platform.OS === 'web') alert(msg);
            else Alert.alert("Thông báo", msg);

            fetchData(); // Tải lại dữ liệu để cập nhật danh sách Server và lời mời
        } catch (error) {
            console.error("Lỗi phản hồi lời mời server:", error);
        }
    };

    const handleLogout = async () => {
        const doLogout = async () => { await UserService.logout(); navigation.reset({ index: 0, routes: [{ name: 'Login' }] }); };
        if (Platform.OS === 'web') { if (window.confirm("Đăng xuất?")) await doLogout(); }
        else { Alert.alert("Đăng xuất", "Bạn muốn đăng xuất?", [{ text: "Hủy" }, { text: "Đồng ý", onPress: doLogout }]); }
    };

    const submitAddFriend = async () => {
        const targetName = friendNameInput.trim();
        if (!targetName) { alert("Vui lòng nhập tên!"); return; }

        // 1. Kiểm tra xem người này đã là bạn chưa
        const isAlreadyFriend = friends.some(f => f.username === targetName);
        if (isAlreadyFriend) {
            Alert.alert("Thông báo", "Người này đã có trong danh sách bạn bè.");
            return;
        }

        // 2. Kiểm tra xem đã gửi lời mời chưa (Chặn gửi lần 2)
        const isAlreadySent = sentRequests.some(r => r.receiver.username === targetName);
        if (isAlreadySent) {
            Alert.alert("Thông báo", "Bạn đã gửi lời mời cho người này rồi.");
            return;
        }

        try {
            const result = await UserService.addFriend(currentUser.id, targetName);
            if (Platform.OS === 'web') alert(result); else Alert.alert("Thông báo", result);
            setAddModalVisible(false);
            setFriendNameInput('');
            fetchData();
        } catch (error) {
            // Lấy thông báo lỗi từ Backend nếu có
            const msg = error.response?.data || "Lỗi kết nối hoặc người dùng không tồn tại.";
            alert(msg);
        }
    };
    const handleAccept = async (requestId) => { try { await UserService.acceptRequest(requestId); fetchData(); } catch (error) { alert("Lỗi."); } };
    const handleCancel = async (requestId) => { try { await UserService.cancelRequest(requestId); fetchData(); } catch (error) { alert("Lỗi."); } };

    if (!currentUser) return <ActivityIndicator size="large" color="#5865F2" style={{ marginTop: 50 }} />;
    const badgeCount = pendingRequests.length + serverInvites.length;

    // Biến totalRequests (dùng cho tiêu đề Modal) vẫn giữ nguyên nếu bạn muốn hiện cả lời mời đã gửi
    const totalRequests = pendingRequests.length + sentRequests.length + serverInvites.length;
    const filteredFriends = friends.filter(friend =>
        friend.username?.toLowerCase().includes(searchQuery.toLowerCase())
    );
    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Bạn bè</Text>
                <View style={{ flexDirection: 'row' }}>
                    <TouchableOpacity style={styles.iconButton} onPress={() => setRequestsModalVisible(true)}>
                        <View>
                            <Ionicons name="notifications" size={24} color="#dcddde" />
                            {/* 👇 Sửa điều kiện ở đây từ pendingRequests.length thành badgeCount */}
                            {badgeCount > 0 && (
                                <View style={styles.badge}>
                                    <Text style={styles.badgeText}>{badgeCount}</Text>
                                </View>
                            )}
                        </View>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.iconButton} onPress={() => navigation.navigate('AddFriend')}>
                        <Ionicons name="person-add" size={24} color="#dcddde" />
                    </TouchableOpacity>
                </View>
            </View>

            <View style={styles.searchContainer}>
                <View style={styles.searchBar}>
                    <Ionicons name="search" size={18} color="#b9bbbe" style={{ marginRight: 8 }} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Tìm kiếm bạn bè"
                        placeholderTextColor="#72767d"
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                    />
                    {searchQuery.length > 0 && (
                        <TouchableOpacity onPress={() => setSearchQuery('')}>
                            <Ionicons name="close-circle" size={18} color="#b9bbbe" />
                        </TouchableOpacity>
                    )}
                </View>
            </View>
            <FlatList
                data={filteredFriends}
                keyExtractor={(item) => `friend-${item.id}`}
                renderItem={({ item }) => <FriendItem friend={item} onPress={() => handleChat(item)} onOptionPress={handleOptionPress} />}
                ListEmptyComponent={<Text style={styles.emptyText}>{searchQuery ? "Không tìm thấy kết quả." : "Chưa có bạn bè nào."}</Text>}
                refreshControl={
                    <RefreshControl
                        refreshing={isLoading}
                        onRefresh={() => fetchData(false)} // Kéo tay thì hiện loading
                        tintColor="#fff"
                    />
                }
            />

            {/* 👇 MODAL TÙY CHỌN BẠN BÈ (ACTION SHEET) */}
            <Modal transparent={true} visible={optionModalVisible} animationType="slide" onRequestClose={() => setOptionModalVisible(false)}>
                {/* Vùng bấm ra ngoài để tắt */}
                <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setOptionModalVisible(false)}>

                    {/* Nội dung Action Sheet nằm ở dưới đáy */}
                    <View style={styles.actionSheetContainer}>
                        {/* Tên người dùng */}
                        <Text style={styles.actionSheetTitle}>{selectedFriend?.username}</Text>

                        {/* Các nút chức năng */}
                        <View style={styles.actionGroup}>
                            <TouchableOpacity style={styles.actionBtnRow} onPress={handleViewProfile}>
                                <Ionicons name="person-circle-outline" size={24} color="#dcddde" />
                                <Text style={styles.actionBtnText}>Xem hồ sơ</Text>
                            </TouchableOpacity>
                            <View style={styles.divider} />

                            <TouchableOpacity style={styles.actionBtnRow} onPress={handleUnfriend}>
                                <Ionicons name="trash-outline" size={24} color="#ed4245" />
                                <Text style={[styles.actionBtnText, { color: '#ed4245' }]}>Xóa bạn</Text>
                            </TouchableOpacity>
                        </View>

                        {/* Nút Hủy */}
                        <TouchableOpacity style={styles.cancelActionBtn} onPress={() => setOptionModalVisible(false)}>
                            <Text style={styles.cancelActionText}>Hủy</Text>
                        </TouchableOpacity>
                    </View>
                </TouchableOpacity>
            </Modal>

            {/* ... Các Modal khác (Thêm bạn, Lời mời) giữ nguyên ... */}
            <Modal animationType="slide" transparent={true} visible={addModalVisible} onRequestClose={() => setAddModalVisible(false)}>
                <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.centerModalOverlay}>
                    <View style={styles.centerModalView}>
                        <Text style={styles.modalTitle}>Thêm bạn bè</Text>
                        <TextInput style={styles.input} placeholder="Ví dụ: namnguyen" placeholderTextColor="#72767d" value={friendNameInput} onChangeText={setFriendNameInput} autoCapitalize="none" />
                        <View style={styles.modalButtons}>
                            <TouchableOpacity style={[styles.btn, styles.btnCancelModal]} onPress={() => setAddModalVisible(false)}><Text style={styles.btnText}>Hủy</Text></TouchableOpacity>
                            <TouchableOpacity style={[styles.btn, styles.btnAdd]} onPress={submitAddFriend}><Text style={styles.btnText}>Gửi lời mời</Text></TouchableOpacity>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>

            <Modal animationType="slide" transparent={true} visible={requestsModalVisible} onRequestClose={() => setRequestsModalVisible(false)}>
                <View style={styles.centerModalOverlay}>
                    <View style={[styles.centerModalView, { maxHeight: '80%' }]}>
                        <Text style={styles.modalTitle}>Quản lý lời mời ({totalRequests})</Text>
                        <ScrollView style={{ width: '100%' }}>
                            {/* --- PHẦN 1: LỜI MỜI KẾT BẠN ĐÃ NHẬN --- */}
                            <Text style={styles.sectionTitle}>Lời mời kết bạn ({pendingRequests.length})</Text>
                            {pendingRequests.length === 0 ? <Text style={styles.noDataText}>Không có lời mời nào.</Text> : pendingRequests.map((item, index) => (
                                <RequestItem
                                    key={`received-${item.id}-${index}`}
                                    request={item}
                                    type="received"
                                    onAccept={handleAccept}
                                    onCancel={handleCancel}
                                />
                            ))}

                            {/* --- PHẦN 2: LỜI MỜI VÀO MÁY CHỦ (MỚI) --- */}
                            <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Lời mời vào máy chủ ({serverInvites.length})</Text>
                            {serverInvites.length === 0 ? (
                                <Text style={styles.noDataText}>Không có lời mời máy chủ nào.</Text>
                            ) : (
                                serverInvites.map((item, index) => (
                                    <ServerInviteItem
                                        key={`server-invite-${item.id}-${index}`}
                                        invite={item}
                                        onRespond={handleRespondServerInvite}
                                    />
                                ))
                            )}

                            {/* --- PHẦN 3: LỜI MỜI KẾT BẠN ĐÃ GỬI --- */}
                            <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Đã gửi lời mời kết bạn ({sentRequests.length})</Text>
                            {sentRequests.length === 0 ? <Text style={styles.noDataText}>Bạn chưa gửi lời mời nào.</Text> : sentRequests.map((item, index) => (
                                <RequestItem
                                    key={`sent-${item.id}-${index}`}
                                    request={item}
                                    type="sent"
                                    onAccept={null}
                                    onCancel={handleCancel}
                                />
                            ))}
                        </ScrollView>
                        <TouchableOpacity style={styles.modalCloseBtnDiscord} onPress={() => setRequestsModalVisible(false)}>
                            <Text style={{ color: 'white', fontWeight: 'bold' }}>Đóng</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            <Modal visible={profileModalVisible} transparent animationType="slide">
                <View style={styles.profileOverlay}>
                    <View style={styles.profileSheet}>
                        {/* Thanh kéo nhỏ phía trên giống ảnh mẫu */}
                        <View style={styles.dragHandle} />

                        <View style={styles.profileHeader}>
                            <Avatar uri={profileData?.avatarUrl} name={profileData?.username} size={80} />
                            <Text style={styles.profileName}>{profileData?.username}</Text>

                            <View style={styles.mutualStats}>
                                <Ionicons name="people" size={16} color="#b9bbbe" />
                                <Text style={styles.statsText}> {profileData?.mutualFriends} Bạn Chung</Text>
                            </View>
                        </View>

                        <TouchableOpacity style={styles.messageButton} onPress={() => {
                            setProfileModalVisible(false);
                            handleChat(selectedFriend);
                        }}>
                            <Ionicons name="chatbubble-ellipses" size={24} color="white" />
                            <Text style={styles.messageButtonText}>Tin nhắn</Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={styles.closeProfileBtn} onPress={() => setProfileModalVisible(false)}>
                            <Text style={{ color: '#ed4245', fontWeight: 'bold' }}>Đóng</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#36393f' },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 15, borderBottomWidth: 1, borderBottomColor: '#202225' },
    headerTitle: { color: 'white', fontSize: 16, fontWeight: 'bold' },
    iconButton: { padding: 5, marginLeft: 10 },

    friendItem: { flexDirection: 'row', alignItems: 'center', padding: 15, borderBottomWidth: 1, borderBottomColor: '#2f3136' },
    friendName: { color: '#dcddde', fontSize: 16, fontWeight: '500' },
    friendStatus: { flexDirection: 'row', alignItems: 'center', color: '#72767d', fontSize: 12 },
    statusIndicator: { width: 8, height: 8, borderRadius: 4, marginRight: 4 },
    onlineStatus: { backgroundColor: '#3ba55d' },
    moreBtn: { padding: 10 },

    emptyText: { textAlign: 'center', color: '#72767d', marginTop: 50 },
    welcomeArea: { padding: 10, backgroundColor: '#2f3136' },
    badge: { position: 'absolute', right: -2, top: -2, backgroundColor: 'red', borderRadius: 6, width: 14, height: 14, justifyContent: 'center', alignItems: 'center' },
    badgeText: { color: 'white', fontSize: 9, fontWeight: 'bold' },

    // 👇 STYLES CHO MODAL CENTER (THÊM BẠN, LỜI MỜI)
    centerModalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.8)' },
    centerModalView: { width: '90%', backgroundColor: '#36393f', borderRadius: 10, padding: 20, alignItems: 'center' },

    // 👇 STYLES CHO ACTION SHEET (MENU 3 CHẤM DƯỚI ĐÁY)
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    actionSheetContainer: { backgroundColor: '#2f3136', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
    actionSheetTitle: { color: 'white', fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 20 },
    actionGroup: { backgroundColor: '#36393f', borderRadius: 10, overflow: 'hidden' },
    actionBtnRow: { flexDirection: 'row', alignItems: 'center', padding: 15, justifyContent: 'center' },
    actionBtnText: { color: '#dcddde', fontSize: 16, fontWeight: '500', marginLeft: 10 },
    divider: { height: 1, backgroundColor: '#202225' },
    cancelActionBtn: { marginTop: 15, backgroundColor: '#36393f', padding: 15, borderRadius: 10, alignItems: 'center' },
    cancelActionText: { color: '#ed4245', fontWeight: 'bold', fontSize: 16 },

    // Styles cũ
    modalTitle: { fontSize: 20, fontWeight: 'bold', color: 'white', marginBottom: 15 },
    input: { width: '100%', backgroundColor: '#202225', color: 'white', padding: 15, borderRadius: 5, marginBottom: 20 },
    modalButtons: { flexDirection: 'row', width: '100%', justifyContent: 'space-between' },
    btn: { flex: 1, padding: 15, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
    btnCancelModal: { backgroundColor: '#4f545c', marginRight: 5 },
    btnAdd: { backgroundColor: '#5865F2', marginLeft: 5 },
    btnText: { color: 'white', fontWeight: 'bold' },
    sectionTitle: { color: '#b9bbbe', fontWeight: 'bold', marginBottom: 5 },
    noDataText: { color: '#72767d', fontStyle: 'italic', marginBottom: 10 },
    requestItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#2f3136', padding: 10, borderRadius: 5, marginBottom: 8, width: '100%' },
    requestText: { color: '#b9bbbe', flex: 1 },
    actionBtn: { width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center', marginLeft: 8 },
    acceptBtn: { backgroundColor: '#3ba55d' },
    cancelBtn: { backgroundColor: '#ed4245' },
    modalCloseBtnDiscord: { marginTop: 15, width: '100%', paddingVertical: 12, backgroundColor: '#4f545c', borderRadius: 3, alignItems: 'center' },

    profileOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
    profileSheet: { backgroundColor: '#18191c', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, alignItems: 'center' },
    dragHandle: { width: 40, height: 4, backgroundColor: '#4f545c', borderRadius: 2, marginBottom: 20 },
    profileHeader: { alignItems: 'center', marginBottom: 25 },
    profileName: { color: 'white', fontSize: 24, fontWeight: 'bold', marginTop: 10 },
    profileTag: { color: '#b9bbbe', fontSize: 14 },
    mutualStats: { flexDirection: 'row', alignItems: 'center', marginTop: 15 },
    statsText: { color: '#b9bbbe', fontSize: 13 },
    statsDivider: { color: '#4f545c', marginHorizontal: 5 },
    messageButton: { backgroundColor: '#5865F2', flexDirection: 'row', width: '100%', padding: 15, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
    messageButtonText: { color: 'white', fontWeight: 'bold', marginLeft: 10, fontSize: 16 },
    closeProfileBtn: { marginTop: 20, padding: 10 },
    searchContainer: {
        paddingHorizontal: 15,
        paddingVertical: 10,
        backgroundColor: '#36393f',
    },
    searchBar: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#202225', // Màu nền tối hơn đúng chất Discord
        borderRadius: 5,
        paddingHorizontal: 10,
        height: 35,
    },
    searchInput: {
        flex: 1,
        color: '#dcddde',
        fontSize: 14,
        padding: 0, // Xóa padding mặc định của Android
    },
});