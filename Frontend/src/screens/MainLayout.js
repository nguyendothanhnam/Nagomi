import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    AppState,
    Image,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
// 👇 Dùng thư viện chuẩn
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import axios from 'axios';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from 'react-native-vector-icons/Ionicons';
import SockJS from 'sockjs-client';
import Stomp from 'stompjs';
import Avatar from '../components/Avatar';
import FriendList from '../components/FriendList';
import UserService from '../services/UserService';
import { BASE_URL, BASE_URL_IMG, SOCKET_URL, } from '../utils/constants';

const API_URL = BASE_URL;
export default function MainLayout({ navigation, route }) {
    const [servers, setServers] = useState([]);
    const [selectedServer, setSelectedServer] = useState(null);
    const [channels, setChannels] = useState([]);
    const [currentUser, setCurrentUser] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    const stompClient = useRef(null);
    // 👇 Biến ref cho AppState (Trạng thái ứng dụng: active/background)
    const appState = useRef(AppState.currentState);
    // Modal States
    const [createChannelVisible, setCreateChannelVisible] = useState(false);
    const [newChannelName, setNewChannelName] = useState('');
    const [newChannelType, setNewChannelType] = useState('TEXT');

    // const [inviteModalVisible, setInviteModalVisible] = useState(false);
    // const [myFriends, setMyFriends] = useState([]);

    const [createServerVisible, setCreateServerVisible] = useState(false);
    const [newServerName, setNewServerName] = useState('');
    const [newServerIcon, setNewServerIcon] = useState(null);
    const [isUploadingServerIcon, setIsUploadingServerIcon] = useState(false);

    const [isUploadingUserAvatar, setIsUploadingUserAvatar] = useState(false);

    const [inviteLink, setInviteLink] = useState(null);

    const [voiceStatus, setVoiceStatus] = useState({});

    useFocusEffect(
        useCallback(() => {
            const fetchServers = async () => {
                const token = await AsyncStorage.getItem('userToken');
                const userId = await AsyncStorage.getItem('userId');

                if (token && userId) {
                    console.log("🔄 Màn hình được focus: Đang làm mới danh sách Server...");
                    // Gọi lại hàm loadServers để cập nhật dữ liệu mới nhất từ DB
                    await loadServers(userId, token);

                    // Kiểm tra xem Server đang chọn (selectedServer) còn tồn tại không
                    // Nếu chủ nhóm xóa server đó rồi, ta phải reset selectedServer về null
                    if (selectedServer) {
                        try {
                            const checkServer = await axios.get(`${API_URL}/servers/${selectedServer.id}`, {
                                headers: { 'Authorization': `Bearer ${token}` }
                            });
                            // Nếu server không còn tồn tại (null hoặc 404), đẩy người dùng ra FriendList
                            if (!checkServer.data) {
                                setSelectedServer(null);
                            }
                        } catch (e) {
                            // Nếu lỗi 404 (Server đã bị xóa), đẩy ra màn hình bạn bè
                            setSelectedServer(null);
                        }
                    }
                }
            };

            fetchServers();
            return () => { };
        }, [selectedServer]) // Thêm selectedServer vào dependency để kiểm tra
    );
    // 1. Khởi tạo
    useEffect(() => {
        const init = async () => {
            try {
                // const token = await AsyncStorage.getItem('userToken');
                const userId = await AsyncStorage.getItem('userId');
                const username = await AsyncStorage.getItem('username');
                const avatarUrl = await AsyncStorage.getItem('avatarUrl');
                if (userId) {

                    setCurrentUser({ id: userId, username, avatarUrl });
                    connectStatusSocket(userId);
                    fetchInitialVoiceStatus();
                }
            } catch (e) {
                console.error("Lỗi khởi tạo:", e);
            } finally {
                setIsLoading(false);
            }
        };
        init();
        const subscription = AppState.addEventListener('change', nextAppState => {
            if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
                refreshStatus('ONLINE');
            } else if (appState.current === 'active' && nextAppState.match(/inactive|background/)) {
                refreshStatus('OFFLINE');
            }
            appState.current = nextAppState;
        });

        return () => {
            refreshStatus('OFFLINE');
            if (stompClient.current) stompClient.current.disconnect();
            subscription.remove();
        };

    }, []);
    useEffect(() => {
        if (route.params?.openCreateServer) {
            setCreateServerVisible(true);
            navigation.setParams({ openCreateServer: null });
        }
    }, [route.params?.openCreateServer]);
    useEffect(() => {
        if (selectedServer) {
            console.log("🔍 [DEBUG] Current User ID:", currentUser?.id);
            console.log("🔍 [DEBUG] Server Owner Info:", selectedServer.owner);
        }
    }, [selectedServer]);
    // Hàm phụ cập nhật nhanh status
    const refreshStatus = async (status) => {
        const userId = await AsyncStorage.getItem('userId');
        if (userId) {
            UserService.updateStatus(userId, status);
        }
    };
    // const connectStatusSocket = () => {
    //     const socket = new SockJS(SOCKET_URL);
    //     stompClient.current = Stomp.over(socket);
    //     stompClient.current.debug = null;

    //     stompClient.current.connect({}, () => {
    //         // Lắng nghe topic chung về trạng thái
    //         stompClient.current.subscribe('/topic/status', (msg) => {
    //             const updatedUser = JSON.parse(msg.body);
    //             console.log(`User ${updatedUser.username} is now ${updatedUser.status}`);
    //         });
    //     });
    // };
    const connectStatusSocket = (userId) => { // 👈 Thêm tham số userId
        const socket = new SockJS(SOCKET_URL);
        const client = Stomp.over(socket); // Tạo biến tạm
        stompClient.current = client;
        stompClient.current.debug = null;

        stompClient.current.connect({}, () => {
            global.stompClient = client;
            // 1. Đăng ký lắng nghe TRƯỚC
            stompClient.current.subscribe('/topic/status', (msg) => {
                const updatedUser = JSON.parse(msg.body);
                console.log(`User ${updatedUser.username} is now ${updatedUser.status}`);

                // (Tùy chọn) Cập nhật lại list bạn bè nếu cần
                // loadServers(...) hoặc kích hoạt event nào đó
            });
            stompClient.current.subscribe('/topic/server.voice.status', (msg) => {
                const data = JSON.parse(msg.body);
                setVoiceStatus(prev => ({
                    ...prev,
                    [data.channelId]: data.members // Cập nhật danh sách người dùng cho channelId tương ứng
                }));
            });
            // 2. Sau khi đã lắng nghe thành công, mới gọi API báo "Tôi đã ONLINE"
            if (userId) {
                console.log("Socket connected! Sending ONLINE status...");
                UserService.updateStatus(userId, 'ONLINE');
            }

        }, (e) => console.error("Socket error:", e));
    };
    const handleGetInviteLink = async () => {
        if (!selectedServer) return;

        // 1. Gọi API
        const link = await UserService.getInviteLink(selectedServer.id);

        if (link) {
            // 2. Lưu link (Modal Link Mời sẽ tự động hiện vì visible={inviteLink !== null})
            setInviteLink(link);

            // ❌ XÓA DÒNG NÀY ĐI (Dòng này gây lỗi mở nhầm Modal Mời Bạn Bè)
            // setInviteModalVisible(true); 
        } else {
            Alert.alert("Lỗi", "Không thể tạo hoặc lấy link mời.");
        }
    };

    const loadServers = async (userId, token) => {
        try {
            const res = await axios.get(`${API_URL}/servers/my/${userId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (res.data && Array.isArray(res.data)) {
                setServers(res.data);
            } else {
                setServers([]);
            }
        } catch (e) {
            console.error("Lỗi load server:", e);
            setServers([]);
        }
    };

    const handleSelectServer = async (server) => {
        setSelectedServer(server);
        loadChannels(server.id);
    };

    const loadChannels = async (serverId) => {
        try {
            const token = await AsyncStorage.getItem('userToken');
            const res = await axios.get(`${BASE_URL}/channels/server/${serverId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            setChannels(res.data);
        } catch (e) { console.error("Lỗi load kênh:", e); }
    };

    // --- LOGIC TẠO SERVER ---
    const openCreateServerModal = () => {
        setNewServerName('');
        setNewServerIcon(null);
        setCreateServerVisible(true);
    };

    const navigateToAddServerOptions = () => {
        navigation.navigate('AddServerOptions', {
            // ❌ XÓA DÒNG NÀY: openCreateServerModal: openCreateServerModal,
            userId: currentUser?.id
        });
    };

    const pickServerIcon = async () => {
        console.log("👉 [DEBUG] 1. Người dùng đã bấm nút chọn ảnh Server");

        try {
            // Bước 1: Xin quyền truy cập (Quan trọng)
            console.log("👉 [DEBUG] 2. Đang xin quyền truy cập thư viện...");
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            console.log("👉 [DEBUG] 3. Trạng thái quyền:", status);

            if (status !== 'granted') {
                alert('Bạn cần cấp quyền truy cập ảnh để tải icon!');
                console.log("❌ [DEBUG] Quyền bị từ chối");
                return;
            }

            // Bước 2: Mở thư viện ảnh
            console.log("👉 [DEBUG] 4. Đang mở thư viện ảnh...");

            // Lưu ý: Dùng chuỗi 'Images' để tránh lỗi phiên bản
            let result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: 'Images',
                allowsEditing: true,
                aspect: [1, 1],
                quality: 0.5,
            });

            console.log("👉 [DEBUG] 5. Kết quả chọn ảnh:", result.canceled ? "Đã hủy" : "Đã chọn");

            if (!result.canceled) {
                console.log("👉 [DEBUG] 6. URI ảnh:", result.assets[0].uri);

                setIsUploadingServerIcon(true); // Bật loading

                // Bước 3: Upload lên Server Java
                const serverPath = await UserService.uploadImage(result.assets[0].uri);
                console.log("👉 [DEBUG] 7. Đường dẫn từ Server trả về:", serverPath);

                setIsUploadingServerIcon(false); // Tắt loading

                if (serverPath) {
                    setNewServerIcon(serverPath);
                    console.log("✅ [DEBUG] Đã set icon thành công");
                } else {
                    Alert.alert("Lỗi", "Upload thất bại (Server trả về null)");
                }
            } else {
                console.log("⚠️ [DEBUG] Người dùng đã bấm Hủy chọn ảnh");
                setIsUploadingServerIcon(false); // Quan trọng: Tắt loading nếu hủy
            }

        } catch (error) {
            console.error("❌ [DEBUG] Lỗi nghiêm trọng (Crash):", error);
            Alert.alert("Lỗi ứng dụng", error.message);
            setIsUploadingServerIcon(false);
        }
    };

    const submitCreateServer = async () => {
        if (!newServerName.trim()) return Alert.alert("Lỗi", "Nhập tên Server!");

        const result = await UserService.createServer(currentUser.id, newServerName, newServerIcon);

        if (result) {
            setCreateServerVisible(false);
            const token = await AsyncStorage.getItem('userToken');
            loadServers(currentUser.id, token);
            Alert.alert("Thành công", `Đã tạo ${newServerName}`);
        } else {
            Alert.alert("Lỗi", "Không thể tạo Server");
        }
    };

    // --- LOGIC ĐỔI AVATAR USER ---
    const handleChangeUserAvatar = async () => {
        console.log("👉 [USER AVATAR] Bắt đầu đổi Avatar...");

        try {
            // 1. Xin quyền truy cập ảnh
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert("Lỗi", "Cần cấp quyền truy cập ảnh để đổi Avatar!");
                return;
            }

            // 2. Mở thư viện chọn ảnh
            let result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: 'Images', // Sử dụng chuỗi string để an toàn
                allowsEditing: true,  // Cho phép cắt ảnh
                aspect: [1, 1],       // Tỉ lệ vuông (cho avatar đẹp)
                quality: 0.7,         // Nén nhẹ cho upload nhanh
            });

            if (result.canceled) {
                console.log("👉 [USER AVATAR] Đã hủy chọn.");
                return;
            }

            // 3. Bắt đầu Upload
            console.log("👉 [USER AVATAR] Đang upload:", result.assets[0].uri);
            setIsUploadingUserAvatar(true); // Bật loading spinner ở footer

            // Upload file lên server Java -> Nhận về đường dẫn (ví dụ: /uploads/abc.jpg)
            const serverPath = await UserService.uploadImage(result.assets[0].uri);

            if (serverPath) {
                console.log("✅ [USER AVATAR] Upload thành công:", serverPath);

                // 4. Cập nhật thông tin User trong Database
                // Hàm này đã có sẵn trong UserService.js bạn tạo trước đó
                await UserService.updateUserAvatar(currentUser.id, serverPath);

                // 5. Cập nhật State để giao diện đổi ảnh ngay lập tức
                // MẸO QUAN TRỌNG: Thêm timestamp (?t=...) để ép React Native không dùng ảnh cache cũ
                const newAvatarUrlWithCacheBust = `${serverPath}?t=${new Date().getTime()}`;

                setCurrentUser(prevUser => ({
                    ...prevUser,
                    avatarUrl: newAvatarUrlWithCacheBust
                }));

                Alert.alert("Thành công", "Đã cập nhật Avatar mới!");
            } else {
                Alert.alert("Lỗi", "Upload ảnh thất bại (Server trả về null)");
            }

        } catch (error) {
            console.error("❌ [USER AVATAR] Lỗi:", error);
            Alert.alert("Lỗi", "Có lỗi xảy ra khi đổi Avatar.");
        } finally {
            // 6. Tắt loading dù thành công hay thất bại
            setIsUploadingUserAvatar(false);
        }
    };

    // --- LOGIC KÊNH ---
    const openCreateChannel = (type) => {
        setNewChannelType(type);
        setCreateChannelVisible(true);
    };

    const submitCreateChannel = async () => {
        if (!newChannelName.trim()) return alert("Nhập tên kênh!");
        const result = await UserService.createChannel(selectedServer.id, newChannelName, newChannelType);
        if (result) {
            setCreateChannelVisible(false);
            setNewChannelName('');
            loadChannels(selectedServer.id);
        } else {
            alert("Lỗi tạo kênh");
        }
    };

    // --- LOGIC MỜI BẠN ---
    // const openInviteModal = async () => {
    //     if (currentUser && currentUser.id) {
    //         try {
    //             const friends = await UserService.getFriends(parseInt(currentUser.id));
    //             const memberIds = await UserService.getServerMembers(selectedServer.id);
    //             const friendsNotJoined = friends.filter(f => !memberIds.includes(f.id));

    //             setMyFriends(friendsNotJoined);
    //             setInviteModalVisible(true);
    //         } catch (e) { console.error("Lỗi load bạn bè:", e); }
    //     }
    // };

    // const handleInvite = async (friendId) => {
    //     const result = await UserService.inviteMember(selectedServer.id, friendId);
    //     if (Platform.OS === 'web') alert(result); else Alert.alert("Thông báo", result);
    //     setInviteModalVisible(false);
    // };

    // --- VÀO CHAT ---
    const handleJoinChannel = (channel) => {
        if (!currentUser) return;

        if (channel.type === 'VOICE') {
            // 👇 ĐIỀU HƯỚNG SANG MÀN HÌNH VOICE CHANNEL
            navigation.navigate('VoiceChannel', {
                channelId: channel.id,
                channelName: channel.name,
                currentUser: currentUser // Truyền thông tin user để hiện Avatar
            });
        } else {
            // Kênh Text cũ
            navigation.navigate('Chat', {
                channelId: channel.id,
                channelName: channel.name,
                myId: currentUser.id,
                friendUsername: `# ${channel.name}`,
                type: 'CHANNEL'
            });
        }
    };
    const fetchInitialVoiceStatus = async () => {
        try {
            const token = await AsyncStorage.getItem('userToken');
            // Gọi đến đúng đường dẫn đã sửa ở Backend
            const res = await axios.get(`${BASE_URL}/channels/voice/status`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.data) {
                setVoiceStatus(res.data);
            }
        } catch (e) {
            console.error("Lỗi lấy voice status ban đầu:", e);
        }
    };
    const textChannels = channels.filter(c => c.type === 'TEXT');
    const voiceChannels = channels.filter(c => c.type === 'VOICE');

    if (isLoading || !currentUser) {
        return (
            <View style={{ flex: 1, backgroundColor: '#202225', justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#5865F2" />
            </View>
        );
    }

    return (
        <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
            <View style={{ flex: 1, flexDirection: 'row' }}>

                {/* --- SIDEBAR TRÁI --- */}
                <View style={styles.sidebar}>
                    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center' }}>
                        <TouchableOpacity onPress={() => setSelectedServer(null)} style={[styles.serverBtn, selectedServer === null && styles.selectedServerBtn]}>
                            <Avatar name="Direct" size={48} style={{ backgroundColor: '#36393f' }} />
                        </TouchableOpacity>
                        <View style={styles.divider} />

                        {servers.map(sv => (
                            <TouchableOpacity key={sv.id} onPress={() => handleSelectServer(sv)} style={[styles.serverBtn, selectedServer?.id === sv.id && styles.selectedServerBtn]}>
                                <Avatar uri={sv.iconUrl} name={sv.name} size={48} />
                            </TouchableOpacity>
                        ))}

                        <TouchableOpacity
                            style={styles.addServerBtn}
                            onPress={navigateToAddServerOptions}
                        >
                            <Ionicons name="add" size={30} color="#23a559" />
                        </TouchableOpacity>
                    </ScrollView>

                    {/* 👇 USER FOOTER (AVATAR CỦA BẠN NẰM Ở ĐÂY) */}
                    <View style={styles.userSidebarFooter}>
                        <TouchableOpacity
                            onPress={() => navigation.navigate('Profile')}
                        >
                            {/* Dùng logic ternary operator để chỉ hiện 1 trong 2 */}
                            {isUploadingUserAvatar ? (
                                <ActivityIndicator size="small" color="white" />
                            ) : (
                                <Avatar uri={currentUser?.avatarUrl} name={currentUser?.username} size={40} />
                            )}
                        </TouchableOpacity>
                    </View>
                </View>

                {/* --- CONTENT PHẢI --- */}
                <View style={styles.contentArea}>
                    {selectedServer ? (
                        <View style={{ flex: 1 }}>
                            <View style={styles.serverHeader}>
                                <Text style={styles.serverTitle}>{selectedServer.name}</Text>

                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <TouchableOpacity
                                        onPress={() => navigation.navigate('ServerProfile', {
                                            server: selectedServer,
                                            currentUser: currentUser
                                        })}
                                        style={{ marginRight: 15 }}
                                    >
                                        <Ionicons name="information-circle-outline" size={24} color="white" />
                                    </TouchableOpacity>
                                    {/* Nút Lấy Link (Chủ nhóm) */}
                                    {((selectedServer.owner && String(selectedServer.owner.id) === String(currentUser.id)) ||
                                        (selectedServer.ownerId === currentUser.id)) && (

                                            <TouchableOpacity onPress={handleGetInviteLink} style={{ marginRight: 15 }}>
                                                <Ionicons name="link" size={20} color="white" />
                                            </TouchableOpacity>

                                        )}

                                    {/* Nút Mời bạn bè */}
                                    {/* <TouchableOpacity onPress={openInviteModal}>
                                        <Ionicons name="person-add" size={20} color="white" />
                                    </TouchableOpacity> */}
                                    {/* 👇 LOGIC MỚI: Chỉ hiện nút Link nếu là Chủ Nhóm */}
                                    {/* Kiểm tra cả 2 trường hợp: owner là object hoặc ownerId là số (tùy backend trả về) */}
                                    {/* {((selectedServer.owner && String(selectedServer.owner.id) === String(currentUser.id)) ||
                                        (selectedServer.ownerId === currentUser.id)) && (

                                            <TouchableOpacity onPress={handleGetInviteLink} style={{ marginRight: 15 }}>
                                                <Ionicons name="link" size={20} color="white" />
                                            </TouchableOpacity>

                                        )}
                                    {/* 👆 KẾT THÚC LOGIC ẨN/HIỆN */}

                                    {/* <TouchableOpacity onPress={openInviteModal}>
                                        <Ionicons name="person-add" size={20} color="white" />
                                    </TouchableOpacity> */}
                                </View>
                            </View>

                            <ScrollView style={{ padding: 10 }}>
                                <View style={styles.categoryHeader}>
                                    <Text style={styles.catText}>KÊNH CHAT</Text>
                                    <TouchableOpacity onPress={() => openCreateChannel('TEXT')}>
                                        <Ionicons name="add" size={18} color="#b9bbbe" />
                                    </TouchableOpacity>
                                </View>
                                {textChannels.map(c => (
                                    <TouchableOpacity key={c.id} style={styles.channelItem} onPress={() => handleJoinChannel(c)}>
                                        <Text style={styles.hash}>#</Text>
                                        <Text style={styles.channelName}>{c.name}</Text>
                                    </TouchableOpacity>
                                ))}

                                <View style={[styles.categoryHeader, { marginTop: 20 }]}>
                                    <Text style={styles.catText}>KÊNH NHẠC</Text>
                                    <TouchableOpacity onPress={() => openCreateChannel('VOICE')}>
                                        <Ionicons name="add" size={18} color="#b9bbbe" />
                                    </TouchableOpacity>
                                </View>
                                {voiceChannels.map(channel => (
                                    <View key={channel.id}>
                                        <TouchableOpacity style={styles.channelItem} onPress={() => handleJoinChannel(channel)}>
                                            <Ionicons name="volume-medium" size={20} color="#8e9297" />
                                            <Text style={styles.channelName}>{channel.name}</Text>
                                        </TouchableOpacity>

                                        {/* 👇 HIỂN THỊ THÀNH VIÊN ĐANG Ở TRONG KÊNH */}
                                        {voiceStatus[channel.id] && voiceStatus[channel.id].map(user => (
                                            <View key={user.id} style={styles.userInChannelRow}>
                                                <Image
                                                    source={{ uri: user.avatarUrl ? (BASE_URL_IMG + user.avatarUrl) : 'https://via.placeholder.com/100' }}
                                                    style={styles.smallAvatar}
                                                />
                                                <Text style={styles.userInChannelName}>{user.username}</Text>
                                            </View>
                                        ))}
                                    </View>
                                ))}
                            </ScrollView>
                        </View>
                    ) : (
                        <FriendList navigation={navigation} />
                    )}
                </View>
            </View>

            {/* MODAL TẠO SERVER */}
            <Modal transparent={true} visible={createServerVisible} animationType="fade" onRequestClose={() => setCreateServerVisible(false)}>
                <View style={styles.modalOverlay}>
                    <View style={styles.modalView}>
                        <Text style={[styles.modalTitle, { marginBottom: 10 }]}>Tạo Máy Chủ</Text>

                        <TouchableOpacity style={styles.uploadServerIconBtn} onPress={pickServerIcon} disabled={isUploadingServerIcon}>
                            {isUploadingServerIcon ? <ActivityIndicator size="large" color="#5865F2" /> : newServerIcon ? <Avatar uri={newServerIcon} size={80} /> : (
                                <><Ionicons name="camera" size={30} color="#dcddde" /><Text style={{ color: '#dcddde', fontSize: 10, marginTop: 5 }}>UPLOAD ICON</Text></>
                            )}
                        </TouchableOpacity>

                        <Text style={styles.label}>TÊN MÁY CHỦ</Text>
                        <TextInput style={styles.input} placeholder={`${currentUser?.username}'s server`} placeholderTextColor="#72767d" value={newServerName} onChangeText={setNewServerName} />

                        <View style={styles.modalButtons}>
                            <TouchableOpacity onPress={() => setCreateServerVisible(false)} style={styles.btnCancel}><Text style={styles.btnText}>Hủy</Text></TouchableOpacity>
                            <TouchableOpacity onPress={submitCreateServer} style={styles.btnAdd}><Text style={styles.btnText}>Tạo</Text></TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* MODAL TẠO KÊNH */}
            <Modal transparent={true} visible={createChannelVisible} animationType="fade" onRequestClose={() => setCreateChannelVisible(false)}>
                <View style={styles.modalOverlay}>
                    <View style={styles.modalView}>
                        <Text style={styles.modalTitle}>Tạo Kênh {newChannelType === 'TEXT' ? 'Chat' : 'Thoại'}</Text>
                        <Text style={styles.label}>TÊN KÊNH</Text>
                        <TextInput style={styles.input} placeholder={newChannelType === 'TEXT' ? "kênh-mới" : "Kênh Thoại Mới"} placeholderTextColor="#72767d" value={newChannelName} onChangeText={setNewChannelName} />
                        <View style={styles.modalButtons}>
                            <TouchableOpacity onPress={() => setCreateChannelVisible(false)} style={styles.btnCancel}><Text style={styles.btnText}>Hủy</Text></TouchableOpacity>
                            <TouchableOpacity onPress={submitCreateChannel} style={styles.btnAdd}><Text style={styles.btnText}>Tạo</Text></TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* MODAL MỜI BẠN */}
            {/* <Modal transparent={true} visible={inviteModalVisible} animationType="slide" onRequestClose={() => setInviteModalVisible(false)}>
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalView, { height: '70%' }]}>
                        <Text style={styles.modalTitle}>Mời bạn bè</Text>
                        <FlatList
                            data={myFriends}
                            keyExtractor={item => item.id.toString()}
                            renderItem={({ item }) => (
                                <View style={styles.inviteRow}>
                                    <View style={styles.inviteAvatar}><Text style={styles.inviteAvatarText}>{item.username?.charAt(0).toUpperCase()}</Text></View>
                                    <View style={styles.inviteInfo}><Text style={styles.inviteName}>{item.username}</Text><Text style={styles.inviteTag}>#{item.id}</Text></View>
                                    <TouchableOpacity style={styles.inviteBtnDiscord} onPress={() => handleInvite(item.id)}><Text style={styles.inviteBtnText}>Mời</Text></TouchableOpacity>
                                </View>
                            )}
                            ListEmptyComponent={<View style={{ alignItems: 'center', marginTop: 20 }}><Text style={{ color: '#72767d' }}>Không tìm thấy ai để mời.</Text></View>}
                        />
                        <TouchableOpacity onPress={() => setInviteModalVisible(false)} style={styles.modalCloseBtnDiscord}><Text style={{ color: 'white', fontWeight: 'bold' }}>Đóng</Text></TouchableOpacity>
                    </View>
                </View>
            </Modal> */}

            {/* MODAL HIỂN THỊ LINK MỜI */}
            <Modal transparent={true} visible={inviteLink !== null} animationType="fade" onRequestClose={() => setInviteLink(null)}>
                <View style={styles.modalOverlay}>
                    <View style={styles.modalView}>
                        <Text style={styles.modalTitle}>Link Mời Tham Gia {selectedServer?.name}</Text>

                        <Text style={styles.label}>LINK MỜI (Tự động hết hạn)</Text>
                        <View style={styles.inviteLinkContainer}>
                            <Text style={styles.inviteLinkText} numberOfLines={1}>
                                {inviteLink}
                            </Text>
                        </View>

                        <TouchableOpacity
                            style={styles.copyButton}
                            onPress={async () => {
                                // 👇 THAY THẾ LOGIC CŨ BẰNG HÀM SAO CHÉP THỰC TẾ
                                await Clipboard.setStringAsync(inviteLink);

                                Alert.alert("Thành công", `Đã sao chép link: ${inviteLink}`);

                                // Tùy chọn: Đóng modal sau khi sao chép
                                setInviteLink(null);
                            }}
                        >
                            <Ionicons name="copy" size={20} color="white" style={{ marginRight: 10 }} />
                            <Text style={styles.btnText}>SAO CHÉP LINK</Text>
                        </TouchableOpacity>

                        <TouchableOpacity onPress={() => setInviteLink(null)} style={[styles.btnCancel, { marginTop: 15 }]}>
                            <Text style={styles.btnText}>Đóng</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#202225' },

    // Sidebar
    sidebar: { width: 72, backgroundColor: '#202225', alignItems: 'center', paddingTop: 10, justifyContent: 'space-between', paddingBottom: 10 },
    divider: { width: 32, height: 2, backgroundColor: '#36393f', marginBottom: 10 },
    serverBtn: { width: 48, height: 48, justifyContent: 'center', alignItems: 'center', marginBottom: 10, borderRadius: 24, overflow: 'hidden' },
    selectedServerBtn: { borderColor: 'white', borderWidth: 2, borderRadius: 16 },
    addServerBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#36393f', justifyContent: 'center', alignItems: 'center', marginBottom: 10 },

    // User Footer
    userSidebarFooter: { marginBottom: 25, position: 'relative' },
    editAvatarIcon: { position: 'absolute', right: -2, bottom: -2, backgroundColor: '#5865F2', borderRadius: 10, width: 16, height: 16, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#202225' },

    // Content
    contentArea: { flex: 1, backgroundColor: '#2f3136', borderTopLeftRadius: 10, overflow: 'hidden' },
    serverHeader: { flexDirection: 'row', justifyContent: 'space-between', padding: 15, borderBottomWidth: 1, borderBottomColor: '#202225', height: 60, alignItems: 'center' },
    serverTitle: { color: 'white', fontWeight: 'bold', fontSize: 16 },

    categoryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5, marginTop: 10, paddingRight: 5 },
    catText: { color: '#8e9297', fontSize: 12, fontWeight: 'bold' },
    channelItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 5, borderRadius: 5, marginBottom: 2 },
    hash: { color: '#72767d', fontSize: 20, marginRight: 5 },
    channelName: { color: '#8e9297', fontSize: 16 },

    // Modals
    modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.8)' },
    modalView: { width: '90%', backgroundColor: '#36393f', borderRadius: 10, padding: 20 },
    modalTitle: { fontSize: 20, fontWeight: 'bold', color: 'white', marginBottom: 15, textAlign: 'center' },
    label: { color: '#b9bbbe', fontSize: 12, fontWeight: 'bold', marginBottom: 10 },
    input: { backgroundColor: '#202225', color: 'white', padding: 10, borderRadius: 5, marginBottom: 20 },
    modalButtons: { flexDirection: 'row', justifyContent: 'space-between' },
    btnCancel: {
        backgroundColor: '#ed4245',
        padding: 12,
        borderRadius: 5,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
    },
    btnAdd: { backgroundColor: '#5865F2', padding: 10, borderRadius: 5, flex: 1, marginLeft: 5, alignItems: 'center' },
    btnText: { color: 'white', fontWeight: 'bold' },

    uploadServerIconBtn: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#4f545c', justifyContent: 'center', alignItems: 'center', alignSelf: 'center', marginBottom: 20, borderStyle: 'dashed', borderWidth: 2, borderColor: '#72767d' },

    inviteRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#2f3136' },
    inviteAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#5865F2', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
    inviteAvatarText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
    inviteInfo: { flex: 1 },
    inviteName: { color: 'white', fontWeight: 'bold', fontSize: 16 },
    inviteTag: { color: '#b9bbbe', fontSize: 12 },
    inviteBtnDiscord: { borderWidth: 1, borderColor: '#3ba55d', paddingHorizontal: 16, paddingVertical: 6, borderRadius: 3, backgroundColor: 'transparent' },
    inviteBtnText: { color: '#3ba55d', fontWeight: 'bold', fontSize: 12 },
    modalCloseBtnDiscord: { marginTop: 15, width: '100%', paddingVertical: 12, backgroundColor: '#4f545c', borderRadius: 3, alignItems: 'center' },
    inviteLinkContainer: {
        backgroundColor: '#202225',
        padding: 12,
        borderRadius: 5,
        marginBottom: 15
    },
    inviteLinkText: {
        color: '#b9bbbe',
        fontSize: 14
    },
    copyButton: {
        backgroundColor: '#5865F2',
        padding: 12,
        borderRadius: 5,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
    },
    userInChannelRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 35, // Đẩy vào trong so với tên kênh
        marginVertical: 2,
    },
    smallAvatar: {
        width: 18,
        height: 18,
        borderRadius: 9,
        marginRight: 8,
    },
    userInChannelName: {
        color: '#b9bbbe', // Màu xám nhạt đặc trưng của Discord
        fontSize: 13,
    },
});
