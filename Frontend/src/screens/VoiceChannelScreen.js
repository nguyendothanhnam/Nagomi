import { useFocusEffect } from '@react-navigation/native';
import { Audio } from 'expo-av';
import * as DocumentPicker from 'expo-document-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    Alert, FlatList, Image,
    Modal,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity, View
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import UserService from '../services/UserService';
import { BASE_URL_IMG } from '../utils/constants';
export default function VoiceChannelScreen({ route, navigation }) {
    const { channelId, channelName, currentUser } = route.params;

    const [members, setMembers] = useState([]);
    const [playlist, setPlaylist] = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    const [isMusicPlaying, setIsMusicPlaying] = useState(false);

    const [linkModalVisible, setLinkModalVisible] = useState(false);
    const [musicLink, setMusicLink] = useState('');
    const [musicTitle, setMusicTitle] = useState('');

    const [currentMusic, setCurrentMusic] = useState({ url: null, title: null });

    const stompClient = useRef(null);
    const musicSound = useRef(null);
    const isMounted = useRef(true); // 🛑 CÁI PHANH KHẨN CẤP
    const playlistRef = useRef([]);
    playlistRef.current = playlist; // Luôn cập nhật danh sách mới nhất vào Ref
    const currentMusicRef = useRef(currentMusic);
    useEffect(() => {
        currentMusicRef.current = currentMusic;
    }, [currentMusic]);

    // --- 1. XỬ LÝ DỌN DẸP KHI RỜI MÀN HÌNH ---
    useFocusEffect(
        useCallback(() => {
            isMounted.current = true;
            console.log("Đã vào kênh thoại:", channelName);

            return () => {
                console.log("Thoát màn hình - Đang dọn dẹp âm thanh...");
                isMounted.current = false; // Chặn mọi hành động load nhạc ngay lập tức
                setIsMusicPlaying(false);

                // Dọn dẹp Audio cưỡng bức
                const soundObj = musicSound.current;
                if (soundObj) {
                    (async () => {
                        try {
                            soundObj.setOnPlaybackStatusUpdate(null);
                            const status = await soundObj.getStatusAsync();
                            if (status.isLoaded) {
                                await soundObj.stopAsync();
                            }
                            await soundObj.unloadAsync();
                            musicSound.current = null;
                            console.log("Đã giải phóng Audio dứt điểm.");
                        } catch (e) {
                            console.log("[Log] Cleanup error (ignored):", e.message);
                        }
                    })();
                }

                // Thông báo Server rời kênh
                if (stompClient.current?.connected) {
                    stompClient.current.send(`/app/voice.leave/${channelId}/${currentUser.id}`, {});
                }
            };
        }, [channelId])
    );

    // --- 2. CẤU HÌNH HỆ THỐNG VÀ SOCKET ---
    useEffect(() => {
        navigation.setOptions({ title: `Kênh: ${channelName}` });

        const setupAudio = async () => {
            try {
                await Audio.setAudioModeAsync({
                    allowsRecordingIOS: false,
                    playsInSilentModeIOS: true,
                    staysActiveInBackground: true,
                    shouldDuckAndroid: true,
                });
            } catch (e) { console.log(e); }
        };

        setupAudio();
        loadChannelMusic();
        connectVoiceSocket();
    }, []);

    const connectVoiceSocket = () => {
        stompClient.current = global.stompClient;
        if (!stompClient.current) return;

        stompClient.current.subscribe(`/topic/voice.members.${channelId}`, (msg) => {
            setMembers(JSON.parse(msg.body));
        });

        stompClient.current.subscribe(`/topic/music.${channelId}`, (msg) => {
            handleMusicCommand(JSON.parse(msg.body));
        });

        stompClient.current.subscribe(`/topic/music.sync.${channelId}`, (msg) => {
            handleMusicSync(JSON.parse(msg.body));
        });

        stompClient.current.send(`/app/voice.join/${channelId}`, {}, JSON.stringify(currentUser));

        // Yêu cầu đồng bộ sau 1.2s
        setTimeout(() => {
            if (isMounted.current) {
                stompClient.current.send(`/app/music.control/${channelId}`, {}, JSON.stringify({
                    action: 'REQUEST_SYNC',
                    sender: currentUser.username
                }));
            }
        }, 1200);
    };

    // --- 3. LOGIC ĐIỀU KHIỂN VÀ ĐỒNG BỘ ---
    const handleMusicSync = async (data) => {
        const { url, title, position, playing } = data;
        if (!playing || !url || !isMounted.current) return;

        try {
            if (!musicSound.current) musicSound.current = new Audio.Sound();
            const status = await musicSound.current.getStatusAsync();
            let cleanUrl = url.startsWith('http') ? url : (BASE_URL_IMG + url);

            if (status.uri !== cleanUrl) {
                setCurrentMusic({ url: cleanUrl, title });
                setIsMusicPlaying(true);

                musicSound.current.setOnPlaybackStatusUpdate(null);
                if (status.isLoaded) await musicSound.current.unloadAsync();

                if (!isMounted.current) return; // Kiểm tra lại trước khi load

                await musicSound.current.loadAsync(
                    { uri: cleanUrl },
                    { shouldPlay: true, positionMillis: position + 2000 }
                );

                musicSound.current.setOnPlaybackStatusUpdate(onPlaybackStatusUpdate);
            }
        } catch (e) { console.log("❌ Sync failed:", e.message); }
    };

    const handleMusicCommand = async (data) => {
        try {
            const { action, url, title, position, sender } = data;

            if (action === 'REFRESH_LIST') return loadChannelMusic();

            if (action === 'REQUEST_SYNC' && isMusicPlaying && sender !== currentUser.username) {
                const status = await musicSound.current?.getStatusAsync();
                if (status?.isLoaded) {
                    stompClient.current.send(`/app/music.sync/${channelId}`, {}, JSON.stringify({
                        url: currentMusic.url,
                        title: currentMusic.title,
                        position: status.positionMillis,
                        playing: true
                    }));
                }
                return;
            }

            if (action === 'PLAY') {
                if (!isMounted.current) return;
                setIsMusicPlaying(true);
                let cleanUrl = url.startsWith('http') ? url : (BASE_URL_IMG + url);

                if (!musicSound.current) musicSound.current = new Audio.Sound();
                const status = await musicSound.current.getStatusAsync();

                if (status.uri !== cleanUrl) {
                    setCurrentMusic({ url: cleanUrl, title });
                    musicSound.current.setOnPlaybackStatusUpdate(null);
                    if (status.isLoaded) await musicSound.current.unloadAsync();

                    if (!isMounted.current) return;
                    await musicSound.current.loadAsync(
                        { uri: cleanUrl },
                        { shouldPlay: true, positionMillis: position || 0 }
                    );
                    musicSound.current.setOnPlaybackStatusUpdate(onPlaybackStatusUpdate);
                } else {
                    await musicSound.current.playAsync();
                }
            }
            else if (action === 'PAUSE') {
                const status = await musicSound.current?.getStatusAsync();
                if (status?.isLoaded && status?.isPlaying) {
                    await musicSound.current.pauseAsync();
                }
                setIsMusicPlaying(false);
            }
        } catch (error) { console.log("❌ Command error:", error.message); }
    };

    const onPlaybackStatusUpdate = (ps) => {
        if (ps.didJustFinish && !ps.isLooping) {
            playNextSong();
        }
    };

    const sendMusicControl = async (action, url = null, title = null) => {
        if (!stompClient.current) return;
        let pos = 0;
        if (!url) {
            try {
                const status = await musicSound.current?.getStatusAsync();
                if (status?.isLoaded) pos = status.positionMillis;
            } catch (e) { }
        }
        stompClient.current.send(`/app/music.control/${channelId}`, {}, JSON.stringify({
            action,
            url: url || currentMusic.url,
            title: title || currentMusic.title,
            position: pos,
            sender: currentUser.username
        }));
    };

    // --- 4. CÁC HÀM PHỤ TRỢ (PLAYLIST & RENDER) ---
    const loadChannelMusic = async () => {
        const data = await UserService.getChannelPlaylist(channelId);
        setPlaylist(data);
    };

    // const playNextSong = () => {
    //     if (playlist.length === 0) return;
    //     const currentIndex = playlist.findIndex(item => {
    //         const fullUrl = item.url.startsWith('http') ? item.url : (BASE_URL_IMG + item.url);
    //         return fullUrl === currentMusic.url;
    //     });
    //     const nextIndex = (currentIndex + 1) % playlist.length;
    //     const nextSong = playlist[nextIndex];
    //     sendMusicControl('PLAY', nextSong.url, nextSong.title);
    // };
    const playNextSong = () => {
        const currentPlaylist = playlistRef.current;
        const activeMusic = currentMusicRef.current; // Dùng Ref thay vì State

        if (currentPlaylist.length === 0) return;

        // Tìm vị trí bài hát hiện tại
        const currentIndex = currentPlaylist.findIndex(item => {
            const fullUrl = item.url.startsWith('http') ? item.url : (BASE_URL_IMG + item.url);
            return fullUrl === activeMusic.url;
        });

        // Nếu không tìm thấy (index = -1), mặc định phát bài đầu tiên. 
        // Nếu tìm thấy, phát bài kế tiếp, hết danh sách thì quay lại bài 0.
        const nextIndex = (currentIndex + 1) % currentPlaylist.length;
        const nextSong = currentPlaylist[nextIndex];

        console.log("Hết bài! Tự động chuyển sang:", nextSong.title);
        sendMusicControl('PLAY', nextSong.url, nextSong.title);
    };
    const addMusicToChannel = async () => {
        try {
            const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
            if (!result.canceled) {
                setIsUploading(true);
                const file = result.assets[0];
                const serverFileName = await UserService.uploadFile(file.uri, file.mimeType || 'audio/mpeg', file.name);
                if (serverFileName) {
                    await UserService.addMusicToChannel(channelId, {
                        title: file.name.replace('.mp3', ''),
                        url: serverFileName,
                        uploadedBy: currentUser.username
                    });
                    stompClient.current.send(`/app/music.control/${channelId}`, {}, JSON.stringify({ action: 'REFRESH_LIST' }));
                    loadChannelMusic();
                }
            }
        } catch (err) { Alert.alert("Lỗi", "Không thể tải file."); } finally { setIsUploading(false); }
    };

    const addMusicViaLink = async () => {
        if (!musicLink.trim() || !musicTitle.trim()) return Alert.alert("Lỗi", "Nhập đủ thông tin!");
        setIsUploading(true);
        const success = await UserService.addMusicToChannel(channelId, {
            title: musicTitle, url: musicLink, uploadedBy: currentUser.username
        });
        if (success) {
            stompClient.current.send(`/app/music.control/${channelId}`, {}, JSON.stringify({ action: 'REFRESH_LIST' }));
            setLinkModalVisible(false);
            setMusicLink(''); setMusicTitle('');
            loadChannelMusic();
        }
        setIsUploading(false);
    };

    const renderMember = ({ item }) => (
        <View style={styles.memberItem}>
            <Image source={{ uri: item.avatarUrl ? (BASE_URL_IMG + item.avatarUrl) : 'https://via.placeholder.com/100' }} style={styles.memberAvatar} />
            <View style={styles.onlineStatus} />
            <Text style={styles.memberText} numberOfLines={1}>{item.username}</Text>
        </View>
    );
    const handleDeleteMusic = (musicId, title) => {
        const deleteAction = async () => {
            try {
                const success = await UserService.deleteChannelMusic(channelId, musicId);
                if (success) {
                    if (stompClient.current) {
                        stompClient.current.send(`/app/music.control/${channelId}`, {}, JSON.stringify({
                            action: 'REFRESH_LIST'
                        }));
                    }
                    loadChannelMusic();
                }
            } catch (error) {
                console.error("Lỗi xóa nhạc:", error);
                if (Platform.OS === 'web') {
                    alert("Không thể xóa bài hát lúc này.");
                } else {
                    Alert.alert("Lỗi", "Không thể xóa bài hát lúc này.");
                }
            }
        };

        // Kiểm tra nếu là Web thì dùng confirm() của trình duyệt
        if (Platform.OS === 'web') {
            const confirmed = window.confirm(`Bạn có chắc chắn muốn xóa bài hát "${title}" không?`);
            if (confirmed) {
                deleteAction();
            }
        } else {
            // Nếu là Mobile (iOS/Android) thì dùng Alert.alert
            Alert.alert(
                "Xác nhận xóa",
                `Bạn có chắc chắn muốn xóa bài hát "${title}" không?`,
                [
                    { text: "Hủy", style: "cancel" },
                    { text: "Xóa", style: "destructive", onPress: deleteAction }
                ]
            );
        }
    };
    return (
        <View style={styles.container}>
            <View style={styles.memberSection}>
                <FlatList data={members} renderItem={renderMember} keyExtractor={(item) => item.id.toString()} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 15 }} />
            </View>

            <View style={styles.playerCard}>
                <View style={styles.playerInfo}>
                    <Ionicons name="musical-notes" size={40} color="#5865F2" />
                    <View style={styles.songMeta}>
                        <Text style={styles.nowPlayingLabel}>ĐANG PHÁT</Text>
                        <Text style={styles.songTitle} numberOfLines={1}>{currentMusic.title || "Chưa có bài hát nào"}</Text>
                    </View>
                </View>
                <View style={styles.controls}>
                    <TouchableOpacity style={styles.controlBtn} onPress={() => playNextSong()}>
                        <Ionicons name="play-back" size={28} color="#fff" />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.mainPlayBtn} onPress={() => isMusicPlaying ? sendMusicControl('PAUSE') : sendMusicControl('PLAY')}>
                        <Ionicons name={isMusicPlaying ? "pause" : "play"} size={35} color="#fff" />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.controlBtn} onPress={() => playNextSong()}>
                        <Ionicons name="play-forward" size={28} color="#fff" />
                    </TouchableOpacity>
                </View>
            </View>

            <View style={styles.playlistSection}>
                <View style={styles.playlistHeader}>
                    <Text style={styles.playlistTitle}>Danh sách bài hát ({playlist.length})</Text>
                    <View style={styles.headerActions}>
                        <TouchableOpacity onPress={addMusicToChannel} style={styles.actionIcon}><Ionicons name="cloud-upload" size={24} color="#43b581" /></TouchableOpacity>
                        <TouchableOpacity onPress={() => setLinkModalVisible(true)} style={styles.actionIcon}><Ionicons name="link" size={24} color="#00b0f4" /></TouchableOpacity>
                    </View>
                </View>
                <FlatList
                    data={playlist}
                    keyExtractor={(item) => item.id.toString()}
                    renderItem={({ item }) => {
                        // Kiểm tra xem bài hát này có phải bài đang phát không
                        const isCurrent = currentMusic.title === item.title;

                        return (
                            <View style={styles.musicItemContainer}>
                                <TouchableOpacity
                                    style={[styles.musicItem, isCurrent && styles.activeMusicItem]}
                                    onPress={() => {
                                        if (isCurrent && isMusicPlaying) sendMusicControl('PAUSE');
                                        else sendMusicControl('PLAY', item.url, item.title);
                                    }}
                                >
                                    <View style={styles.musicIconBox}>
                                        <Ionicons
                                            name={isCurrent && isMusicPlaying ? "volume-high" : "musical-note"}
                                            size={20}
                                            color={isCurrent ? "#fff" : "#b9bbbe"}
                                        />
                                    </View>

                                    <View style={{ flex: 1 }}>
                                        <Text style={[styles.musicText, isCurrent && { color: '#fff' }]}>
                                            {item.title}
                                        </Text>
                                        <Text style={styles.uploadedBy}>
                                            Tải lên bởi: {item.uploadedBy || 'Hệ thống'}
                                        </Text>
                                    </View>

                                    {/* Nút xóa - Tách biệt rõ ràng */}
                                    <TouchableOpacity
                                        style={styles.deleteBtn}
                                        onPress={() => handleDeleteMusic(item.id, item.title)}
                                    >
                                        <Ionicons name="trash-outline" size={20} color="#ed4245" />
                                    </TouchableOpacity>


                                </TouchableOpacity>
                            </View>
                        );
                    }}
                />
            </View>

            <Modal visible={linkModalVisible} transparent animationType="fade">
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <Text style={styles.modalTitle}>Thêm nhạc qua Link</Text>
                        <TextInput style={styles.modalInput} placeholder="Tên bài hát" placeholderTextColor="#72767d" value={musicTitle} onChangeText={setMusicTitle} />
                        <TextInput style={styles.modalInput} placeholder="Link mp3 trực tiếp" placeholderTextColor="#72767d" value={musicLink} onChangeText={setMusicLink} />
                        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                            <TouchableOpacity onPress={() => setLinkModalVisible(false)} style={styles.btnCancel}><Text style={{ color: 'white' }}>Hủy</Text></TouchableOpacity>
                            <TouchableOpacity onPress={addMusicViaLink} style={styles.btnAddLink}><Text style={{ color: 'white', fontWeight: 'bold' }}>Thêm</Text></TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#36393f' },
    memberSection: { height: 100, backgroundColor: '#2f3136', justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: '#202225', paddingTop: 20 },
    memberItem: { alignItems: 'center', marginHorizontal: 10 },
    memberAvatar: { width: 50, height: 50, borderRadius: 25, borderWidth: 2, borderColor: '#5865f2' },
    onlineStatus: { position: 'absolute', bottom: 18, right: 2, width: 14, height: 14, borderRadius: 7, backgroundColor: '#43b581', borderWidth: 2, borderColor: '#2f3136' },
    memberText: { color: '#dcddde', fontSize: 11, marginTop: 4, width: 60, textAlign: 'center' },
    playerCard: { margin: 15, padding: 20, backgroundColor: '#202225', borderRadius: 16 },
    playerInfo: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
    songMeta: { marginLeft: 15, flex: 1 },
    nowPlayingLabel: { color: '#5865f2', fontSize: 10, fontWeight: 'bold' },
    songTitle: { color: '#fff', fontSize: 18, fontWeight: '600' },
    controls: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
    controlBtn: { padding: 10 },
    mainPlayBtn: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#5865f2', justifyContent: 'center', alignItems: 'center', marginHorizontal: 20 },
    playlistSection: { flex: 1, backgroundColor: '#2f3136', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
    playlistHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
    playlistTitle: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
    headerActions: { flexDirection: 'row' },
    actionIcon: { marginLeft: 15 },
    musicItem: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12, marginBottom: 8, backgroundColor: '#36393f' },
    activeMusicItem: { backgroundColor: '#4f545c', borderWidth: 1, borderColor: '#5865f2' },
    musicIconBox: { width: 40, height: 40, borderRadius: 8, backgroundColor: '#202225', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
    musicText: { color: '#b9bbbe', fontSize: 15 },
    uploadedBy: { color: '#72767d', fontSize: 12 },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center' },
    modalContent: { width: '85%', backgroundColor: '#2f3136', padding: 25, borderRadius: 20 },
    modalTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 15 },
    modalInput: { backgroundColor: '#202225', color: '#fff', padding: 12, borderRadius: 8, marginBottom: 10 },
    btnCancel: { padding: 10, marginRight: 10 },
    btnAddLink: { backgroundColor: '#5865f2', padding: 10, borderRadius: 8 },
    musicItemContainer: {
        marginBottom: 8,
    },
    deleteBtn: {
        padding: 10,
        marginLeft: 5,
        justifyContent: 'center',
        alignItems: 'center',
    },
});