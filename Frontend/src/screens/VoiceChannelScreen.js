import { useFocusEffect } from '@react-navigation/native';
import { Audio } from 'expo-av';
import * as DocumentPicker from 'expo-document-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import SockJS from 'sockjs-client';
import Stomp from 'stompjs';
import { mediaDevices, RTCPeerConnection, RTCIceCandidate, RTCSessionDescription } from 'react-native-webrtc';
import InCallManager from 'react-native-incall-manager';
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
import { BASE_URL_IMG, SOCKET_URL } from '../utils/constants';
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
    const [isMicMuted, setIsMicMuted] = useState(false);
    const [isSpeakerOn, setIsSpeakerOn] = useState(true);
    const [connectionStatus, setConnectionStatus] = useState('CONNECTING');
    const [speakingIds, setSpeakingIds] = useState([]);

    const stompClient = useRef(null);
    const musicSound = useRef(null);
    const localStream = useRef(null);
    const peers = useRef(new Map());
    const remoteAudioTracks = useRef(new Map());
    const pendingIceCandidates = useRef(new Map());
    const isMicMutedRef = useRef(false);
    const isSpeakerOnRef = useRef(true);
    const retryTimer = useRef(null);
    const retryCount = useRef(0);
    const stopped = useRef(false);
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
            stopped.current = false;
            console.log("Đã vào kênh thoại:", channelName);
            Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true, staysActiveInBackground: true, shouldDuckAndroid: true }).catch(() => {});
            loadChannelMusic();
            startVoiceSession();

            return () => {
                console.log("Thoát màn hình - Đang dọn dẹp âm thanh...");
                isMounted.current = false; // Chặn mọi hành động load nhạc ngay lập tức
                setIsMusicPlaying(false);
                leaveVoiceSession();

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

            };
        }, [channelId, currentUser.id])
    );

    // --- 2. CẤU HÌNH HỆ THỐNG VÀ SOCKET ---
    useEffect(() => {
        navigation.setOptions({ title: `Kênh: ${channelName}` });
    }, []);

    const startVoiceSession = async () => {
        try {
            localStream.current = await mediaDevices.getUserMedia({ audio: true, video: false });
            if (stopped.current) {
                localStream.current.getTracks().forEach(track => track.stop());
                localStream.current = null;
                return;
            }
            localStream.current.getAudioTracks().forEach(track => { track.enabled = !isMicMutedRef.current; });
            InCallManager.start({ media: 'audio' });
            InCallManager.setForceSpeakerphoneOn(true);
        } catch (error) {
            Alert.alert('Micro không khả dụng', 'Bạn vẫn có thể nghe kênh. Hãy kiểm tra quyền micro trong cài đặt ứng dụng.');
        }
        if (isMounted.current) connectVoiceSocket();
    };

    const connectVoiceSocket = () => {
        if (stopped.current) return;
        const socket = new SockJS(SOCKET_URL);
        const client = Stomp.over(socket);
        stompClient.current = client;
        client.debug = null;
        client.connect({}, () => {
            if (stopped.current) { client.disconnect(); return; }
            retryCount.current = 0;
            setConnectionStatus('CONNECTED');
            client.subscribe(`/topic/voice.members.${channelId}`, message => {
                const roster = JSON.parse(message.body);
                setMembers(roster);
                syncPeers(roster);
            });
            client.subscribe(`/topic/voice.signal.${channelId}`, message => handleVoiceSignal(JSON.parse(message.body)));
            client.subscribe(`/topic/music.${channelId}`, message => handleMusicCommand(JSON.parse(message.body)));
            client.subscribe(`/topic/music.sync.${channelId}`, message => handleMusicSync(JSON.parse(message.body)));
            client.send(`/app/voice.join/${channelId}`, {}, JSON.stringify(currentUser));
            setTimeout(() => {
                if (isMounted.current && client.connected) client.send(`/app/music.control/${channelId}`, {}, JSON.stringify({ action: 'REQUEST_SYNC', sender: currentUser.username }));
            }, 1200);
        }, () => {
            if (stopped.current) return;
            setConnectionStatus('RECONNECTING');
            scheduleReconnect();
        });
    };

    const scheduleReconnect = () => {
        if (stopped.current || retryTimer.current) return;
        const delay = Math.min(1000 * (2 ** retryCount.current), 15000);
        retryCount.current += 1;
        retryTimer.current = setTimeout(() => {
            retryTimer.current = null;
            connectVoiceSocket();
        }, delay);
    };

    const sendVoiceSignal = (data) => {
        if (stompClient.current?.connected) stompClient.current.send(`/app/voice.signal/${channelId}`, {}, JSON.stringify(data));
    };

    const createPeer = (remoteId) => {
        const key = String(remoteId);
        if (peers.current.has(key)) return peers.current.get(key);
        const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        localStream.current?.getTracks().forEach(track => peer.addTrack(track, localStream.current));
        peer.onicecandidate = event => {
            if (event.candidate) sendVoiceSignal({ from: currentUser.id, to: remoteId, type: 'candidate', candidate: event.candidate.toJSON() });
        };
        peer.ontrack = event => {
            if (event.track?.kind === 'audio') {
                event.track.enabled = isSpeakerOnRef.current;
                remoteAudioTracks.current.set(key, [...(remoteAudioTracks.current.get(key) || []), event.track]);
            }
        };
        peer.onconnectionstatechange = () => {
            if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
                if (Number(currentUser.id) > Number(remoteId)) {
                    peers.current.delete(key);
                    remoteAudioTracks.current.delete(key);
                    peer.close();
                    setTimeout(() => makeOffer(remoteId), 800);
                } else {
                    sendVoiceSignal({ from: currentUser.id, to: remoteId, type: 'restart' });
                }
            }
        };
        peers.current.set(key, peer);
        return peer;
    };

    const makeOffer = async (remoteId) => {
        try {
            const peer = createPeer(remoteId);
            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);
            sendVoiceSignal({ from: currentUser.id, to: remoteId, type: 'offer', description: offer });
        } catch (error) { console.log('Voice offer failed:', error.message); }
    };

    const syncPeers = (roster) => {
        const activeIds = new Set(roster.filter(user => String(user.id) !== String(currentUser.id)).map(user => String(user.id)));
        peers.current.forEach((peer, id) => {
            if (!activeIds.has(id)) { peer.close(); peers.current.delete(id); remoteAudioTracks.current.delete(id); }
        });
        roster.forEach(user => {
            if (Number(currentUser.id) > Number(user.id) && String(user.id) !== String(currentUser.id) && !peers.current.has(String(user.id))) makeOffer(user.id);
        });
    };

    const handleVoiceSignal = async (signal) => {
        if (String(signal.to) !== String(currentUser.id) || String(signal.from) === String(currentUser.id)) return;
        if (signal.type === 'restart') {
            if (Number(currentUser.id) > Number(signal.from)) {
                peers.current.get(String(signal.from))?.close();
                peers.current.delete(String(signal.from));
                remoteAudioTracks.current.delete(String(signal.from));
                makeOffer(signal.from);
            }
            return;
        }
        try {
            if (signal.type === 'offer') {
                const oldPeer = peers.current.get(String(signal.from));
                if (oldPeer && ['failed', 'disconnected', 'closed'].includes(oldPeer.connectionState)) {
                    oldPeer.close();
                    peers.current.delete(String(signal.from));
                    remoteAudioTracks.current.delete(String(signal.from));
                }
            }
            const peer = createPeer(signal.from);
            if (signal.type === 'offer') {
                await peer.setRemoteDescription(new RTCSessionDescription(signal.description));
                await flushIceCandidates(signal.from, peer);
                const answer = await peer.createAnswer();
                await peer.setLocalDescription(answer);
                sendVoiceSignal({ from: currentUser.id, to: signal.from, type: 'answer', description: answer });
            } else if (signal.type === 'answer') {
                await peer.setRemoteDescription(new RTCSessionDescription(signal.description));
                await flushIceCandidates(signal.from, peer);
            } else if (signal.type === 'candidate' && signal.candidate) {
                if (peer.remoteDescription) await peer.addIceCandidate(new RTCIceCandidate(signal.candidate));
                else pendingIceCandidates.current.set(String(signal.from), [...(pendingIceCandidates.current.get(String(signal.from)) || []), signal.candidate]);
            }
        } catch (error) { console.log('Voice signal failed:', error.message); }
    };

    const flushIceCandidates = async (remoteId, peer) => {
        const queued = pendingIceCandidates.current.get(String(remoteId)) || [];
        pendingIceCandidates.current.delete(String(remoteId));
        for (const candidate of queued) {
            try { await peer.addIceCandidate(new RTCIceCandidate(candidate)); } catch (_) { }
        }
    };

    const leaveVoiceSession = () => {
        if (stopped.current) return;
        stopped.current = true;
        if (retryTimer.current) clearTimeout(retryTimer.current);
        retryTimer.current = null;
        if (stompClient.current?.connected) {
            stompClient.current.send(`/app/voice.leave/${channelId}/${currentUser.id}`, {});
            stompClient.current.disconnect();
        }
        peers.current.forEach(peer => peer.close());
        peers.current.clear();
        remoteAudioTracks.current.clear();
        pendingIceCandidates.current.clear();
        localStream.current?.getTracks().forEach(track => track.stop());
        localStream.current = null;
        try { InCallManager.stop(); } catch (_) { }
        Audio.setAudioModeAsync({ allowsRecordingIOS: false, staysActiveInBackground: false, shouldDuckAndroid: false }).catch(() => {});
    };

    const toggleMic = () => {
        const nextMuted = !isMicMuted;
        localStream.current?.getAudioTracks().forEach(track => { track.enabled = !nextMuted; });
        isMicMutedRef.current = nextMuted;
        setIsMicMuted(nextMuted);
    };

    const toggleSpeaker = () => {
        const nextOn = !isSpeakerOn;
        isSpeakerOnRef.current = nextOn;
        setIsSpeakerOn(nextOn);
        remoteAudioTracks.current.forEach(tracks => tracks.forEach(track => { track.enabled = nextOn; }));
    };

    useEffect(() => {
        const timer = setInterval(async () => {
            const active = new Set();
            await Promise.all([...peers.current.entries()].map(async ([id, peer]) => {
                try {
                    const stats = await peer.getStats();
                    stats.forEach(report => {
                        if (report.type === 'inbound-rtp' && report.kind === 'audio' && report.audioLevel > 0.035) active.add(Number(id));
                    });
                } catch (_) { }
            }));
            setSpeakingIds([...active]);
        }, 700);
        return () => clearInterval(timer);
    }, []);

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
            <Image source={{ uri: item.avatarUrl ? (BASE_URL_IMG + item.avatarUrl) : 'https://via.placeholder.com/100' }} style={[styles.memberAvatar, speakingIds.includes(Number(item.id)) && styles.speakingAvatar]} />
            <View style={[styles.onlineStatus, speakingIds.includes(Number(item.id)) && styles.speakingDot]} />
            <Text style={styles.memberText} numberOfLines={1}>{item.username}{speakingIds.includes(Number(item.id)) ? ' · đang nói' : ''}</Text>
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
                <View style={styles.voiceStatusRow}>
                    <Text style={styles.connectionText}>{connectionStatus === 'CONNECTED' ? 'Đã kết nối thoại' : 'Đang kết nối lại...'}</Text>
                    <TouchableOpacity style={[styles.voiceControl, isMicMuted && styles.voiceControlOff]} onPress={toggleMic}>
                        <Ionicons name={isMicMuted ? 'mic-off' : 'mic'} size={19} color="white" />
                        <Text style={styles.voiceControlText}>{isMicMuted ? 'Bật mic' : 'Tắt mic'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.voiceControl, !isSpeakerOn && styles.voiceControlOff]} onPress={toggleSpeaker}>
                        <Ionicons name={isSpeakerOn ? 'volume-high' : 'volume-mute'} size={19} color="white" />
                        <Text style={styles.voiceControlText}>{isSpeakerOn ? 'Loa' : 'Tắt loa'}</Text>
                    </TouchableOpacity>
                </View>
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
    memberSection: { height: 145, backgroundColor: '#2f3136', justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: '#202225', paddingTop: 8 },
    voiceStatusRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 8 },
    connectionText: { color: '#b9bbbe', fontSize: 11, flex: 1 },
    voiceControl: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#3ba55d', borderRadius: 15, paddingHorizontal: 9, paddingVertical: 6, marginLeft: 6 },
    voiceControlOff: { backgroundColor: '#ed4245' },
    voiceControlText: { color: 'white', fontSize: 11, marginLeft: 4 },
    memberItem: { alignItems: 'center', marginHorizontal: 10 },
    memberAvatar: { width: 50, height: 50, borderRadius: 25, borderWidth: 2, borderColor: '#5865f2' },
    onlineStatus: { position: 'absolute', bottom: 18, right: 2, width: 14, height: 14, borderRadius: 7, backgroundColor: '#43b581', borderWidth: 2, borderColor: '#2f3136' },
    memberText: { color: '#dcddde', fontSize: 11, marginTop: 4, width: 60, textAlign: 'center' },
    speakingAvatar: { borderColor: '#43b581', borderWidth: 3 },
    speakingDot: { backgroundColor: '#ffd166' },
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
