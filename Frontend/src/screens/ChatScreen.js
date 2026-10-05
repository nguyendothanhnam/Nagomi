import { Audio } from 'expo-av';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { useEffect, useRef, useState } from 'react';
import {
    Alert,
    Dimensions,
    FlatList,
    Image,
    KeyboardAvoidingView,
    LayoutAnimation,
    Modal,
    Platform, StyleSheet, Text,
    TextInput, TouchableOpacity,
    UIManager,
    View
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import SockJS from 'sockjs-client';
import Stomp from 'stompjs';
import UserService from '../services/UserService';
import { BASE_URL_IMG, SOCKET_URL } from '../utils/constants';
// Kích hoạt LayoutAnimation cho Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}
// Fix lỗi thiếu height
const { width, height } = Dimensions.get('window');

const formatDuration = (seconds) => {
    if (!seconds) return "00:00";
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min < 10 ? '0' + min : min}:${sec < 10 ? '0' + sec : sec}`;
};
const formatMessageDate = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (diffDays < 1 && now.getDate() === date.getDate()) {
        return timeStr; // Hôm nay: "10:30"
    } else if (diffDays < 7) {
        // Trong tuần: "Th 2 10:30"
        const days = ['CN', 'Th 2', 'Th 3', 'Th 4', 'Th 5', 'Th 6', 'Th 7'];
        return `${days[date.getDay()]} ${timeStr}`;
    } else {
        // Lâu hơn: "01/12 10:30"
        return `${date.getDate()}/${date.getMonth() + 1} ${timeStr}`;
    }
};
const shouldShowTimestamp = (currentMsg, prevMsg) => {
    if (!prevMsg) return false;
    const currentDate = new Date(currentMsg.timestamp || 0);
    const prevDate = new Date(prevMsg.timestamp || 0);
    const isDifferentDay = currentDate.toDateString() !== prevDate.toDateString();
    if (isDifferentDay) return true;
    const diffMinutes = (currentDate - prevDate) / (1000 * 60);
    return diffMinutes > 10;
};
export default function ChatScreen({ route, navigation }) {
    const { myId, friendId, friendUsername, type, channelId } = route.params;
    const isChannelMode = type === 'CHANNEL';

    const [recording, setRecording] = useState(null);
    const [isRecording, setIsRecording] = useState(false);
    const [recordingDuration, setRecordingDuration] = useState(0);
    const timerRef = useRef(null); // Để lưu interval đếm giờ


    const [sound, setSound] = useState(null);
    const [currentPlayingId, setCurrentPlayingId] = useState(null);
    const [isPlaying, setIsPlaying] = useState(false);

    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isUploading, setIsUploading] = useState(false);

    const [modalVisible, setModalVisible] = useState(false);
    const [selectedImage, setSelectedImage] = useState(null);

    const [selectedMessageId, setSelectedMessageId] = useState(null);

    const stompClient = useRef(null);
    const flatListRef = useRef(null);

    const [menuOpen, setMenuOpen] = useState(false);

    useEffect(() => {
        navigation.setOptions({
            title: friendUsername || (isChannelMode ? "Kênh Chat" : `Chat`),
            headerStyle: { backgroundColor: '#2f3136' },
            headerTintColor: '#dcddde'
        });
        loadHistory();
        connectToWebSocket();

        // Cleanup khi thoát màn hình
        return () => {
            if (stompClient.current) stompClient.current.disconnect();
            stopTimer();
            // Dọn dẹp sound an toàn
            if (sound) {
                sound.unloadAsync().catch(err => console.log("Unload error on unmount:", err));
            }
        };
    }, []);
    // useEffect(() => {
    //     if (messages.length > 0) {
    //         setTimeout(() => {
    //             flatListRef.current?.scrollToEnd({ animated: true });
    //         }, 100);
    //     }
    // }, [messages]);
    const appendMessage = (newMsg) => setMessages((prev) => {
        const list = [...prev, newMsg];
        // Sắp xếp theo ID để đảm bảo thứ tự đúng
        return list.sort((a, b) => (b.id || 0) - (a.id || 0));
    });

    const startTimer = () => {
        setRecordingDuration(0);
        timerRef.current = setInterval(() => {
            setRecordingDuration(prev => prev + 1);
        }, 1000);
    };
    const stopTimer = () => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
    };
    const loadHistory = async () => {
        let history = [];
        try {
            if (isChannelMode) {
                history = await UserService.getChannelHistory(channelId);
            } else if (friendId) {
                history = await UserService.getChatHistory(Number(myId), Number(friendId));
            }
            if (history && Array.isArray(history)) {
                const finalHistory = history.sort((a, b) => (b.id || 0) - (a.id || 0));

                setMessages(finalHistory);
                // setMessages(history.sort((a, b) => (a.id || Infinity) - (b.id || Infinity)));
            }
        } catch (err) { console.error(err); }
    };

    const connectToWebSocket = () => {
        const socket = new SockJS(SOCKET_URL);
        stompClient.current = Stomp.over(socket);
        stompClient.current.debug = null;
        stompClient.current.connect({}, () => {
            const topic = isChannelMode ? `/topic/channel/${channelId}` : `/topic/private/${myId}`;
            stompClient.current.subscribe(topic, (msg) => {
                const newMessage = JSON.parse(msg.body);
                // Logic lọc tin nhắn để tránh hiện tin của người khác
                if (isChannelMode) {
                    appendMessage(newMessage);
                } else {
                    if (Number(newMessage.senderId) === Number(friendId) || Number(newMessage.senderId) === Number(myId)) {
                        appendMessage(newMessage);
                    }
                }
            });
        }, (e) => console.error(e));
    };
    const sendMessage = (content, msgType = 'TEXT', duration = 0) => {
        if (!content || !stompClient.current) return;

        let payload = { content, type: msgType, duration: duration }; // Thêm duration vào payload

        if (isChannelMode) {
            payload = { ...payload, sender: { id: myId }, channel: { id: channelId } };
            stompClient.current.send("/app/channel-message", {}, JSON.stringify(payload));
        } else {
            payload = { ...payload, senderId: myId, receiverId: friendId };
            stompClient.current.send("/app/private-message", {}, JSON.stringify(payload));
        }
        if (msgType === 'TEXT') setInput('');
    };
    const handleCopyMessage = async (content) => {
        // Chỉ copy nội dung là TEXT để tránh lỗi
        if (content) {
            await Clipboard.setStringAsync(content);
            setSelectedMessageId(null);
        }
    };
    const handleLongPress = (item) => {
        // Chỉ cho phép Copy tin nhắn dạng TEXT
        if (item.type !== 'TEXT') return;

        // Tắt chế độ chi tiết nếu đang mở
        setSelectedMessageId(null);

        Alert.alert(
            "Tùy chọn tin nhắn",
            `Bạn có muốn sao chép tin nhắn này?`,
            [
                { text: "Hủy bỏ", style: "cancel" },
                {
                    text: "SAO CHÉP",
                    onPress: () => handleCopyMessage(item.content), // Gọi hàm copy đã có
                    style: 'default'
                },
                // Có thể thêm tùy chọn khác:
                // { text: "Phản hồi", onPress: () => handleReply(item.id) },
            ]
        );
    };
    // 1. CHỌN ẢNH TỪ THƯ VIỆN
    const pickImage = async () => {
        try {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== 'granted') return alert('Cần quyền truy cập ảnh!');

            let result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: 'Images',
                quality: 0.7,
                allowsMultipleSelection: true,
                selectionLimit: 10,
            });

            if (!result.canceled) {
                const assets = result.assets;
                setIsUploading(true);
                setMenuOpen(false);

                for (let i = 0; i < assets.length; i++) {
                    await handleUpload(assets[i].uri, 'IMAGE');
                }

                setIsUploading(false);
            }
        } catch (error) {
            console.error(error);
            setIsUploading(false);
        }
    };
    // 2. CHỤP ẢNH TỪ CAMERA (MỚI THÊM)
    const takePhoto = async () => {
        try {
            const { status } = await ImagePicker.requestCameraPermissionsAsync();
            if (status !== 'granted') return alert('Cần quyền Camera!');

            let result = await ImagePicker.launchCameraAsync({
                mediaTypes: 'Images',
                quality: 0.5,
            });

            if (!result.canceled) {
                handleUpload(result.assets[0].uri, 'IMAGE');
            }
        } catch (error) { console.error(error); }
    };
    // 3. CHỌN FILE
    const pickDocument = async () => {
        try {
            const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
            if (result.assets && result.assets.length > 0) {
                const file = result.assets[0];
                handleUpload(file.uri, 'FILE', file.mimeType, file.name);
            }
        } catch (err) { console.error(err); }
    };
    const startRecording = async () => {
        try {
            // Dừng nhạc nếu đang phát trước khi ghi âm
            if (sound) {
                await sound.stopAsync();
                await sound.unloadAsync();
                setSound(null);
                setCurrentPlayingId(null);
                setIsPlaying(false);
            }

            const permission = await Audio.requestPermissionsAsync();
            if (permission.status === 'granted') {
                await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
                const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
                setRecording(recording); setIsRecording(true); startTimer();
            } else alert('Cần quyền Micro');
        } catch (err) { console.error(err); }
    };

    const stopRecording = async () => {
        stopTimer(); setIsRecording(false); setRecording(undefined);
        await recording.stopAndUnloadAsync();
        handleUpload(recording.getURI(), 'VOICE', 'audio/m4a', `voice_${new Date().getTime()}.m4a`, recordingDuration);
        setRecordingDuration(0);
    };
    const cancelRecording = async () => {
        stopTimer(); setIsRecording(false); setRecordingDuration(0);
        if (recording) { await recording.stopAndUnloadAsync(); setRecording(null); }
    };
    const playSound = async (uri, messageId) => {
        try {
            // 1. Nếu bấm vào chính tin nhắn đang phát -> Toggle Pause/Resume
            if (currentPlayingId === messageId) {
                if (isPlaying) {
                    await sound.pauseAsync();
                    setIsPlaying(false);
                } else {
                    await sound.playAsync();
                    setIsPlaying(true);
                }
                return;
            }

            // 2. Nếu bấm vào tin nhắn KHÁC -> Dừng tin cũ trước
            if (sound) {
                // Dừng và Gỡ bỏ an toàn
                try {
                    await sound.stopAsync();
                    await sound.unloadAsync();
                } catch (e) { console.log("Lỗi unload sound cũ (không sao):", e); }

                setSound(null);
                setCurrentPlayingId(null);
                setIsPlaying(false);
            }

            // 3. Thiết lập chế độ âm thanh (Quan trọng cho iOS)
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: false,
                playsInSilentModeIOS: true, // Để nghe được kể cả khi để chế độ im lặng
            });

            // 4. Tạo và phát âm thanh mới
            const { sound: newSound } = await Audio.Sound.createAsync(
                { uri: BASE_URL_IMG + uri },
                { shouldPlay: true }
            );

            setSound(newSound);
            setCurrentPlayingId(messageId);
            setIsPlaying(true);

            // 5. Tự động reset khi phát xong
            newSound.setOnPlaybackStatusUpdate(async (status) => {
                if (status.didJustFinish) {
                    setIsPlaying(false);
                    setCurrentPlayingId(null);
                    try {
                        await newSound.unloadAsync();
                    } catch (e) { }
                    setSound(null);
                }
            });

        } catch (error) {
            console.error("Lỗi phát nhạc:", error);
            Alert.alert("Lỗi", "Không thể phát tin nhắn này.");
            // Reset trạng thái nếu lỗi
            setIsPlaying(false);
            setCurrentPlayingId(null);
            setSound(null);
        }
    };
    // Hàm Upload chung
    const handleUpload = async (uri, typeMsg, fileType = null, fileName = null, duration = 0) => {
        setIsUploading(true);
        const serverPath = await UserService.uploadFile(uri, fileType, fileName);
        setIsUploading(false);
        if (serverPath) sendMessage(serverPath, typeMsg, duration);
        else alert("Lỗi upload file");
    };
    const toggleMenu = () => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setMenuOpen(!menuOpen);
    };
    const handleMessagePress = (id) => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setSelectedMessageId(selectedMessageId === id ? null : id); // Toggle
    };
    const renderMessage = ({ item, index }) => {
        const senderId = item.senderId || (item.sender ? item.sender.id : null);
        const senderName = item.sender ? item.sender.username : "";
        const isMyMessage = Number(senderId) === Number(myId);

        const isImage = item.type === 'IMAGE';
        const isFile = item.type === 'FILE';
        const isVoice = item.type === 'VOICE';

        // 👇 THAY ĐỔI QUAN TRỌNG: Lấy tin nhắn CŨ hơn (nằm ở index + 1)
        const olderItem = messages[index + 1];

        // So sánh item (tin mới hơn) với olderItem (tin cũ hơn)
        const showTimestamp = shouldShowTimestamp(item, olderItem);
        const isSelected = selectedMessageId === item.id;
        return (
            <View>
                {showTimestamp && (
                    <View style={styles.timestampContainer}>
                        <Text style={styles.timestampText}>{formatMessageDate(item.timestamp)}</Text>
                    </View>
                )}
                <View style={[styles.msgRow, isMyMessage ? { justifyContent: 'flex-end' } : { justifyContent: 'flex-start' }]}>
                    <View style={{ maxWidth: '80%' }}>
                        {/* Hiện tên người gửi trong nhóm */}
                        {isChannelMode && !isMyMessage && senderName !== "" && (
                            <Text style={{ color: '#b9bbbe', fontSize: 11, marginBottom: 2, marginLeft: 2 }}>
                                {senderName}
                            </Text>
                        )}
                        <TouchableOpacity activeOpacity={0.9} onPress={() => handleMessagePress(item.id)} onLongPress={() => handleLongPress(item)}>
                            <View style={[
                                styles.bubble,
                                isMyMessage ? styles.myBubble : styles.friendBubble,
                                isImage && { padding: 0, backgroundColor: 'transparent' }
                            ]}>
                                {isImage ? (
                                    <TouchableOpacity onPress={() => { setSelectedImage(BASE_URL_IMG + item.content); setModalVisible(true); }}>
                                        <Image
                                            source={{ uri: BASE_URL_IMG + item.content }}
                                            style={{ width: 200, height: 200, borderRadius: 10 }}
                                            resizeMode="cover"
                                        />
                                    </TouchableOpacity>
                                ) : isFile ? (
                                    // 👇 TRƯỜNG HỢP FILE (Mới thêm vào đây)
                                    <TouchableOpacity
                                        style={{ flexDirection: 'row', alignItems: 'center', padding: 5 }}
                                        onPress={() => Linking.openURL(BASE_URL_IMG + item.content)}
                                    >
                                        <Ionicons name="document-text" size={30} color={isMyMessage ? "white" : "#5865F2"} />
                                        <View style={{ marginLeft: 10 }}>
                                            <Text style={{ color: isMyMessage ? 'white' : 'white', fontWeight: 'bold', maxWidth: 150 }} numberOfLines={1}>
                                                {/* Cắt tên file cho gọn */}
                                                {item.content.split('/').pop().split('_').slice(1).join('_') || "Tài liệu"}
                                            </Text>
                                            <Text style={{ color: isMyMessage ? '#ddd' : 'gray', fontSize: 10 }}>Bấm để tải</Text>
                                        </View>
                                    </TouchableOpacity>
                                ) : isVoice ? (
                                    // 👇 GIAO DIỆN TIN NHẮN THOẠI
                                    <TouchableOpacity
                                        style={{ flexDirection: 'row', alignItems: 'center', padding: 5 }}
                                        onPress={() => playSound(item.content, item.id)} // Truyền thêm item.id
                                    >
                                        {/* 👇 ĐỔI ICON DỰA TRÊN TRẠNG THÁI */}
                                        <Ionicons
                                            name={(currentPlayingId === item.id && isPlaying) ? "pause-circle" : "play-circle"}
                                            size={32}
                                            color={isMyMessage ? "white" : "#5865F2"}
                                        />

                                        <View style={{ marginLeft: 10 }}>
                                            <Text style={{ color: isMyMessage ? 'white' : 'white', fontWeight: 'bold' }}>
                                                {(currentPlayingId === item.id && isPlaying) ? "Đang phát..." : "Tin nhắn thoại"}
                                            </Text>
                                            <Text style={{ color: isMyMessage ? '#ddd' : 'gray', fontSize: 10 }}>
                                                {formatDuration(item.duration)}
                                            </Text>
                                        </View>
                                    </TouchableOpacity>
                                ) : (
                                    <Text style={{ color: isMyMessage ? 'white' : '#dcddde', fontSize: 16 }}>{item.content}</Text>
                                )}
                            </View>
                        </TouchableOpacity>
                        {isSelected && (
                            <Text style={[styles.detailTime, isMyMessage ? { textAlign: 'right' } : { textAlign: 'left' }]}>
                                {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </Text>
                        )}
                    </View>
                </View>
            </View>
        );
    };

    return (
        <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
            <FlatList
                ref={flatListRef} inverted={true} data={messages} keyExtractor={(item, index) => index.toString()}
                renderItem={renderMessage}
            // onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })} // Cuộn xuống khi mới vào
            />

            <View style={styles.inputArea}>
                {/* Nút Chụp Ảnh (Camera) */}
                <TouchableOpacity onPress={toggleMenu} style={styles.iconButton}>
                    <Ionicons
                        name={menuOpen ? "close-circle" : "chevron-forward-circle"}
                        size={30}
                        color="#b9bbbe"
                    />
                </TouchableOpacity>
                {menuOpen && (
                    <View style={{ flexDirection: 'row' }}>
                        <TouchableOpacity onPress={takePhoto} disabled={isUploading} style={styles.iconButton}>
                            <Ionicons name="camera" size={24} color="#b9bbbe" />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={pickImage} disabled={isUploading} style={styles.iconButton}>
                            <Ionicons name="image" size={24} color="#b9bbbe" />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={pickDocument} disabled={isUploading} style={styles.iconButton}>
                            <Ionicons name="attach" size={24} color="#b9bbbe" />
                        </TouchableOpacity>

                    </View>
                )}{isRecording ? (
                    // 👇 GIAO DIỆN KHI ĐANG GHI ÂM
                    <View style={styles.recordingContainer}>
                        {/* Nút Hủy (Thùng rác) */}
                        <TouchableOpacity onPress={cancelRecording} style={{ padding: 10 }}>
                            <Ionicons name="trash" size={24} color="#ed4245" />
                        </TouchableOpacity>

                        {/* Thời gian đang chạy */}
                        <Text style={{ color: 'red', fontWeight: 'bold', fontSize: 16, marginHorizontal: 10 }}>
                            {formatDuration(recordingDuration)} • Đang ghi âm...
                        </Text>

                        {/* Nút Gửi (Mũi tên lên) */}
                        <TouchableOpacity onPress={stopRecording} style={{ padding: 10 }}>
                            <Ionicons name="arrow-up-circle" size={34} color="#5865F2" />
                        </TouchableOpacity>
                    </View>
                ) : (
                    <>
                        <TextInput
                            style={styles.input}
                            value={input}
                            onChangeText={setInput}
                            placeholder="Nhắn tin..."
                            placeholderTextColor="#72767d"
                            onFocus={() => setMenuOpen(false)}

                            // 👇 CÁC THUỘC TÍNH QUAN TRỌNG ĐỂ SỬA LỖI DÁN TRÊN IOS 👇
                            multiline={true}                // Bắt buộc để nhập nhiều dòng
                            textAlignVertical="center"      // Căn giữa văn bản

                            // ⛔ CHẶN AUTOFILL CỦA IOS
                            textContentType="none"          // Báo cho iOS: Đây không phải password/OTP
                            autoComplete="off"              // Tắt gợi ý điền form
                            dataDetectorTypes="none"        // Tắt phát hiện số điện thoại/link khi đang gõ

                            // ⚙️ CẤU HÌNH BÀN PHÍM
                            keyboardType="default"          // Dùng bàn phím mặc định
                            autoCorrect={false}             // Tắt tự sửa lỗi chính tả (chat code dễ hơn)
                            spellCheck={false}              // Tắt gạch chân đỏ

                            // ✅ BẬT MENU NGỮ CẢNH (Copy/Paste)
                            contextMenuHidden={false}
                            enablesReturnKeyAutomatically={true}
                        />

                        {/* Logic nút gửi: Nếu có chữ -> Gửi Text, Nếu trống -> Nút Ghi âm */}
                        {input.length > 0 ? (
                            <TouchableOpacity onPress={() => sendMessage(input, 'TEXT')}>
                                <Ionicons name="send" size={24} color="#5865F2" />
                            </TouchableOpacity>
                        ) : (
                            <TouchableOpacity onPress={startRecording}>
                                <Ionicons name="mic" size={24} color="#b9bbbe" />
                            </TouchableOpacity>
                        )}
                    </>
                )}
            </View>

            <Modal visible={modalVisible} transparent={true}>
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' }}>
                    <TouchableOpacity style={{ position: 'absolute', top: 40, right: 20, zIndex: 1 }} onPress={() => setModalVisible(false)}>
                        <Ionicons name="close-circle" size={40} color="white" />
                    </TouchableOpacity>
                    {/* Dùng height đã fix lỗi */}
                    <Image source={{ uri: selectedImage }} style={{ width: width, height: height * 0.8 }} resizeMode="contain" />
                </View>
            </Modal>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#36393f' },
    msgRow: { flexDirection: 'row', marginVertical: 5, paddingHorizontal: 10 },
    bubble: { padding: 10, borderRadius: 10 },
    myBubble: { backgroundColor: '#5865F2' },
    friendBubble: { backgroundColor: '#40444b' },
    inputArea: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingTop: 10,
        paddingBottom: 20,
        paddingHorizontal: 15,
        backgroundColor: '#2f3136',
        borderTopWidth: 1,
        borderTopColor: '#202225'
    },
    input: {
        flex: 1,
        backgroundColor: '#40444b',
        color: 'white',
        borderRadius: 20,
        paddingHorizontal: 15,
        paddingVertical: 8,
        marginHorizontal: 10
    },
    iconButton: { padding: 5 },
    recordingContainer: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 10 },
    timestampContainer: { alignItems: 'center', marginVertical: 15 },
    timestampText: { color: '#72767d', fontSize: 12, fontWeight: 'bold' },
    detailTime: { color: '#72767d', fontSize: 10, marginTop: 2, marginHorizontal: 5 },

    musicBar: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#202225',
        padding: 10,
        borderTopLeftRadius: 15,
        borderTopRightRadius: 15,
        borderBottomWidth: 1,
        borderBottomColor: '#2f3136'
    },
    musicTitle: { color: 'white', fontWeight: 'bold', fontSize: 13 },
    musicSub: { color: '#72767d', fontSize: 11 },
});