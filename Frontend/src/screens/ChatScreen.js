import { createAudioPlayer, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { useEffect, useRef, useState } from 'react';
import {
    Alert,
    ActivityIndicator,
    FlatList,
    Image,
    KeyboardAvoidingView,
    Keyboard,
    LayoutAnimation,
    Modal,
    Platform, StyleSheet, Text,
    ScrollView, TextInput, TouchableOpacity,
    UIManager, useWindowDimensions,
    View
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import SockJS from 'sockjs-client';
import { Stomp } from 'stompjs/lib/stomp';
import UserService from '../services/UserService';
import Avatar from '../components/Avatar';
import { BASE_URL_IMG, SOCKET_URL } from '../utils/constants';
// Kích hoạt LayoutAnimation cho Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}
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
    const { myId, friendId, friendUsername, friendAvatarUrl, type, channelId } = route.params;
    const isChannelMode = type === 'CHANNEL';
    const { width, height } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
    const [messageActions, setMessageActions] = useState([]);
    const [messageActionsTitle, setMessageActionsTitle] = useState('');
    const [isRecordingBusy, setIsRecordingBusy] = useState(false);

    const [recording, setRecording] = useState(null);
    const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
    const [isRecording, setIsRecording] = useState(false);
    const [recordingDuration, setRecordingDuration] = useState(0);
    const timerRef = useRef(null); // Để lưu interval đếm giờ


    const [sound, setSound] = useState(null);
    const [currentPlayingId, setCurrentPlayingId] = useState(null);
    const [isPlaying, setIsPlaying] = useState(false);

    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [inputHeight, setInputHeight] = useState(44);
    const [isUploading, setIsUploading] = useState(false);

    const [modalVisible, setModalVisible] = useState(false);
    const [selectedImage, setSelectedImage] = useState(null);

    const [selectedMessageId, setSelectedMessageId] = useState(null);
    const [replyToMessage, setReplyToMessage] = useState(null);
    const [editingMessage, setEditingMessage] = useState(null);
    const [editDraft, setEditDraft] = useState('');
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchText, setSearchText] = useState('');

    const stompClient = useRef(null);
    const flatListRef = useRef(null);

    const [menuOpen, setMenuOpen] = useState(false);

    useEffect(() => { if (!input.length) setInputHeight(44); }, [input.length]);

    useEffect(() => {
        if (Platform.OS === 'web') return undefined;
        const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setIsKeyboardVisible(true));
        const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setIsKeyboardVisible(false));
        return () => { show.remove(); hide.remove(); };
    }, []);

    const startVideoCall = async () => {
        const client = global.stompClient;
        if (!client?.connected) {
            Alert.alert('Chưa kết nối', 'Kết nối chat chưa sẵn sàng. Vui lòng thử lại.');
            return;
        }
        if (global.activeVideoCall || global.inVoiceChannel) {
            Alert.alert('Đang bận', 'Hãy kết thúc cuộc gọi hoặc rời kênh thoại trước khi gọi video.');
            return;
        }
        const myUsername = route.params?.myUsername || await AsyncStorage.getItem('username');
        global.activeVideoCall = { friendId, status: 'calling' };
        client.send('/app/call.signal', {}, JSON.stringify({
            type: 'CALL_REQUEST',
            fromUserId: myId,
            toUserId: friendId,
            fromUsername: myUsername,
            fromAvatarUrl: await AsyncStorage.getItem('avatarUrl'),
        }));
        navigation.navigate('VideoCall', {
            myId,
            myUsername,
            friendId,
            friendUsername,
            friendAvatarUrl,
            isCaller: true,
        });
    };

    useEffect(() => {
        navigation.setOptions({
            headerShown: false,
        });
        loadHistory();
        connectToWebSocket();

        // Cleanup khi thoát màn hình
        return () => {
            if (stompClient.current) stompClient.current.disconnect();
            stopTimer();
        };
    }, []);
    // Giải phóng trình phát hiện tại khi đổi tin nhắn hoặc thoát màn hình.
    useEffect(() => () => { sound?.remove(); }, [sound]);
    // useEffect(() => {
    //     if (messages.length > 0) {
    //         setTimeout(() => {
    //             flatListRef.current?.scrollToEnd({ animated: true });
    //         }, 100);
    //     }
    // }, [messages]);
    const appendMessage = (newMsg) => setMessages((prev) => {
        if (prev.some(message => String(message.id) === String(newMsg.id))) return prev;
        const list = [...prev, newMsg];
        // Sắp xếp theo ID để đảm bảo thứ tự đúng
        return list.sort((a, b) => (b.id || 0) - (a.id || 0));
    });

    const applyMessageEvent = (event) => {
        if (event.action === 'DELETE') {
            setMessages(previous => previous.filter(message => String(message.id) !== String(event.id)));
        } else if (event.action === 'UPDATE' && event.message) {
            setMessages(previous => previous.map(message => String(message.id) === String(event.message.id) ? event.message : message));
        } else {
            appendMessage(event);
        }
    };

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
                if (newMessage.action) {
                    applyMessageEvent(newMessage);
                } else if (isChannelMode) {
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
        if (!content || (msgType === 'TEXT' && !content.trim())) return;
        if (!stompClient.current?.connected) {
            const message = 'Kết nối chat chưa sẵn sàng. Nội dung của bạn vẫn được giữ lại.';
            if (Platform.OS === 'web') window.alert(message);
            else Alert.alert('Chưa kết nối', message);
            return;
        }

        let payload = { content, type: msgType, duration: duration }; // Thêm duration vào payload

        if (isChannelMode) {
            payload = { ...payload, replyToId: replyToMessage?.id || null };
            payload = { ...payload, sender: { id: myId }, channel: { id: channelId } };
            stompClient.current.send("/app/channel-message", {}, JSON.stringify(payload));
            setReplyToMessage(null);
        } else {
            payload = { ...payload, senderId: myId, receiverId: friendId, replyToId: replyToMessage?.id || null };
            stompClient.current.send("/app/private-message", {}, JSON.stringify(payload));
            setReplyToMessage(null);
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
        Keyboard.dismiss();
        setSelectedMessageId(null);
        const senderId = item.senderId || item.sender?.id;
        const isMine = String(senderId) === String(myId);
        const actions = [{ text: 'Đóng', style: 'cancel' }];
        if (item.type === 'TEXT') actions.unshift({ text: 'Sao chép', onPress: () => handleCopyMessage(item.content) });
        actions.unshift({ text: 'Trả lời', onPress: () => setReplyToMessage(item) });
        actions.unshift({ text: 'Thả cảm xúc', onPress: () => chooseReaction(item) });
        if (isMine && item.type === 'TEXT') actions.unshift({ text: 'Chỉnh sửa', onPress: () => { setEditingMessage(item); setEditDraft(item.content); } });
        if (isMine) actions.unshift({ text: item.pinned ? 'Bỏ ghim' : 'Ghim', onPress: () => updatePinned(item) });
        if (isMine) actions.unshift({ text: 'Xóa', style: 'destructive', onPress: () => deleteMessage(item) });
        setMessageActionsTitle('Tùy chọn tin nhắn');
        setMessageActions(actions);
    };

    const chooseReaction = (message) => {
        setMessageActionsTitle('Thả cảm xúc');
        setMessageActions([
            ...['👍', '❤️', '😂', '😮', '😢', '🎉'].map(emoji => ({ text: emoji, onPress: () => runMessageAction(() => UserService.toggleMessageReaction(message.id, emoji, isChannelMode)) })),
            { text: 'Hủy', style: 'cancel' }
        ]);
    };
    const runMessageAction = async (action) => {
        try { await action(); } catch (error) { Alert.alert('Lỗi', String(error.response?.data || error)); }
    };
    const updatePinned = (message) => runMessageAction(() => UserService.toggleMessagePin(message.id, isChannelMode));
    const deleteMessage = (message) => {
        if (Platform.OS === 'web') {
            if (window.confirm('Bạn muốn xóa tin nhắn này?')) runMessageAction(() => UserService.deleteMessage(message.id, isChannelMode));
            return;
        }
        Alert.alert('Xóa tin nhắn', 'Bạn muốn xóa tin nhắn này?', [
            { text: 'Hủy', style: 'cancel' },
            { text: 'Xóa', style: 'destructive', onPress: () => runMessageAction(() => UserService.deleteMessage(message.id, isChannelMode)) }
        ]);
    };
    const saveEditedMessage = async () => {
        if (!editingMessage || !editDraft.trim()) return;
        try {
            await UserService.editMessage(editingMessage.id, editDraft.trim(), isChannelMode);
            setEditingMessage(null);
        } catch (error) { Alert.alert('Lỗi', String(error.response?.data || error)); }
    };
    const readReactions = (raw) => {
        try { return typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {}); }
        catch { return {}; }
    };
    // 1. CHỌN ẢNH TỪ THƯ VIỆN
    const pickImage = async () => {
        try {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== 'granted') return alert('Cần quyền truy cập ảnh!');

            let result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
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
                mediaTypes: ['images'],
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
        if (isRecordingBusy || isRecording) return;
        setIsRecordingBusy(true);
        setMenuOpen(false);
        try {
            // Dừng nhạc nếu đang phát trước khi ghi âm
            if (sound) {
                sound.pause();
                setSound(null);
                setCurrentPlayingId(null);
                setIsPlaying(false);
            }

            const permission = await requestRecordingPermissionsAsync();
            if (permission.status === 'granted') {
                await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
                await audioRecorder.prepareToRecordAsync();
                audioRecorder.record();
                setRecording(audioRecorder); setIsRecording(true); startTimer();
            } else alert('Cần quyền Micro');
        } catch (err) { console.error(err); }
        finally { setIsRecordingBusy(false); }
    };

    const stopRecording = async () => {
        if (!recording || isRecordingBusy) return;
        setIsRecordingBusy(true);
        stopTimer();
        try {
            await recording.stop();
            if (recording.uri) await handleUpload(recording.uri, 'VOICE', 'audio/m4a', `voice_${new Date().getTime()}.m4a`, recordingDuration);
        } catch (error) {
            Alert.alert('Lỗi ghi âm', 'Không thể lưu tin nhắn thoại.');
        } finally {
            stopTimer(); setIsRecording(false); setRecording(null); setRecordingDuration(0);
            setIsRecordingBusy(false);
            await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        }
    };
    const cancelRecording = async () => {
        if (isRecordingBusy) return;
        setIsRecordingBusy(true);
        stopTimer();
        try {
            if (recording) await recording.stop();
        } finally {
            setIsRecording(false); setRecordingDuration(0); setRecording(null); setIsRecordingBusy(false);
            await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        }
    };
    const playSound = async (uri, messageId) => {
        try {
            // 1. Nếu bấm vào chính tin nhắn đang phát -> Toggle Pause/Resume
            if (currentPlayingId === messageId) {
                if (isPlaying) {
                    sound.pause();
                    setIsPlaying(false);
                } else {
                    sound.play();
                    setIsPlaying(true);
                }
                return;
            }

            // 2. Nếu bấm vào tin nhắn KHÁC -> Dừng tin cũ trước
            if (sound) {
                // Dừng và Gỡ bỏ an toàn
                try {
                    sound.pause();
                } catch (e) { console.log("Lỗi unload sound cũ (không sao):", e); }

                setSound(null);
                setCurrentPlayingId(null);
                setIsPlaying(false);
            }

            // 3. Thiết lập chế độ âm thanh (Quan trọng cho iOS)
            await setAudioModeAsync({
                allowsRecording: false,
                playsInSilentMode: true, // Để nghe được kể cả khi để chế độ im lặng
            });

            // 4. Tạo và phát âm thanh mới
            const newSound = createAudioPlayer({ uri: uri.startsWith('http') ? uri : BASE_URL_IMG + uri });

            setSound(newSound);
            setCurrentPlayingId(messageId);
            setIsPlaying(true);

            // 5. Tự động reset khi phát xong
            newSound.addListener('playbackStatusUpdate', (status) => {
                if (status.didJustFinish) {
                    setIsPlaying(false);
                    setCurrentPlayingId(null);
                    setSound(null);
                }
            });
            newSound.play();

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
        if (!menuOpen) Keyboard.dismiss();
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
        const reactions = readReactions(item.reactions);
        const replyTarget = item.replyToId ? messages.find(message => String(message.id) === String(item.replyToId)) : null;
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
                                {item.pinned && <Text style={styles.pinnedLabel}>📌 Đã ghim</Text>}
                                {replyTarget && <Text style={styles.replySnippet} numberOfLines={1}>↪ {replyTarget.sender?.username || 'Tin nhắn'}: {replyTarget.content}</Text>}
                                {isImage ? (
                                    <TouchableOpacity onPress={() => { setSelectedImage(BASE_URL_IMG + item.content); setModalVisible(true); }} onLongPress={() => handleLongPress(item)} accessibilityRole="button" accessibilityLabel="Mở ảnh">
                                        <Image
                                            source={{ uri: BASE_URL_IMG + item.content }}
                                            style={{ width: 200, height: 200, borderRadius: 10 }}
                                            resizeMode="cover"
                                        />
                                    </TouchableOpacity>
                                ) : isFile ? (
                                    // 👇 TRƯỜNG HỢP FILE (Mới thêm vào đây)
                                    <TouchableOpacity
                                        style={{ flexDirection: 'row', alignItems: 'center', padding: 5, minHeight: 44 }}
                                        onPress={() => Linking.openURL(BASE_URL_IMG + item.content)}
                                        onLongPress={() => handleLongPress(item)}
                                        accessibilityRole="button" accessibilityLabel="Mở tệp đính kèm"
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
                                        style={{ flexDirection: 'row', alignItems: 'center', padding: 5, minHeight: 44 }}
                                        onPress={() => playSound(item.content, item.id)} // Truyền thêm item.id
                                        onLongPress={() => handleLongPress(item)}
                                        accessibilityRole="button" accessibilityLabel="Phát hoặc tạm dừng tin nhắn thoại"
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
                                    <Text style={{ color: isMyMessage ? 'white' : '#dcddde', fontSize: 16 }}>{item.content}{item.edited ? ' (đã sửa)' : ''}</Text>
                                )}
                            </View>
                        </TouchableOpacity>
                        {Object.keys(reactions).length > 0 && <View style={styles.reactionsRow}>
                            {Object.entries(reactions).map(([emoji, users]) => (
                                <TouchableOpacity key={emoji} style={styles.reactionChip}
                                    onPress={() => runMessageAction(() => UserService.toggleMessageReaction(item.id, emoji, isChannelMode))}>
                                    <Text style={styles.reactionText}>{emoji} {users.length}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>}
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

    const visibleMessages = searchText.trim()
        ? messages.filter(message => String(message.content || '').toLowerCase().includes(searchText.trim().toLowerCase()))
        : messages;

    return (
        <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <KeyboardAvoidingView style={styles.keyboardContent} behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined} keyboardVerticalOffset={0}>
            <View style={styles.chatHeader}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Quay lại">
                    <Ionicons name="arrow-back" size={23} color="#d8d9dd" />
                </TouchableOpacity>
                <Avatar uri={friendAvatarUrl} name={friendUsername} size={36} />
                <View style={styles.chatIdentity}>
                    <Text style={styles.chatName} numberOfLines={1}>{friendUsername || (isChannelMode ? 'Kênh trò chuyện' : 'Tin nhắn')}</Text>
                    <Text style={styles.presenceText}>{isChannelMode ? 'Trò chuyện trong kênh' : 'Tin nhắn riêng'}</Text>
                </View>
                <View style={styles.headerTools}>
                    {!isChannelMode && (
                        <TouchableOpacity onPress={startVideoCall} style={styles.headerSearchButton} accessibilityRole="button" accessibilityLabel="Gọi video">
                            <Ionicons name="videocam" size={21} color="#b9bbbe" />
                        </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={() => { setSearchOpen(!searchOpen); setSearchText(''); }} style={[styles.headerSearchButton, searchOpen && styles.headerToolActive]} accessibilityRole="button" accessibilityLabel={searchOpen ? 'Đóng tìm kiếm' : 'Tìm tin nhắn'}>
                        <Ionicons name="search" size={19} color="#d4d5da" />
                    </TouchableOpacity>
                </View>
            </View>
            {searchOpen && <View style={styles.searchBar}>
                <Ionicons name="search" size={18} color="#a9abb3" />
                <TextInput style={styles.searchInput} value={searchText} onChangeText={setSearchText} placeholder="Tìm tin nhắn..." placeholderTextColor="#9a9ca5" autoFocus accessibilityLabel="Tìm trong cuộc trò chuyện" />
                <TouchableOpacity style={styles.backButton} onPress={() => { setSearchOpen(false); setSearchText(''); }} accessibilityRole="button" accessibilityLabel="Đóng tìm kiếm"><Ionicons name="close" size={21} color="#dcddde" /></TouchableOpacity>
            </View>}
            {messages.length === 0 && !searchText.trim() ? (
                <ScrollView style={styles.messageList} contentContainerStyle={styles.welcomeScroll} keyboardShouldPersistTaps="handled">
                    <View style={styles.welcomeContent}>
                        <View style={styles.welcomeAvatar}><Avatar uri={friendAvatarUrl} name={friendUsername} size={62} /></View>
                        <Text style={styles.welcomeName}>{friendUsername || 'Cuộc trò chuyện mới'}</Text>
                        <Text style={styles.welcomeTitle}>{isChannelMode ? 'Bắt đầu trò chuyện cùng mọi người trong kênh.' : 'Gửi lời chào để bắt đầu cuộc trò chuyện.'}</Text>
                        <Text style={styles.composerHint}>Nhấn giữ tin nhắn để trả lời, sao chép hoặc thả cảm xúc.</Text>
                    </View>
                </ScrollView>
            ) : (
                <FlatList
                    ref={flatListRef} inverted={true} data={visibleMessages} keyExtractor={(item) => String(item.id)}
                    renderItem={renderMessage}
                    style={styles.messageList}
                    contentContainerStyle={styles.messageListContent}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                    ListEmptyComponent={<Text style={styles.noSearchResults}>Không tìm thấy tin nhắn phù hợp.</Text>}
                />
            )}

            {replyToMessage && <View style={styles.replyComposer}>
                <Text style={styles.replyComposerText} numberOfLines={1}>Trả lời: {replyToMessage.sender?.username || 'tin nhắn'} — {replyToMessage.content}</Text>
                <TouchableOpacity style={styles.backButton} onPress={() => setReplyToMessage(null)} accessibilityRole="button" accessibilityLabel="Hủy trả lời"><Ionicons name="close" size={20} color="#b9bbbe" /></TouchableOpacity>
            </View>}

            {isUploading && <View style={styles.uploadStatus}><ActivityIndicator size="small" color="#b3baff" /><Text style={styles.uploadText}>Đang gửi tệp...</Text></View>}
            {menuOpen && !isRecording && <View style={styles.attachmentPanel}>
                <TouchableOpacity onPress={() => { setMenuOpen(false); takePhoto(); }} disabled={isUploading} style={styles.attachmentButton} accessibilityRole="button" accessibilityLabel="Chụp ảnh">
                    <Ionicons name="camera" size={25} color="#b3baff" /><Text style={styles.attachmentLabel}>Chụp ảnh</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setMenuOpen(false); pickImage(); }} disabled={isUploading} style={styles.attachmentButton} accessibilityRole="button" accessibilityLabel="Chọn ảnh từ thư viện">
                    <Ionicons name="images" size={25} color="#88dbb0" /><Text style={styles.attachmentLabel}>Ảnh</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setMenuOpen(false); pickDocument(); }} disabled={isUploading} style={styles.attachmentButton} accessibilityRole="button" accessibilityLabel="Đính kèm tệp">
                    <Ionicons name="document-attach" size={25} color="#e3b2e9" /><Text style={styles.attachmentLabel}>Tệp</Text>
                </TouchableOpacity>
            </View>}
            <View style={[styles.inputArea, { paddingBottom: isKeyboardVisible ? 8 : Math.max(8, insets.bottom) }]}>
                {!isRecording && <TouchableOpacity onPress={toggleMenu} disabled={isUploading || isRecordingBusy} style={[styles.composerRoundButton, menuOpen && styles.headerToolActive]} accessibilityRole="button" accessibilityLabel={menuOpen ? 'Đóng đính kèm' : 'Mở đính kèm'} accessibilityState={{ expanded: menuOpen }}>
                    <Ionicons
                        name={menuOpen ? "close" : "add"}
                        size={23}
                        color="#d5d6da"
                    />
                </TouchableOpacity>}
                {isRecording ? (
                    // 👇 GIAO DIỆN KHI ĐANG GHI ÂM
                    <View style={styles.recordingContainer}>
                        {/* Nút Hủy (Thùng rác) */}
                        <TouchableOpacity onPress={cancelRecording} disabled={isRecordingBusy} style={styles.composerActionButton} accessibilityRole="button" accessibilityLabel="Hủy ghi âm">
                            <Ionicons name="trash" size={24} color="#ed4245" />
                        </TouchableOpacity>

                        {/* Thời gian đang chạy */}
                        <Text style={styles.recordingText} numberOfLines={1}>
                            {formatDuration(recordingDuration)} · {isRecordingBusy ? 'Đang gửi...' : 'Đang ghi âm'}
                        </Text>

                        {/* Nút Gửi (Mũi tên lên) */}
                        <TouchableOpacity onPress={stopRecording} disabled={isRecordingBusy} style={[styles.composerActionButton, styles.sendButton]} accessibilityRole="button" accessibilityLabel="Gửi tin nhắn thoại">
                            {isRecordingBusy ? <ActivityIndicator color="#fff" /> : <Ionicons name="send" size={22} color="#fff" />}
                        </TouchableOpacity>
                    </View>
                ) : (
                    <>
                        <View style={styles.composerInputWrap}>
                        <TextInput
                            style={[styles.input, { height: inputHeight }]}
                            value={input}
                            onChangeText={setInput}
                            placeholder="Nhắn tin..."
                            placeholderTextColor="#72767d"
                            onFocus={() => setMenuOpen(false)}
                            accessibilityLabel="Nội dung tin nhắn"
                            onContentSizeChange={event => setInputHeight(Math.max(44, Math.min(128, event.nativeEvent.contentSize.height)))}
                            onKeyPress={event => {
                                if (Platform.OS === 'web' && event.nativeEvent.key === 'Enter' && !event.nativeEvent.shiftKey && !event.shiftKey && !event.nativeEvent.isComposing) {
                                    event.preventDefault();
                                    if (!isUploading && input.trim()) sendMessage(input, 'TEXT');
                                }
                            }}

                            // 👇 CÁC THUỘC TÍNH QUAN TRỌNG ĐỂ SỬA LỖI DÁN TRÊN IOS 👇
                            multiline={true}                // Bắt buộc để nhập nhiều dòng
                            textAlignVertical="top"

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
                        </View>

                        {/* Logic nút gửi: Nếu có chữ -> Gửi Text, Nếu trống -> Nút Ghi âm */}
                        {input.length > 0 ? (
                            <TouchableOpacity onPress={() => sendMessage(input, 'TEXT')} disabled={!input.trim() || isUploading} style={[styles.composerActionButton, styles.sendButton, (!input.trim() || isUploading) && styles.disabledButton]} accessibilityRole="button" accessibilityLabel="Gửi tin nhắn">
                                <Ionicons name="send" size={22} color="#fff" />
                            </TouchableOpacity>
                        ) : (
                            <TouchableOpacity onPress={startRecording} disabled={isUploading || isRecordingBusy} style={styles.composerActionButton} accessibilityRole="button" accessibilityLabel="Ghi âm tin nhắn">
                                {isRecordingBusy ? <ActivityIndicator color="#b3baff" /> : <Ionicons name="mic" size={24} color="#dcddde" />}
                            </TouchableOpacity>
                        )}
                    </>
                )}
            </View>
            {Platform.OS === 'web' && <Text style={styles.keyboardHint}>Enter để gửi · Shift + Enter để xuống dòng</Text>}

            <Modal visible={modalVisible} transparent={true} onRequestClose={() => setModalVisible(false)}>
                <SafeAreaView style={styles.imagePreview}>
                    <TouchableOpacity style={styles.imageCloseButton} onPress={() => setModalVisible(false)} accessibilityRole="button" accessibilityLabel="Đóng ảnh">
                        <Ionicons name="close" size={28} color="white" />
                    </TouchableOpacity>
                    {/* Dùng height đã fix lỗi */}
                    <Image source={{ uri: selectedImage }} style={{ width: width, flex: 1 }} resizeMode="contain" />
                </SafeAreaView>
            </Modal>
            <Modal visible={!!editingMessage} transparent animationType="fade" onRequestClose={() => setEditingMessage(null)}>
                <KeyboardAvoidingView style={styles.editBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}>
                    <View style={styles.editCard}>
                        <Text style={styles.editTitle}>Chỉnh sửa tin nhắn</Text>
                        <TextInput style={styles.editInput} value={editDraft} onChangeText={setEditDraft} multiline autoFocus />
                        <View style={styles.editActions}>
                            <TouchableOpacity style={styles.editActionButton} onPress={() => setEditingMessage(null)} accessibilityRole="button" accessibilityLabel="Hủy chỉnh sửa"><Text style={styles.editCancel}>Hủy</Text></TouchableOpacity>
                            <TouchableOpacity style={styles.editActionButton} onPress={saveEditedMessage} accessibilityRole="button" accessibilityLabel="Lưu chỉnh sửa"><Text style={styles.editSave}>Lưu</Text></TouchableOpacity>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
            <Modal visible={messageActions.length > 0} transparent animationType="slide" onRequestClose={() => setMessageActions([])}>
                <View style={styles.actionBackdrop}>
                    <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={() => setMessageActions([])} accessibilityRole="button" accessibilityLabel="Đóng tùy chọn tin nhắn" />
                    <SafeAreaView edges={['bottom', 'left', 'right']} style={[styles.actionSheet, { maxHeight: height * 0.75 }]}>
                        <View style={styles.sheetHandle} />
                        <Text style={styles.actionTitle}>{messageActionsTitle}</Text>
                        <ScrollView keyboardShouldPersistTaps="handled">
                            {messageActions.map(action => <TouchableOpacity key={action.text} style={styles.messageAction} accessibilityRole="button" accessibilityLabel={action.text} onPress={() => { setMessageActions([]); action.onPress?.(); }}>
                                <Text style={[styles.messageActionText, action.style === 'destructive' && styles.destructiveText, action.style === 'cancel' && styles.cancelActionText]}>{action.text}</Text>
                            </TouchableOpacity>)}
                        </ScrollView>
                    </SafeAreaView>
                </View>
            </Modal>
        </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, minHeight: 0, backgroundColor: '#2f3136' },
    keyboardContent: { flex: 1, minHeight: 0 },
    chatHeader: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6, backgroundColor: '#202225', borderBottomWidth: 1, borderBottomColor: '#38393f', gap: 8 },
    backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    chatIdentity: { flex: 1, minWidth: 0, marginLeft: 1 },
    chatName: { color: '#f0f1f3', fontSize: 15, fontWeight: '700' },
    presenceText: { color: '#a9abb3', fontSize: 12, marginTop: 3 },
    headerTools: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    headerSearchButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
    headerToolActive: { backgroundColor: '#42465c' },
    messageList: { flex: 1, minHeight: 0 },
    messageListContent: { width: '100%', maxWidth: 1040, alignSelf: 'center', paddingVertical: 12 },
    welcomeScroll: { flexGrow: 1 },
    welcomeContent: { flex: 1, justifyContent: 'center', minHeight: 245, paddingHorizontal: 24, paddingVertical: 28, maxWidth: 600, width: '100%', alignSelf: 'center' },
    welcomeAvatar: { alignSelf: 'center', marginBottom: 12 },
    welcomeName: { color: '#f2f3f5', textAlign: 'center', fontSize: 22, fontWeight: '700', marginBottom: 10 },
    welcomeTitle: { color: '#c9cbd1', textAlign: 'center', fontSize: 14, lineHeight: 21 },
    composerHint: { color: '#a4a6ae', fontSize: 12, lineHeight: 19, textAlign: 'center', marginTop: 18 },
    noSearchResults: { color: '#a4a6ae', textAlign: 'center', padding: 24 },
    msgRow: { flexDirection: 'row', marginVertical: 5, paddingHorizontal: 10 },
    bubble: { paddingHorizontal: 13, paddingVertical: 11, borderRadius: 14, minHeight: 44, minWidth: 44 },
    myBubble: { backgroundColor: '#5865F2' },
    friendBubble: { backgroundColor: '#40444b' },
    inputArea: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        paddingTop: 8,
        paddingBottom: 8,
        paddingHorizontal: 12,
        backgroundColor: '#202225',
        gap: 8,
        width: '100%',
        maxWidth: 1040,
        alignSelf: 'center',
    },
    composerRoundButton: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#36393f' },
    composerInputWrap: { flex: 1, minWidth: 0, backgroundColor: '#383b42', borderRadius: 14, paddingHorizontal: 12, minHeight: 44 },
    composerActionButton: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#36393f' },
    sendButton: { backgroundColor: '#5865F2' },
    disabledButton: { opacity: 0.45 },
    attachmentPanel: { flexDirection: 'row', gap: 10, padding: 12, width: '100%', maxWidth: 1040, alignSelf: 'center', backgroundColor: '#202225', borderTopWidth: 1, borderTopColor: '#3a3d44' },
    attachmentButton: { flex: 1, minHeight: 76, alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, backgroundColor: '#36393f' },
    attachmentLabel: { color: '#dcddde', fontSize: 12, fontWeight: '500' },
    uploadStatus: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#202225' },
    uploadText: { color: '#c4c8e5', fontSize: 12 },
    keyboardHint: { backgroundColor: '#202225', color: '#a4a6ae', fontSize: 11, paddingBottom: 8, textAlign: 'center' },
    input: {
        flex: 1,
        color: '#f0f1f3',
        paddingHorizontal: 3,
        paddingVertical: 8,
        fontSize: 16,
        lineHeight: 22,
        maxHeight: 128,
        minHeight: 44,
    },
    recordingContainer: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
    recordingText: { flex: 1, color: '#ff9199', fontWeight: '600', fontSize: 14 },
    timestampContainer: { alignItems: 'center', marginVertical: 15 },
    timestampText: { color: '#72767d', fontSize: 12, fontWeight: 'bold' },
    detailTime: { color: '#a4a6ae', fontSize: 11, marginTop: 4, marginHorizontal: 5 },
    pinnedLabel: { color: '#ffd166', fontSize: 11, marginBottom: 4 },
    replySnippet: { color: '#c7c9ce', fontSize: 12, borderLeftWidth: 2, borderLeftColor: '#b9bbbe', paddingLeft: 6, marginBottom: 4 },
    reactionsRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4, justifyContent: 'flex-end' },
    reactionChip: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: '#5865F2', backgroundColor: '#2f3136', paddingHorizontal: 8, paddingVertical: 6, margin: 2 },
    reactionText: { color: '#dcddde', fontSize: 13 },
    searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 16, paddingRight: 4, backgroundColor: '#292b30', borderBottomWidth: 1, borderBottomColor: '#38393f' },
    searchInput: { flex: 1, minWidth: 0, minHeight: 48, color: 'white', paddingVertical: 10, fontSize: 15 },
    replyComposer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#202225', paddingHorizontal: 14, paddingVertical: 8 },
    replyComposerText: { color: '#dcddde', flex: 1, marginRight: 8 },
    editBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', padding: 24 },
    editCard: { backgroundColor: '#2f3136', borderRadius: 12, padding: 16, width: '100%', maxWidth: 560, alignSelf: 'center' },
    editTitle: { color: 'white', fontWeight: 'bold', fontSize: 17, marginBottom: 12 },
    editInput: { backgroundColor: '#40444b', color: 'white', borderRadius: 8, minHeight: 90, padding: 10, textAlignVertical: 'top' },
    editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 20, marginTop: 16 },
    editActionButton: { minWidth: 64, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
    editCancel: { color: '#b9bbbe' },
    editSave: { color: '#7289da', fontWeight: 'bold' },
    actionBackdrop: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)' },
    actionSheet: { width: '100%', maxWidth: 560, backgroundColor: '#2f3136', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingBottom: 8 },
    sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#72767d', alignSelf: 'center', marginTop: 10, marginBottom: 16 },
    actionTitle: { color: '#f2f3f5', fontSize: 17, fontWeight: '700', marginBottom: 12 },
    messageAction: { minHeight: 48, paddingHorizontal: 12, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#454850', justifyContent: 'center' },
    messageActionText: { color: '#f2f3f5', fontSize: 16 },
    destructiveText: { color: '#ff858e' },
    cancelActionText: { color: '#b9bbbe', textAlign: 'center' },
    imagePreview: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', alignItems: 'center' },
    imageCloseButton: { width: 48, height: 48, alignSelf: 'flex-end', alignItems: 'center', justifyContent: 'center', marginRight: 8 },

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
