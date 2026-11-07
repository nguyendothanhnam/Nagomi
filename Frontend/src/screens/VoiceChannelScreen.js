import { useFocusEffect } from '@react-navigation/native';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { isRunningInExpoGo } from 'expo';
import * as DocumentPicker from 'expo-document-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import SockJS from 'sockjs-client';
import { Stomp } from 'stompjs/lib/stomp';
import {
    Alert, FlatList,
    Modal,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity, useWindowDimensions, View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Avatar from '../components/Avatar';
import UserService from '../services/UserService';
import { BASE_URL_IMG, SOCKET_URL } from '../utils/constants';

// Web dùng API trình duyệt; chỉ development build mới nạp module native.
const isExpoGo = isRunningInExpoGo();
const isPreview = isExpoGo || (Platform.OS === 'web' && (!globalThis.navigator?.mediaDevices?.getUserMedia || !globalThis.RTCPeerConnection));
const webrtc = Platform.OS === 'web' ? {
    mediaDevices: globalThis.navigator?.mediaDevices,
    RTCPeerConnection: globalThis.RTCPeerConnection,
    RTCIceCandidate: globalThis.RTCIceCandidate,
    RTCSessionDescription: globalThis.RTCSessionDescription,
    MediaStream: globalThis.MediaStream,
} : isExpoGo ? {} : require('react-native-webrtc');
const { mediaDevices, RTCPeerConnection, RTCIceCandidate, RTCSessionDescription, MediaStream, RTCView } = webrtc;
const InCallManager = Platform.OS === 'web' || isExpoGo ? null : require('react-native-incall-manager').default;

export default function VoiceChannelScreen({ route, navigation }) {
    const { channelId, channelName, currentUser } = route.params;
    const { width } = useWindowDimensions();
    const [musicPanelVisible, setMusicPanelVisible] = useState(false);

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
    const [cameraStream, setCameraStream] = useState(null);
    const [isCameraOff, setIsCameraOff] = useState(true);
    const [isCameraChanging, setIsCameraChanging] = useState(false);
    const [memberMediaStates, setMemberMediaStates] = useState({});
    const [remoteStreams, setRemoteStreams] = useState({});
    const [nativeVideoLayouts, setNativeVideoLayouts] = useState({});
    const [audioPlaybackBlocked, setAudioPlaybackBlocked] = useState(false);
    const [mediaError, setMediaError] = useState('');

    const stompClient = useRef(null);
    const musicSound = useRef(null);
    const musicSoundUrl = useRef(null);
    const localStream = useRef(null);
    const cameraStreamRef = useRef(null);
    const cameraChangingRef = useRef(false);
    const videoSenders = useRef(new Map());
    const remoteStreamRefs = useRef(new Map());
    const remoteAudioElements = useRef(new Map());
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
            if (isPreview) {
                setConnectionStatus('PREVIEW');
                return () => { isMounted.current = false; stopped.current = true; };
            }
            global.inVoiceChannel = true;
            console.log("Đã vào kênh thoại:", channelName);
            setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'duckOthers' }).catch(() => {});
            loadChannelMusic();
            startVoiceSession();

            return () => {
                console.log("Thoát màn hình - Đang dọn dẹp âm thanh...");
                isMounted.current = false; // Chặn mọi hành động load nhạc ngay lập tức
                global.inVoiceChannel = false;
                setIsMusicPlaying(false);
                leaveVoiceSession();

                // Dọn dẹp Audio cưỡng bức
                const soundObj = musicSound.current;
                if (soundObj) {
                    (async () => {
                        try {
                            soundObj.remove();
                            musicSound.current = null;
                            musicSoundUrl.current = null;
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
        navigation.setOptions({ title: `Kênh: ${channelName}`, headerShown: false });
    }, [navigation, channelName]);

    const startVoiceSession = async () => {
        try {
            localStream.current = await mediaDevices.getUserMedia({ audio: true, video: false });
            if (stopped.current) {
                localStream.current.getTracks().forEach(track => track.stop());
                localStream.current = null;
                return;
            }
            localStream.current.getAudioTracks().forEach(track => { track.enabled = !isMicMutedRef.current; });
            InCallManager?.start({ media: 'audio' });
            InCallManager?.setForceSpeakerphoneOn(true);
            if (isMounted.current) setMediaError('');
        } catch (error) {
            if (isMounted.current) setMediaError('Chưa mở được micro. Hãy cấp quyền micro rồi vào lại kênh; bạn vẫn có thể nghe người khác.');
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
                sendMediaState();
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

    const sendMediaState = () => {
        sendVoiceSignal({ from: currentUser.id, type: 'media-state', cameraEnabled: !!cameraStreamRef.current, micMuted: !localStream.current?.getAudioTracks().some(track => track.enabled) });
    };

    const removeRemoteMedia = (remoteId) => {
        const key = String(remoteId);
        const audio = remoteAudioElements.current.get(key);
        if (audio) { audio.pause(); audio.srcObject = null; }
        remoteAudioElements.current.delete(key);
        remoteStreamRefs.current.delete(key);
        videoSenders.current.delete(key);
        remoteAudioTracks.current.delete(key);
        pendingIceCandidates.current.delete(key);
        setRemoteStreams(previous => { const next = { ...previous }; delete next[key]; return next; });
        setMemberMediaStates(previous => { const next = { ...previous }; delete next[key]; return next; });
    };

    const resumeRemoteAudio = async () => {
        // Gọi play trực tiếp từ thao tác bấm để trình duyệt cho phép phát âm thanh.
        const results = await Promise.allSettled([...remoteAudioElements.current.values()].map(audio => audio.play()));
        if (isMounted.current) setAudioPlaybackBlocked(results.some(result => result.status === 'rejected'));
    };

    const createPeer = (remoteId) => {
        const key = String(remoteId);
        if (peers.current.has(key)) return peers.current.get(key);
        const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        localStream.current?.getAudioTracks().forEach(track => peer.addTrack(track, localStream.current));
        if (!localStream.current?.getAudioTracks().length) peer.addTransceiver('audio', { direction: 'recvonly' });
        // Đàm phán sẵn video để bật/tắt camera bằng replaceTrack, không tạo offer đồng thời.
        if (Number(currentUser.id) > Number(remoteId)) {
            const videoTrack = cameraStreamRef.current?.getVideoTracks()[0];
            const videoTransceiver = peer.addTransceiver(videoTrack || 'video', {
                direction: 'sendrecv',
                streams: localStream.current ? [localStream.current] : [],
            });
            videoSenders.current.set(key, videoTransceiver.sender);
        }
        peer.onicecandidate = event => {
            if (event.candidate) sendVoiceSignal({ from: currentUser.id, to: remoteId, type: 'candidate', candidate: event.candidate.toJSON() });
        };
        peer.ontrack = event => {
            if (stopped.current || !isMounted.current) return;
            const stream = event.streams?.[0] || remoteStreamRefs.current.get(key) || new MediaStream();
            if (event.track && !stream.getTracks().some(track => track.id === event.track.id)) stream.addTrack(event.track);
            remoteStreamRefs.current.set(key, stream);
            setRemoteStreams(previous => ({ ...previous, [key]: stream }));
            if (Platform.OS !== 'web' && event.track?.kind === 'video') {
                console.info('[Video] Nhan track:', { userId: key, trackId: event.track.id, streamURL: stream.toURL() });
            }
            if (event.track?.kind === 'audio') {
                event.track.enabled = isSpeakerOnRef.current;
                remoteAudioTracks.current.set(key, [...(remoteAudioTracks.current.get(key) || []), event.track]);
                if (Platform.OS === 'web') {
                    let audio = remoteAudioElements.current.get(key);
                    if (!audio) {
                        audio = document.createElement('audio');
                        audio.autoplay = true;
                        remoteAudioElements.current.set(key, audio);
                    }
                    audio.srcObject = stream;
                    audio.muted = !isSpeakerOnRef.current;
                    audio.play().catch(() => { if (isMounted.current) setAudioPlaybackBlocked(true); });
                }
            }
        };
        peer.onconnectionstatechange = () => {
            if (stopped.current || peers.current.get(key) !== peer) return;
            if (peer.connectionState === 'connected') sendMediaState();
            if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
                if (Number(currentUser.id) > Number(remoteId)) {
                    peers.current.delete(key);
                    removeRemoteMedia(key);
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
        if (stopped.current || !isMounted.current) return;
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
            if (!activeIds.has(id)) { peers.current.delete(id); peer.close(); removeRemoteMedia(id); }
        });
        roster.forEach(user => {
            if (Number(currentUser.id) > Number(user.id) && String(user.id) !== String(currentUser.id) && !peers.current.has(String(user.id))) makeOffer(user.id);
        });
    };

    const handleVoiceSignal = async (signal) => {
        if (stopped.current || !isMounted.current || String(signal.from) === String(currentUser.id)) return;
        if (signal.to != null && String(signal.to) !== String(currentUser.id)) return;
        if (signal.type === 'media-state') {
            setMemberMediaStates(previous => ({ ...previous, [String(signal.from)]: { cameraEnabled: signal.cameraEnabled === true, micMuted: signal.micMuted === true } }));
            return;
        }
        if (signal.to == null) return;
        if (signal.type === 'restart') {
            if (Number(currentUser.id) > Number(signal.from)) {
                peers.current.get(String(signal.from))?.close();
                peers.current.delete(String(signal.from));
                removeRemoteMedia(signal.from);
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
                    removeRemoteMedia(signal.from);
                }
            }
            const peer = createPeer(signal.from);
            if (signal.type === 'offer') {
                await peer.setRemoteDescription(new RTCSessionDescription(signal.description));
                // Bên nhận dùng transceiver của offer, tránh tạo video sender chưa được đàm phán.
                const videoTransceiver = peer.getTransceivers().find(transceiver => transceiver.receiver.track?.kind === 'video' && transceiver.mid != null);
                if (videoTransceiver) {
                    videoTransceiver.direction = 'sendrecv';
                    await videoTransceiver.sender.replaceTrack(cameraStreamRef.current?.getVideoTracks()[0] || null);
                    videoSenders.current.set(String(signal.from), videoTransceiver.sender);
                }
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
        remoteAudioElements.current.forEach(audio => { audio.pause(); audio.srcObject = null; });
        remoteAudioElements.current.clear();
        remoteStreamRefs.current.clear();
        videoSenders.current.clear();
        cameraStreamRef.current?.getTracks().forEach(track => { track.onended = null; track.stop(); });
        cameraStreamRef.current = null;
        setCameraStream(null);
        setIsCameraOff(true);
        setRemoteStreams({});
        setNativeVideoLayouts({});
        setMemberMediaStates({});
        remoteAudioTracks.current.clear();
        pendingIceCandidates.current.clear();
        localStream.current?.getTracks().forEach(track => track.stop());
        localStream.current = null;
        try { InCallManager?.stop(); } catch (_) { }
        setAudioModeAsync({ allowsRecording: false, shouldPlayInBackground: false, interruptionMode: 'mixWithOthers' }).catch(() => {});
    };

    const toggleMic = () => {
        const nextMuted = !isMicMuted;
        localStream.current?.getAudioTracks().forEach(track => { track.enabled = !nextMuted; });
        isMicMutedRef.current = nextMuted;
        setIsMicMuted(nextMuted);
        sendMediaState();
    };

    const toggleSpeaker = () => {
        const nextOn = !isSpeakerOn;
        isSpeakerOnRef.current = nextOn;
        setIsSpeakerOn(nextOn);
        remoteAudioTracks.current.forEach(tracks => tracks.forEach(track => { track.enabled = nextOn; }));
        remoteAudioElements.current.forEach(audio => { audio.muted = !nextOn; });
        if (nextOn) resumeRemoteAudio();
    };

    const stopCamera = async () => {
        const stream = cameraStreamRef.current;
        cameraStreamRef.current = null;
        stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
        if (isMounted.current) { setCameraStream(null); setIsCameraOff(true); }
        sendMediaState();
        await Promise.allSettled([...videoSenders.current.values()].map(async sender => sender.replaceTrack(null)));
    };

    const toggleCamera = async () => {
        if (isPreview || stopped.current || cameraChangingRef.current) return;
        cameraChangingRef.current = true;
        setIsCameraChanging(true);
        let stream = null;
        try {
            if (cameraStreamRef.current) {
                await stopCamera();
                return;
            }
            stream = await mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user' } });
            if (stopped.current || !isMounted.current) {
                stream.getTracks().forEach(track => track.stop());
                return;
            }
            const track = stream.getVideoTracks()[0];
            if (!track) throw new Error('Không tìm thấy camera.');
            cameraStreamRef.current = stream;
            track.onended = () => { if (cameraStreamRef.current === stream) stopCamera(); };
            if (Platform.OS !== 'web') console.info('[Video] Camera local:', { trackId: track.id, readyState: track.readyState, streamURL: stream.toURL() });
            const results = await Promise.allSettled([...videoSenders.current.values()].map(async sender => sender.replaceTrack(track)));
            if (stopped.current || !isMounted.current || cameraStreamRef.current !== stream) return;
            setCameraStream(stream);
            setIsCameraOff(false);
            setMediaError(results.some(result => result.status === 'rejected') ? 'Camera đã mở nhưng có kết nối chưa gửi được video. Hãy vào lại kênh nếu bên kia chưa thấy hình.' : '');
            sendMediaState();
        } catch (error) {
            console.warn('[Video] Khong mo duoc camera:', error.name, error.message);
            stream?.getTracks().forEach(track => track.stop());
            if (cameraStreamRef.current === stream) {
                cameraStreamRef.current = null;
                if (isMounted.current) { setCameraStream(null); setIsCameraOff(true); }
                sendMediaState();
            }
            if (isMounted.current) setMediaError('Không thể mở camera. Hãy kiểm tra camera và cho phép truy cập trong trình duyệt hoặc cài đặt ứng dụng.');
        } finally {
            cameraChangingRef.current = false;
            if (isMounted.current) setIsCameraChanging(false);
        }
    };

    useEffect(() => {
        if (isPreview) return undefined;
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
            let cleanUrl = url.startsWith('http') ? url : (BASE_URL_IMG + url);

            if (musicSoundUrl.current !== cleanUrl) {
                setCurrentMusic({ url: cleanUrl, title });
                setIsMusicPlaying(true);

                musicSound.current?.remove();

                if (!isMounted.current) return; // Kiểm tra lại trước khi load

                musicSound.current = createAudioPlayer({ uri: cleanUrl });
                musicSoundUrl.current = cleanUrl;
                musicSound.current.addListener('playbackStatusUpdate', onPlaybackStatusUpdate);
                // expo-audio dùng giây; tín hiệu đồng bộ từ backend dùng mili giây.
                await musicSound.current.seekTo(((position || 0) + 2000) / 1000);
                if (isMounted.current) musicSound.current?.play();
            }
        } catch (e) { console.log("❌ Sync failed:", e.message); }
    };

    const handleMusicCommand = async (data) => {
        try {
            const { action, url, title, position, sender } = data;

            if (action === 'REFRESH_LIST') return loadChannelMusic();

            if (action === 'REQUEST_SYNC' && isMusicPlaying && sender !== currentUser.username) {
                const status = musicSound.current?.currentStatus;
                if (status?.isLoaded) {
                    stompClient.current.send(`/app/music.sync/${channelId}`, {}, JSON.stringify({
                        url: currentMusic.url,
                        title: currentMusic.title,
                        position: Math.round(status.currentTime * 1000),
                        playing: true
                    }));
                }
                return;
            }

            if (action === 'PLAY') {
                if (!isMounted.current) return;
                setIsMusicPlaying(true);
                let cleanUrl = url.startsWith('http') ? url : (BASE_URL_IMG + url);

                if (musicSoundUrl.current !== cleanUrl) {
                    setCurrentMusic({ url: cleanUrl, title });
                    musicSound.current?.remove();

                    if (!isMounted.current) return;
                    musicSound.current = createAudioPlayer({ uri: cleanUrl });
                    musicSoundUrl.current = cleanUrl;
                    musicSound.current.addListener('playbackStatusUpdate', onPlaybackStatusUpdate);
                    await musicSound.current.seekTo((position || 0) / 1000);
                    if (isMounted.current) musicSound.current?.play();
                } else {
                    musicSound.current.play();
                }
            }
            else if (action === 'PAUSE') {
                const status = musicSound.current?.currentStatus;
                if (status?.isLoaded && status?.playing) {
                    musicSound.current.pause();
                }
                setIsMusicPlaying(false);
            }
        } catch (error) { console.log("❌ Command error:", error.message); }
    };

    const onPlaybackStatusUpdate = (ps) => {
        if (ps.didJustFinish && !ps.loop) {
            playNextSong();
        }
    };

    const sendMusicControl = async (action, url = null, title = null) => {
        if (!stompClient.current) return;
        let pos = 0;
        if (!url) {
            try {
                const status = musicSound.current?.currentStatus;
                if (status?.isLoaded) pos = Math.round(status.currentTime * 1000);
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

    const renderMember = ({ item, index }) => {
        const isSelf = String(item.id) === String(currentUser.id);
        const isSpeaking = !isPreview && speakingIds.includes(Number(item.id));
        const mediaState = memberMediaStates[String(item.id)];
        const muted = isSelf ? isPreview || !localStream.current || isMicMuted : mediaState?.micMuted ?? item.isMicMuted === true;
        const stream = isSelf ? cameraStream : remoteStreams[String(item.id)];
        const cameraEnabled = isSelf ? !isCameraOff : mediaState?.cameraEnabled;
        const videoTrack = stream?.getVideoTracks().find(track => track.readyState !== 'ended');
        const streamURL = Platform.OS !== 'web' && videoTrack ? stream.toURL() : null;
        const videoKey = `${item.id}:${streamURL}:${videoTrack?.id}`;
        const videoLayout = nativeVideoLayouts[String(item.id)];
        return (
            <View collapsable={false} style={[styles.participantTile, { backgroundColor: ['#78616e', '#39445e', '#51436a', '#385650'][index % 4] }, cameraEnabled && videoTrack && Platform.OS !== 'web' && styles.nativeVideoTile, isSpeaking && styles.speakingTile]}>
                {cameraEnabled && videoTrack ? Platform.OS === 'web' ? (
                    <video
                        autoPlay muted playsInline
                        aria-label={`Camera của ${item.username}`}
                        ref={element => {
                            if (element && element.srcObject !== stream) {
                                element.srcObject = stream;
                                element.play().catch(() => {});
                            }
                        }}
                        style={{ position: 'absolute', width: '100%', height: '100%', objectFit: 'cover', transform: isSelf ? 'scaleX(-1)' : undefined }}
                    />
                ) : <View
                    collapsable={false}
                    style={StyleSheet.absoluteFillObject}
                    onLayout={event => {
                        const videoWidth = Math.round(event.nativeEvent.layout.width);
                        const videoHeight = Math.round(event.nativeEvent.layout.height);
                        if (videoWidth <= 0 || videoHeight <= 0) return;
                        setNativeVideoLayouts(previous => {
                            const layout = previous[String(item.id)];
                            if (layout?.width === videoWidth && layout?.height === videoHeight) return previous;
                            return { ...previous, [String(item.id)]: { width: videoWidth, height: videoHeight } };
                        });
                    }}
                >
                    {videoLayout && <RTCView
                        key={videoKey}
                        collapsable={false}
                        streamURL={streamURL}
                        style={{ width: videoLayout.width, height: videoLayout.height }}
                        objectFit="cover"
                        mirror={isSelf}
                        zOrder={1}
                        onDimensionsChange={event => {
                            const { width: frameWidth, height: frameHeight } = event.nativeEvent;
                            if (frameWidth > 0 && frameHeight > 0) console.info('[Video] Khung hinh native:', { userId: item.id, streamURL, width: frameWidth, height: frameHeight });
                        }}
                    />}
                </View> : <View style={[styles.avatarRing, isSpeaking && styles.speakingRing]}>
                    <Avatar uri={item.avatarUrl} name={item.username} size={width >= 700 ? 96 : 76} />
                </View>}
                <View style={styles.participantLabel}>
                    {muted && <Ionicons name="mic-off" size={15} color="#fff" />}
                    <Text style={styles.participantName} numberOfLines={1}>{item.username}{isSelf ? ' (Bạn)' : ''}</Text>
                </View>
                {isSpeaking && <View style={styles.speakingBadge}><Text style={styles.speakingText}>Đang nói</Text></View>}
            </View>
        );
    };
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
        <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
            <View style={styles.callHeader}>
                <TouchableOpacity style={styles.headerBack} onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Quay lại">
                    <Ionicons name="chevron-back" size={25} color="#dcddde" />
                </TouchableOpacity>
                <Ionicons name="volume-high" size={22} color="#949ba4" />
                <View style={styles.channelHeading}>
                    <Text style={styles.channelTitle} numberOfLines={1}>{channelName}</Text>
                    <Text style={styles.channelSubtitle}>Kênh thoại</Text>
                </View>
                <View style={styles.memberCount}>
                    <Ionicons name="people" size={17} color="#b5bac1" />
                    <Text style={styles.memberCountText}>{isPreview ? 'Xem trước' : members.length}</Text>
                </View>
            </View>

            {isPreview && <View style={styles.previewBanner}>
                <Ionicons name="information-circle-outline" size={20} color="#c2c7ff" />
                <View style={styles.previewCopy}>
                    <Text style={styles.previewTitle}>Xem trước giao diện · Chưa kết nối âm thanh</Text>
                    <Text style={styles.previewDescription}>{isExpoGo ? 'Gọi thoại thật cần bản development build có WebRTC.' : 'Hãy mở bằng localhost hoặc HTTPS trên trình duyệt hỗ trợ WebRTC để dùng mic và camera.'}</Text>
                </View>
            </View>}
            {!!mediaError && <View style={styles.previewBanner}><Text style={styles.previewTitle}>{mediaError}</Text></View>}

            <FlatList
                key={width >= 1000 ? 'two-columns' : 'one-column'}
                style={styles.callStage}
                contentContainerStyle={[styles.stageContent, (isPreview || members.length <= 1) && { maxWidth: 760 }]}
                data={isPreview ? [currentUser] : members}
                numColumns={width >= 1000 ? 2 : 1}
                renderItem={renderMember}
                extraData={{ cameraStream, isCameraOff, remoteStreams, memberMediaStates, nativeVideoLayouts }}
                removeClippedSubviews={false}
                keyExtractor={item => String(item.id)}
                ListEmptyComponent={<View style={styles.emptyCall}><Ionicons name="people-outline" size={48} color="#949ba4" /><Text style={styles.emptyCallText}>Đang chờ danh sách người tham gia...</Text></View>}
                ListFooterComponent={
                    <TouchableOpacity style={[styles.activityCard, isPreview && styles.disabledControl]} disabled={isPreview || connectionStatus !== 'CONNECTED'} onPress={() => setMusicPanelVisible(true)} accessibilityRole="button" accessibilityLabel="Mở nhạc trong kênh">
                        <View style={styles.activityIcon}><Ionicons name="musical-notes" size={44} color="#b6a7ff" /></View>
                        <Text style={styles.activityEyebrow}>CÙNG NHAU TRONG KÊNH</Text>
                        <Text style={styles.activityTitle}>Nghe nhạc cùng nhau</Text>
                        <Text style={styles.activityDescription}>{isPreview ? 'Khả dụng khi kết nối kênh bằng development build' : currentMusic.title || 'Mở danh sách và chọn bài hát của bạn'}</Text>
                    </TouchableOpacity>
                }
            />

            <View style={styles.callFooter}>
                {audioPlaybackBlocked && <TouchableOpacity style={styles.enableAudioButton} onPress={resumeRemoteAudio} accessibilityRole="button" accessibilityLabel="Cho phép phát âm thanh cuộc gọi"><Text style={styles.previewTitle}>Bấm để nghe âm thanh cuộc gọi</Text></TouchableOpacity>}
                <View style={styles.connectionRow}>
                    <View style={[styles.connectionDot, connectionStatus === 'CONNECTED' && styles.connectedDot]} />
                    <Text style={styles.connectionLabel}>{isPreview ? 'Chế độ xem trước' : connectionStatus === 'CONNECTED' ? 'Đã kết nối kênh' : connectionStatus === 'RECONNECTING' ? 'Đang kết nối lại...' : 'Đang kết nối...'}</Text>
                </View>
                <View style={styles.callToolbar}>
                    <TouchableOpacity style={[styles.callButton, isMicMuted && styles.mutedButton, isPreview && styles.disabledControl]} disabled={isPreview || !localStream.current} onPress={toggleMic} accessibilityRole="button" accessibilityLabel={isMicMuted ? 'Bật micro' : 'Tắt micro'}>
                        <Ionicons name={isMicMuted || isPreview ? 'mic-off' : 'mic'} size={23} color={isMicMuted ? '#ff727b' : '#f2f3f5'} />
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.callButton, !isCameraOff && styles.cameraActiveButton, (isPreview || isCameraChanging) && styles.disabledControl]} disabled={isPreview || isCameraChanging} onPress={toggleCamera} accessibilityRole="button" accessibilityLabel={isCameraOff ? 'Bật camera' : 'Tắt camera'}>
                        <Ionicons name={isCameraOff ? 'videocam-off' : 'videocam'} size={23} color="#f2f3f5" />
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.callButton, styles.disabledControl]} disabled accessibilityRole="button" accessibilityLabel="Chia sẻ màn hình chưa hỗ trợ trong kênh thoại">
                        <Ionicons name="desktop-outline" size={23} color="#949ba4" />
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.callButton, !isSpeakerOn && styles.mutedButton, isPreview && styles.disabledControl]} disabled={isPreview} onPress={toggleSpeaker} accessibilityRole="button" accessibilityLabel={isSpeakerOn ? 'Tắt âm thanh' : 'Bật âm thanh'}>
                        <Ionicons name={isSpeakerOn ? 'headset' : 'volume-mute'} size={23} color="#f2f3f5" />
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.callButton, styles.leaveButton]} onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Rời kênh thoại">
                        <Ionicons name="call" size={24} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
                    </TouchableOpacity>
                </View>
                <Text style={styles.toolbarHint}>Chia sẻ màn hình chưa hỗ trợ trong kênh này.</Text>
            </View>

            <Modal visible={musicPanelVisible} animationType="slide" onRequestClose={() => setMusicPanelVisible(false)}>
                <SafeAreaView style={styles.musicPanel}>
                    <View style={styles.musicPanelHeader}>
                        <Text style={styles.channelTitle}>Nhạc trong kênh</Text>
                        <TouchableOpacity style={styles.headerBack} onPress={() => setMusicPanelVisible(false)} accessibilityRole="button" accessibilityLabel="Đóng nhạc trong kênh"><Ionicons name="close" size={25} color="#fff" /></TouchableOpacity>
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
                    <Text style={styles.playlistTitle}>{isUploading ? 'Đang tải nhạc...' : `Danh sách bài hát (${playlist.length})`}</Text>
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

                </SafeAreaView>
            </Modal>

            <Modal visible={linkModalVisible} transparent animationType="fade" onRequestClose={() => setLinkModalVisible(false)}>
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
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0b0c0f' },
    callHeader: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#25262b', gap: 10 },
    headerBack: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    channelHeading: { flex: 1 },
    channelTitle: { color: '#f2f3f5', fontSize: 17, fontWeight: '700' },
    channelSubtitle: { color: '#949ba4', fontSize: 12, marginTop: 3 },
    memberCount: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#202127', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8 },
    memberCountText: { color: '#b5bac1', fontSize: 12 },
    previewBanner: { flexDirection: 'row', gap: 10, padding: 12, margin: 12, borderRadius: 10, backgroundColor: '#24243b' },
    previewCopy: { flex: 1 },
    previewTitle: { color: '#e1e3ff', fontSize: 12, fontWeight: '600' },
    previewDescription: { color: '#a5a8c6', fontSize: 11, lineHeight: 17, marginTop: 3 },
    callStage: { flex: 1 },
    stageContent: { flexGrow: 1, justifyContent: 'center', padding: 12, width: '100%', maxWidth: 1100, alignSelf: 'center' },
    participantTile: { flex: 1, aspectRatio: 16 / 9, minHeight: 150, margin: 6, borderRadius: 12, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    nativeVideoTile: { backgroundColor: '#000', overflow: 'visible' },
    speakingTile: { borderColor: '#3ba55d' },
    avatarRing: { padding: 4, borderRadius: 60, borderWidth: 3, borderColor: 'transparent' },
    speakingRing: { borderColor: '#3ba55d' },
    participantLabel: { position: 'absolute', bottom: 10, left: 10, maxWidth: '85%', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 7, paddingHorizontal: 10, paddingVertical: 7 },
    participantName: { flexShrink: 1, color: '#fff', fontSize: 13, fontWeight: '500' },
    speakingBadge: { position: 'absolute', top: 10, right: 10, backgroundColor: '#1d4932', borderRadius: 6, padding: 6 },
    speakingText: { color: '#86e5aa', fontSize: 11 },
    emptyCall: { padding: 36, alignItems: 'center', gap: 12 },
    emptyCallText: { color: '#949ba4', fontSize: 13 },
    activityCard: { alignItems: 'center', backgroundColor: '#20122d', borderRadius: 12, margin: 6, padding: 24, borderWidth: 1, borderColor: '#392443' },
    activityIcon: { backgroundColor: '#35214c', borderRadius: 24, padding: 18, marginBottom: 16 },
    activityEyebrow: { color: '#a799bd', fontSize: 10, fontWeight: '700', letterSpacing: 1.2 },
    activityTitle: { color: '#f3ecff', fontSize: 20, fontWeight: '700', marginTop: 7 },
    activityDescription: { color: '#b4a7c5', fontSize: 12, lineHeight: 18, marginTop: 8, textAlign: 'center' },
    callFooter: { alignItems: 'center', paddingHorizontal: 12, paddingTop: 12, paddingBottom: 10, borderTopWidth: 1, borderTopColor: '#202127' },
    connectionRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 12 },
    connectionDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#949ba4' },
    connectedDot: { backgroundColor: '#3ba55d' },
    connectionLabel: { color: '#b5bac1', fontSize: 12 },
    callToolbar: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
    callButton: { width: 48, height: 48, borderRadius: 14, backgroundColor: '#25262c', alignItems: 'center', justifyContent: 'center' },
    mutedButton: { backgroundColor: '#44212a' },
    cameraActiveButton: { backgroundColor: '#5865F2' },
    enableAudioButton: { backgroundColor: '#5865F2', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 12, marginBottom: 10 },
    disabledControl: { opacity: 0.55 },
    leaveButton: { width: 58, backgroundColor: '#ed4245' },
    toolbarHint: { color: '#949ba4', fontSize: 10, lineHeight: 15, textAlign: 'center', marginTop: 10 },
    musicPanel: { flex: 1, backgroundColor: '#202225' },
    musicPanelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8 },
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
