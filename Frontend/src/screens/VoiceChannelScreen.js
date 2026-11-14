import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { isRunningInExpoGo } from 'expo';
import * as DocumentPicker from 'expo-document-picker';
import { useEffect, useRef, useState } from 'react';
import SockJS from 'sockjs-client';
import { Stomp } from 'stompjs/lib/stomp';
import {
    Alert, AppState, DeviceEventEmitter, FlatList, PermissionsAndroid,
    NativeModules, findNodeHandle,
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
    RTCRtpReceiver: globalThis.RTCRtpReceiver,
    MediaStream: globalThis.MediaStream,
} : isExpoGo ? {} : require('react-native-webrtc');
const { mediaDevices, RTCPeerConnection, RTCIceCandidate, RTCSessionDescription, RTCRtpReceiver, MediaStream, RTCView, ScreenCapturePickerView } = webrtc;
const InCallManager = Platform.OS === 'web' || isExpoGo ? null : require('react-native-incall-manager').default;

// Native stream được đăng ký bất đồng bộ; chỉ gắn renderer sau khi có kích thước.
function NativeChannelVideo({ streamURL, mirror = false, objectFit = 'cover', debugId, onLayout, onDimensionsChange }) {
    const [readyURL, setReadyURL] = useState(null);
    const [bounds, setBounds] = useState({ width: 0, height: 0 });
    const [renderAttempt, setRenderAttempt] = useState(0);
    const receivedFrame = useRef(false);

    useEffect(() => {
        receivedFrame.current = false;
        setReadyURL(null);
        setRenderAttempt(0);
        if (!streamURL) return undefined;
        const timer = setTimeout(() => setReadyURL(streamURL), 250);
        return () => clearTimeout(timer);
    }, [streamURL]);

    useEffect(() => {
        if (!readyURL || readyURL !== streamURL || bounds.width <= 0 || bounds.height <= 0) return undefined;
        const timer = setTimeout(() => {
            if (receivedFrame.current) return;
            if (renderAttempt === 0) {
                console.info('[Camera native] Khởi tạo lại renderer chưa có frame:', { debugId, streamURL });
                setRenderAttempt(1);
            } else {
                console.warn('[Camera native] Chưa có frame sau khi gắn lại:', { debugId, streamURL, width: bounds.width, height: bounds.height });
            }
        }, 1800);
        return () => clearTimeout(timer);
    }, [readyURL, streamURL, bounds.width, bounds.height, renderAttempt, debugId]);

    return <View collapsable={false} pointerEvents="none" style={StyleSheet.absoluteFill}
        onLayout={event => {
            const { width, height } = event.nativeEvent.layout;
            const nextWidth = Math.round(width);
            const nextHeight = Math.round(height);
            setBounds(previous => previous.width === nextWidth && previous.height === nextHeight
                ? previous : { width: nextWidth, height: nextHeight });
            onLayout?.(event);
        }}>
        {readyURL === streamURL && readyURL && bounds.width > 0 && bounds.height > 0 && <RTCView
            key={readyURL + ':' + renderAttempt}
            collapsable={false}
            streamURL={readyURL}
            style={{ width: bounds.width, height: bounds.height }}
            objectFit={objectFit}
            mirror={mirror}
            zOrder={0}
            onDimensionsChange={event => {
                if (event.nativeEvent.width > 0 && event.nativeEvent.height > 0) receivedFrame.current = true;
                onDimensionsChange?.(event);
            }}
        />}
    </View>;
}

export default function VoiceChannelScreen({ route, navigation, onLeave }) {
    const { channelId, channelName, currentUser } = route.params;
    const { width } = useWindowDimensions();
    const [musicPanelVisible, setMusicPanelVisible] = useState(false);
    const [voiceStageLayout, setVoiceStageLayout] = useState({ width: 0, height: 0 });
    const [members, setMembers] = useState([]);
    // Một người dùng một ô; nhiều người dùng hai cột.
    const participantColumns = isPreview || members.length <= 1 ? 1 : 2;
    const participantTileWidth = Math.max(0, (Math.min(voiceStageLayout.width || width, 1100) - 24) / participantColumns - 12);
    const participantTileHeight = participantColumns === 1
        ? Math.max(96, Math.min(440, (voiceStageLayout.height || 440) - 36))
        : Math.max(96, Math.min(320, ((voiceStageLayout.height || 440) - 48) / 2));

    const [playlist, setPlaylist] = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    const [isMusicPlaying, setIsMusicPlaying] = useState(false);

    const [linkModalVisible, setLinkModalVisible] = useState(false);
    const [musicLink, setMusicLink] = useState('');
    const [musicTitle, setMusicTitle] = useState('');
    const [editingMusic, setEditingMusic] = useState(null);
    const [musicPosition, setMusicPosition] = useState(0);
    const [musicDuration, setMusicDuration] = useState(0);
    const [musicLoop, setMusicLoop] = useState(false);
    const [musicError, setMusicError] = useState('');
    const [musicLoading, setMusicLoading] = useState(false);
    const [musicSeekDraft, setMusicSeekDraft] = useState(null);
    const musicSeekBar = useRef({ width: 0, startX: 0, startPosition: 0, draft: 0, dragging: false });
    const musicPendingSeek = useRef(null);
    const musicSeeking = useRef(false);
    const musicSourceRef = useRef(null);
    const musicPlaybackIntent = useRef(false);
    const musicLoopRef = useRef(false);
    const musicMembersRef = useRef([]);
    const musicFinishHandled = useRef(false);

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
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const [isScreenShareChanging, setIsScreenShareChanging] = useState(false);
    const [screenShareOwner, setScreenShareOwner] = useState(null);
    const screenShareStreamRef = useRef(null);
    const screenShareSenders = useRef(new Map());
    const screenAudioSenders = useRef(new Map());
    const voiceAudioSenders = useRef(new Map());
    const webScreenAudio = useRef(null);
    const [floatingControlsAllowed, setFloatingControlsAllowed] = useState(null);
    const screenAudioChannels = useRef(new Map());
    const screenAudioSequences = useRef(new Map());
    const screenAudioContext = useRef(null);
    const screenAudioSources = useRef(new Set());
    const screenAudioTimeline = useRef({ sessionId: null, time: 0 });
    const screenShareOwnerRef = useRef(null);
    const screenShareChangingRef = useRef(false);
    const screenShareAttemptRef = useRef(0);
    const screenShareClaimRef = useRef(null);
    const screenCapturePickerRef = useRef(null);
    const iosBroadcastWait = useRef(null);
    const [isIOSBroadcastWaiting, setIsIOSBroadcastWaiting] = useState(false);
    const makingOffers = useRef(new Set());
    const pendingOffers = useRef(new Set());
    const [screenShareStream, setScreenShareStream] = useState(null);
    const [screenShareExpanded, setScreenShareExpanded] = useState(false);
    const remoteVideoEvents = useRef(new Map());
    const screenShareSlots = useRef(new Map());
    const remoteScreenStreams = useRef(new Map());
    const remoteScreenMetadata = useRef(new Map());
    const offerTasks = useRef(new Map());
    const offerVersions = useRef(new Map());
    const handlingDescriptions = useRef(new Set());
    const ignoredOffers = useRef(new Set());
    const voiceSignalQueues = useRef(new Map());
    const voiceSessionVersion = useRef(0);
    const voiceMountVersion = useRef(0);
    const voiceAudioReady = useRef(Promise.resolve());
    const screenShareRevision = useRef(0);
    const retiredScreenSessions = useRef(new Set());
    const screenDiagnosticsTimers = useRef(new Map());

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
    // Hộp thoại hệ thống hoặc chuyển app không phải là rời kênh.
    useEffect(() => {
        const mountVersion = ++voiceMountVersion.current;
        isMounted.current = true;
        stopped.current = false;
        if (isPreview) {
            setConnectionStatus('PREVIEW');
            return () => { isMounted.current = false; stopped.current = true; };
        }
        const voiceSession = { channelId: String(channelId), userId: String(currentUser.id), serverId: route.params.serverId, params: route.params, leave: () => leaveChannel() };
        global.activeVoiceSession = voiceSession;
        global.inVoiceChannel = true;
        console.log("Đã vào kênh thoại:", channelName);
        // InCallManager quản lý audio focus của cuộc gọi; nhạc trộn cùng cuộc gọi.
        voiceAudioReady.current = setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: Platform.OS === 'android' ? 'mixWithOthers' : 'duckOthers' }).catch(error => {
            console.warn('[Nhạc] Cấu hình âm thanh:', error.message);
        });
        loadChannelMusic();
        startVoiceSession(mountVersion);

        return () => {
            console.log("Thoát màn hình - Đang dọn dẹp âm thanh...");
            voiceMountVersion.current += 1;
            isMounted.current = false; // Chặn mọi hành động load nhạc ngay lập tức
            if (global.activeVoiceSession === voiceSession) {
                global.activeVoiceSession = null;
                global.inVoiceChannel = false;
            }
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
    }, [channelId, currentUser.id]);

    useEffect(() => {
        setScreenShareExpanded(false);
    }, [screenShareOwner?.sessionId]);

    useEffect(() => {
        if (Platform.OS !== 'android' || isPreview) return undefined;
        const onStop = event => {
            if (event?.sessionId === screenShareOwnerRef.current?.sessionId && screenShareStreamRef.current) {
                stopScreenShare().catch(error => console.warn('[Chia sẻ] Dừng từ thông báo:', error.message));
            }
        };
        const subscription = DeviceEventEmitter.addListener('NagomiScreenShareStopped', onStop);
        const audio = DeviceEventEmitter.addListener('NagomiScreenAudio', packet => {
            if (packet.sessionId !== screenShareOwnerRef.current?.sessionId || !screenShareStreamRef.current || stopped.current) return;
            const data = JSON.stringify(packet);
            screenAudioChannels.current.forEach(channel => {
                if (channel.readyState === 'open' && channel.bufferedAmount < 32768) {
                    try { channel.send(data); } catch (_) { }
                }
            });
        });
        const audioError = DeviceEventEmitter.addListener('NagomiScreenAudioError', event => {
            if (isMounted.current && event.sessionId === screenShareOwnerRef.current?.sessionId) setMediaError(event.message);
        });
        const refreshFloatingControls = async (show = false) => {
            const controls = NativeModules.NagomiScreenShareControls;
            if (!controls?.hasOverlayPermission) return;
            const allowed = await controls.hasOverlayPermission();
            if (!isMounted.current) return;
            setFloatingControlsAllowed(allowed);
            const track = screenShareStreamRef.current?.getVideoTracks().find(item => item.readyState !== 'ended');
            if (show && allowed && track && String(screenShareOwnerRef.current?.id) === String(currentUser.id)) {
                await controls.show(track.id, screenShareOwnerRef.current.sessionId);
            }
        };
        refreshFloatingControls().catch(() => {});
        const appState = AppState.addEventListener('change', state => {
            if (state !== 'active') return;
            (async () => {
                const sessionId = await NativeModules.NagomiScreenShareControls?.getStoppedSession();
                onStop({ sessionId });
                await refreshFloatingControls(true);
            })().catch(() => {});
        });
        return () => { subscription.remove(); audio.remove(); audioError.remove(); appState.remove(); };
    }, [channelId, currentUser.id]);

    // --- 2. CẤU HÌNH HỆ THỐNG VÀ SOCKET ---
    useEffect(() => {
        navigation.setOptions({ title: `Kênh: ${channelName}`, headerShown: false });
    }, [navigation, channelName]);

    const startVoiceSession = async (mountVersion) => {
        try {
            const stream = await mediaDevices.getUserMedia({ audio: true, video: false });
            if (stopped.current || mountVersion !== voiceMountVersion.current) {
                stream.getTracks().forEach(track => track.stop());
                stream.release?.();
                return;
            }
            localStream.current = stream;
            localStream.current.getAudioTracks().forEach(track => { track.enabled = !isMicMutedRef.current; });
            InCallManager?.start({ media: 'audio' });
            InCallManager?.setForceSpeakerphoneOn(true);
            if (isMounted.current) setMediaError('');
        } catch (error) {
            if (mountVersion !== voiceMountVersion.current || stopped.current) return;
            if (isMounted.current) setMediaError('Chưa mở được micro. Hãy cấp quyền micro rồi vào lại kênh; bạn vẫn có thể nghe người khác.');
        }
        if (isMounted.current && mountVersion === voiceMountVersion.current) connectVoiceSocket();
    };

    const connectVoiceSocket = () => {
        if (stopped.current) return;
        const socket = new SockJS(SOCKET_URL);
        const client = Stomp.over(socket);
        stompClient.current = client;
        client.debug = null;
        client.connect({}, () => {
            if (stopped.current || stompClient.current !== client) { client.disconnect(); return; }
            retryCount.current = 0;
            voiceSessionVersion.current += 1;
            screenShareRevision.current = 0;
            setConnectionStatus('CONNECTED');
            client.subscribe(`/topic/voice.members.${channelId}`, message => {
                const roster = JSON.parse(message.body);
                musicMembersRef.current = roster;
                setMembers(roster);
                syncPeers(roster);
                sendMediaState();
            });
            client.subscribe(`/topic/voice.signal.${channelId}`, message => {
                if (!stopped.current && stompClient.current === client) handleVoiceSignal(JSON.parse(message.body));
            });
            client.subscribe(`/topic/music.${channelId}`, message => handleMusicCommand(JSON.parse(message.body)));
            client.subscribe(`/topic/music.sync.${channelId}`, message => handleMusicSync(JSON.parse(message.body)));
            client.send(`/app/voice.join/${channelId}`, {}, JSON.stringify(currentUser));
            UserService.updateStatus(currentUser.id, 'ONLINE').catch(error => console.warn('[Voice] Không cập nhật được Online:', error.message));
            sendVoiceSignal({ from: currentUser.id, to: 'all', type: 'screen-share-query' });
            setTimeout(() => {
                if (isMounted.current && client.connected) client.send(`/app/music.control/${channelId}`, {}, JSON.stringify({ action: 'REQUEST_SYNC', sender: currentUser.username }));
            }, 1200);
        }, error => {
            if (stopped.current || stompClient.current !== client) return;
            console.warn('[Chia sẻ] Mất kết nối kênh:', error?.command || error?.type || 'socket đóng');
            // Khi mất signaling, nhả màn hình ngay để không giữ capture và khóa cũ.
            stopScreenShare(false);
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

    const queueScreenDiagnostics = (remoteId, peer) => {
        const key = String(remoteId);
        clearTimeout(screenDiagnosticsTimers.current.get(key));
        screenDiagnosticsTimers.current.set(key, setTimeout(async () => {
            screenDiagnosticsTimers.current.delete(key);
            if (stopped.current || peers.current.get(key) !== peer || !screenShareOwnerRef.current) return;
            try {
                const stats = await peer.getStats();
                const video = [];
                const audio = [];
                stats.forEach(report => {
                    if (['inbound-rtp', 'outbound-rtp'].includes(report.type) && (report.kind === 'audio' || report.mediaType === 'audio')) {
                        audio.push({ type: report.type, mid: report.mid, bytesSent: report.bytesSent, bytesReceived: report.bytesReceived, totalAudioEnergy: report.totalAudioEnergy, audioLevel: report.audioLevel });
                    }
                    if (['inbound-rtp', 'outbound-rtp'].includes(report.type) && (report.kind === 'video' || report.mediaType === 'video')) {
                        video.push({ type: report.type, mid: report.mid, bytesSent: report.bytesSent, bytesReceived: report.bytesReceived,
                            framesEncoded: report.framesEncoded, framesDecoded: report.framesDecoded });
                    }
                });
                console.info('[Chia sẻ] RTP sau thương lượng:', { peerId: key, connectionState: peer.connectionState, video, audio });
            } catch (error) { console.warn('[Chia sẻ] Không đọc được thống kê:', error.message); }
        }, 3000));
    };

    const restoreRemoteScreen = (remoteId, peer) => {
        const key = String(remoteId);
        const info = remoteScreenMetadata.current.get(key);
        const entry = remoteScreenStreams.current.get(key);
        if (info?.mid == null || screenShareOwnerRef.current?.sessionId !== info.sessionId || entry?.sessionId === info.sessionId) return;
        const transceiver = peer?.getTransceivers().find(item => String(item.mid) === String(info.mid));
        const track = transceiver?.receiver.track;
        if (track?.kind === 'video' && track.readyState !== 'ended' && peer.remoteDescription
            && ['recvonly', 'sendrecv'].includes(transceiver.currentDirection)) {
            const event = remoteVideoEvents.current.get(key)?.get(String(info.mid));
            peer.ontrack(event?.track === track ? event : { track, transceiver, streams: [] });
        }
    };

    const enableFloatingControls = async () => {
        try { await NativeModules.NagomiScreenShareControls?.requestOverlayPermission(); }
        catch (error) { setMediaError('Không mở được quyền thanh nổi. Bạn vẫn có thể dừng chia sẻ trong thông báo Nagomi.'); }
    };

    const startWebScreenAudio = (stream, context, sessionId) => {
        const screenTracks = stream.getAudioTracks().filter(track => track.readyState !== 'ended');
        if (!screenTracks.length || !context) return null;
        const destination = context.createMediaStreamDestination();
        destination.channelCount = 1;
        const screenSource = context.createMediaStreamSource(new MediaStream(screenTracks));
        screenSource.connect(destination);
        let microphoneSource = null, microphoneGain = null;
        const microphoneTracks = localStream.current?.getAudioTracks().filter(track => track.readyState !== 'ended') || [];
        if (microphoneTracks.length) {
            microphoneSource = context.createMediaStreamSource(new MediaStream(microphoneTracks));
            microphoneGain = context.createGain();
            microphoneGain.gain.value = isMicMutedRef.current ? 0 : 1;
            microphoneSource.connect(microphoneGain); microphoneGain.connect(destination);
        }
        const mixed = { context, destination, screenSource, microphoneSource, microphoneGain,
            track: destination.stream.getAudioTracks()[0], sessionId };
        webScreenAudio.current = mixed;
        console.info('[Chia sẻ âm thanh] Nguồn:', { sourceTracks: screenTracks.length,
            sourceEnabled: screenTracks[0].enabled, sourceMuted: screenTracks[0].muted, contextState: context.state,
            mixedTrackId: mixed.track?.id, channels: mixed.track?.getSettings?.().channelCount });
        if (context.state !== 'running') setAudioPlaybackBlocked(true);
        return mixed;
    };

    const stopWebScreenAudio = async () => {
        const mixed = webScreenAudio.current;
        if (!mixed) return;
        webScreenAudio.current = null;
        mixed.screenSource.disconnect(); mixed.microphoneSource?.disconnect(); mixed.microphoneGain?.disconnect();
        const microphone = localStream.current?.getAudioTracks().find(track => track.readyState !== 'ended') || null;
        await Promise.allSettled([...voiceAudioSenders.current.values()].map(sender => sender.replaceTrack(microphone)));
        mixed.destination.stream.getTracks().forEach(track => track.stop());
        await mixed.context.close().catch(() => {});
    };

    const stopReceivedScreenAudio = () => {
        screenAudioSequences.current.clear();
        NativeModules.NagomiPlaybackAudio?.stopPlayback(null);
        screenAudioSources.current.forEach(source => { try { source.stop(); } catch (_) { } });
        screenAudioSources.current.clear();
        screenAudioContext.current?.close().catch(() => {});
        screenAudioContext.current = null;
        screenAudioTimeline.current = { sessionId: null, time: 0 };
    };

    const bindScreenAudio = (key, channel) => {
        if (channel.label !== 'nagomi-screen-audio') return;
        screenAudioChannels.current.set(key, channel);
        channel.onclose = () => { if (screenAudioChannels.current.get(key) === channel) screenAudioChannels.current.delete(key); };
        channel.onmessage = event => {
            if (stopped.current || !isSpeakerOnRef.current || typeof event.data !== 'string' || event.data.length > 4096) return;
            try {
                const packet = JSON.parse(event.data);
                const owner = screenShareOwnerRef.current;
                if (String(owner?.id) !== key || packet.sessionId !== owner.sessionId || typeof packet.data !== 'string' || packet.data.length !== 2560
                    || !Number.isInteger(packet.sequence) || packet.sequence <= (screenAudioSequences.current.get(key) ?? -1)) return;
                screenAudioSequences.current.set(key, packet.sequence);
                if (Platform.OS === 'android') NativeModules.NagomiPlaybackAudio?.playChunk(packet.sessionId, packet.data);
                else if (Platform.OS === 'web') {
                    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
                    if (!AudioContext) return;
                    const context = screenAudioContext.current || (screenAudioContext.current = new AudioContext());
                    if (context.state !== 'running') { setAudioPlaybackBlocked(true); return; }
                    const bytes = Uint8Array.from(atob(packet.data), value => value.charCodeAt(0));
                    const samples = new DataView(bytes.buffer);
                    const buffer = context.createBuffer(1, bytes.length / 2, 48000);
                    const output = buffer.getChannelData(0);
                    for (let i = 0; i < output.length; i++) output[i] = samples.getInt16(i * 2, true) / 32768;
                    const clock = screenAudioTimeline.current;
                    if (clock.sessionId !== packet.sessionId || clock.time < context.currentTime) { clock.sessionId = packet.sessionId; clock.time = context.currentTime + 0.04; }
                    if (clock.time - context.currentTime > 0.16) return;
                    const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
                    screenAudioSources.current.add(source); source.onended = () => screenAudioSources.current.delete(source);
                    source.start(clock.time); clock.time += buffer.duration;
                }
            } catch (_) { }
        };
    };

    const clearRemoteScreen = (remoteId) => {
        const key = String(remoteId);
        const entry = remoteScreenStreams.current.get(key);
        if (String(screenShareOwnerRef.current?.id) === key) stopReceivedScreenAudio();
        if (entry) {
            entry.track.removeEventListener?.('ended', entry.ended);
            entry.track.removeEventListener?.('mute', entry.muted);
            entry.track.removeEventListener?.('unmute', entry.unmuted);
            if (entry.ownsStream) entry.stream.release?.(false);
        }
        remoteScreenStreams.current.delete(key);
        if (String(screenShareOwnerRef.current?.id) === key && isMounted.current) setScreenShareStream(null);
    };

    const rememberScreenShare = (remoteId, info, authoritative = false) => {
        if (!info?.sessionId || String(info.id) !== String(remoteId) || retiredScreenSessions.current.has(info.sessionId)) return;
        const key = String(remoteId);
        const owner = screenShareOwnerRef.current;
        if (!authoritative && owner && (String(owner.id) !== key || owner.sessionId !== info.sessionId)) return;
        const previous = remoteScreenMetadata.current.get(key);
        const next = { ...info, id: key };
        if (previous?.sessionId === info.sessionId) {
            if (info.mid == null) next.mid = previous.mid;
            // Không để bản pending đến muộn che phiên đã có SDP gửi màn hình.
            if (previous.pending === false && info.pending === true) next.pending = false;
        }
        remoteScreenMetadata.current.set(key, next);
        // Offer/answer mang phiên đã được backend cấp phép; dùng làm dự phòng nếu broadcast tới chậm.
        if (authoritative || !owner || (String(owner.id) === key && owner.sessionId === next.sessionId)) {
            if (owner?.sessionId && owner.sessionId !== next.sessionId) clearRemoteScreen(key);
            screenShareOwnerRef.current = next;
            setScreenShareOwner(next);
            const entry = remoteScreenStreams.current.get(key);
            if (entry?.sessionId === next.sessionId) setScreenShareStream(entry.stream);
            else restoreRemoteScreen(key, peers.current.get(key));
        }
    };

    const preferScreenCodec = transceiver => {
        try {
            const codecs = RTCRtpReceiver?.getCapabilities?.('video')?.codecs;
            if (!transceiver?.setCodecPreferences || !codecs?.some(codec => codec.mimeType?.toLowerCase() === 'video/vp8')) return;
            // VP8 tương thích với Chrome và WebRTC Android; vẫn giữ codec dự phòng.
            transceiver.setCodecPreferences([
                ...codecs.filter(codec => codec.mimeType?.toLowerCase() === 'video/vp8'),
                ...codecs.filter(codec => codec.mimeType?.toLowerCase() !== 'video/vp8'),
            ]);
        } catch (error) { console.warn('[Chia sẻ] Không đặt được codec ưu tiên:', error.message); }
    };

    const sameSender = (left, right) => {
        if (!left || !right) return false;
        // Trình duyệt dùng tham chiếu; native còn có ID để nhận diện sender.
        return left === right || (left.id != null && right.id != null && left.id === right.id);
    };

    const screenDescription = (remoteId, peer) => {
        const key = String(remoteId);
        const cameraSender = videoSenders.current.get(key);
        const camera = peer.getTransceivers().find(item => sameSender(item.sender, cameraSender));
        const slot = screenShareSlots.current.get(key);
        const owner = screenShareOwnerRef.current;
        return {
            cameraMid: camera?.mid ?? null,
            screenShare: screenShareStreamRef.current && String(owner?.id) === String(currentUser.id)
                ? { ...owner, pending: false, mid: slot?.mid ?? null } : null,
        };
    };

    const announceScreenShare = (to = 'all') => {
        const owner = screenShareOwnerRef.current;
        if (screenShareStreamRef.current && String(owner?.id) === String(currentUser.id)) {
            sendVoiceSignal({ from: currentUser.id, to, type: 'screen-share-start', ...owner });
        }
    };

    const sendMediaState = () => {
        sendVoiceSignal({ from: currentUser.id, type: 'media-state', cameraEnabled: !!cameraStreamRef.current, micMuted: !localStream.current?.getAudioTracks().some(track => track.enabled) });
    };

    const removeRemoteMedia = (remoteId) => {
        const key = String(remoteId);
        remoteAudioElements.current.forEach((audio, audioKey) => {
            if (audioKey === key || audioKey.startsWith(key + ':')) { audio.pause(); audio.srcObject = null; remoteAudioElements.current.delete(audioKey); }
        });
        screenAudioChannels.current.get(key)?.close();
        screenAudioChannels.current.delete(key);
        screenAudioSenders.current.delete(key);
        voiceAudioSenders.current.delete(key);
        screenAudioSequences.current.delete(key);
        remoteStreamRefs.current.delete(key);
        remoteVideoEvents.current.delete(key);
        videoSenders.current.delete(key);
        clearRemoteScreen(key);
        remoteScreenMetadata.current.delete(key);
        clearTimeout(screenDiagnosticsTimers.current.get(key));
        screenDiagnosticsTimers.current.delete(key);
        screenShareSlots.current.delete(key);
        ignoredOffers.current.delete(key);
        screenShareSenders.current.delete(key);
        pendingOffers.current.delete(key);
        remoteAudioTracks.current.delete(key);
        pendingIceCandidates.current.delete(key);
        setRemoteStreams(previous => { const next = { ...previous }; delete next[key]; return next; });
        setMemberMediaStates(previous => { const next = { ...previous }; delete next[key]; return next; });
    };

    const resumeRemoteAudio = async () => {
        // Gọi play trực tiếp từ thao tác bấm để trình duyệt cho phép phát âm thanh.
        const results = await Promise.allSettled([...remoteAudioElements.current.values()].map(audio => audio.play()).concat(screenAudioContext.current ? [screenAudioContext.current.resume()] : [], webScreenAudio.current ? [webScreenAudio.current.context.resume()] : []));
        if (isMounted.current) setAudioPlaybackBlocked(results.some(result => result.status === 'rejected'));
    };

    const createPeer = (remoteId) => {
        const key = String(remoteId);
        if (peers.current.has(key)) return peers.current.get(key);
        const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        localStream.current?.getAudioTracks().forEach(track => voiceAudioSenders.current.set(key, peer.addTrack(track, localStream.current)));
        if (!localStream.current?.getAudioTracks().length) {
            voiceAudioSenders.current.set(key, peer.addTransceiver('audio', { direction: 'recvonly' }).sender);
        }
        // Đàm phán sẵn video để bật/tắt camera bằng replaceTrack, không tạo offer đồng thời.
        if (Number(currentUser.id) > Number(remoteId)) {
            const videoTrack = cameraStreamRef.current?.getVideoTracks()[0];
            const videoTransceiver = peer.addTransceiver(videoTrack || 'video', {
                direction: 'sendrecv',
                streams: localStream.current ? [localStream.current] : [],
            });
            videoSenders.current.set(key, videoTransceiver.sender);
            // Chừa một m-line riêng để bên nhận offer có thể gửi màn hình ngay trong answer.
            const screenSlot = peer.addTransceiver('video', { direction: 'recvonly' });
            preferScreenCodec(screenSlot);
            screenShareSlots.current.set(key, screenSlot);
        }
        peer.ondatachannel = event => bindScreenAudio(key, event.channel);
        if (Number(currentUser.id) > Number(remoteId)) bindScreenAudio(key, peer.createDataChannel('nagomi-screen-audio', { ordered: false, maxRetransmits: 0 }));
        peer.onsignalingstatechange = () => {
            if (peer.signalingState === 'stable' && !handlingDescriptions.current.has(key) && pendingOffers.current.has(key)) {
                setTimeout(() => {
                    if (peers.current.get(key) === peer) makeOffer(remoteId);
                }, 0);
            }
        };
        peer.onicecandidate = event => {
            if (event.candidate) sendVoiceSignal({ from: currentUser.id, to: remoteId, type: 'candidate', candidate: event.candidate.toJSON() });
        };
        peer.ontrack = event => {
            if (stopped.current || !isMounted.current) return;
            if (event.track?.kind === 'video' && event.transceiver?.mid != null) {
                let events = remoteVideoEvents.current.get(key);
                if (!events) { events = new Map(); remoteVideoEvents.current.set(key, events); }
                events.set(String(event.transceiver.mid), event);
            }
            const screenInfo = remoteScreenMetadata.current.get(key);
            const screenTrack = event.track?.kind === 'video' && screenInfo
                && ((screenInfo.mid != null && String(event.transceiver?.mid) === String(screenInfo.mid))
                    || event.streams?.some(stream => stream.id === screenInfo.streamId));
            if (screenTrack) {
                // Bỏ track cũ đến muộn sau khi người chia sẻ đã dừng hoặc đổi phiên.
                const owner = screenShareOwnerRef.current;
                if (String(owner?.id) !== key || owner?.sessionId !== screenInfo.sessionId) return;
                clearRemoteScreen(key);
                // Dùng stream native đã đăng ký khi nó chỉ chứa track màn hình.
                const receivedStream = event.streams?.find(stream => stream.getVideoTracks().length === 1
                    && stream.getVideoTracks()[0].id === event.track.id);
                const displayStream = receivedStream || new MediaStream([event.track]);
                const entry = { stream: displayStream, ownsStream: !receivedStream, track: event.track, sessionId: screenInfo.sessionId };
                entry.ended = () => {
                    if (remoteScreenStreams.current.get(key) !== entry) return;
                    clearRemoteScreen(key);
                    if (screenShareOwnerRef.current?.sessionId === entry.sessionId) {
                        screenShareOwnerRef.current = null;
                        if (isMounted.current) setScreenShareOwner(null);
                    }
                };
                entry.muted = () => {
                    if (remoteScreenStreams.current.get(key) === entry && isMounted.current) setScreenShareStream(null);
                };
                entry.unmuted = () => {
                    if (remoteScreenStreams.current.get(key) === entry && screenShareOwnerRef.current?.sessionId === entry.sessionId && isMounted.current) setScreenShareStream(displayStream);
                };
                remoteScreenStreams.current.set(key, entry);
                event.track.addEventListener?.('ended', entry.ended);
                event.track.addEventListener?.('mute', entry.muted);
                event.track.addEventListener?.('unmute', entry.unmuted);
                setScreenShareStream(displayStream);
                console.info('[Chia sẻ] Nhận track màn hình:', { peerId: key, mid: screenInfo.mid, trackId: event.track.id, sessionId: screenInfo.sessionId });
                queueScreenDiagnostics(key, peer);
                return;
            }
            if (event.track?.kind === 'audio') {
                event.track.enabled = isSpeakerOnRef.current;
                console.info('[Chia sẻ âm thanh] Nhận audio:', { peerId: key, trackId: event.track.id, enabled: event.track.enabled, mid: event.transceiver?.mid });
                const tracks = remoteAudioTracks.current.get(key) || [];
                if (!tracks.some(track => track.id === event.track.id)) remoteAudioTracks.current.set(key, [...tracks, event.track]);
                if (Platform.OS === 'web') {
                    const audioKey = key + ':' + event.track.id;
                    let audio = remoteAudioElements.current.get(audioKey);
                    if (!audio) { audio = document.createElement('audio'); audio.autoplay = true; audio.srcObject = new MediaStream([event.track]); remoteAudioElements.current.set(audioKey, audio); }
                    audio.muted = !isSpeakerOnRef.current;
                    audio.play().catch(() => { if (isMounted.current) setAudioPlaybackBlocked(true); });
                }
                return;
            }
            const stream = event.streams?.[0] || remoteStreamRefs.current.get(key) || new MediaStream();
            if (event.track && !stream.getTracks().some(track => track.id === event.track.id)) stream.addTrack(event.track);
            remoteStreamRefs.current.set(key, stream);
            setRemoteStreams(previous => ({ ...previous, [key]: stream }));
            if (Platform.OS !== 'web' && event.track?.kind === 'video') console.info('[Video] Nhan track:', { userId: key, trackId: event.track.id, streamURL: stream.toURL() });
        };
        peer.onconnectionstatechange = () => {
            if (stopped.current || peers.current.get(key) !== peer) return;
            if (peer.connectionState === 'connected') { sendMediaState(); announceScreenShare(remoteId); }
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
        const key = String(remoteId);
        const peer = createPeer(remoteId);
        if (makingOffers.current.has(key) || handlingDescriptions.current.has(key) || peer.signalingState !== 'stable') {
            pendingOffers.current.add(key);
            return;
        }
        makingOffers.current.add(key);
        pendingOffers.current.delete(key);
        const version = offerVersions.current.get(key) || 0;
        const task = (async () => {
            await attachScreenShare(remoteId, peer);
            if (stopped.current || peers.current.get(key) !== peer || version !== (offerVersions.current.get(key) || 0)) return;
            const offer = await peer.createOffer();
            if (stopped.current || peers.current.get(key) !== peer || version !== (offerVersions.current.get(key) || 0)) return;
            await peer.setLocalDescription(offer);
            if (stopped.current || peers.current.get(key) !== peer || version !== (offerVersions.current.get(key) || 0)) return;
            const screenInfo = screenDescription(remoteId, peer);
            console.info('[Chia sẻ] Offer:', { peerId: key, screen: screenInfo.screenShare });
            sendVoiceSignal({ from: currentUser.id, to: remoteId, type: 'offer', description: peer.localDescription || offer, ...screenInfo });
            queueScreenDiagnostics(key, peer);
        })();
        offerTasks.current.set(key, task);
        try { await task; }
        catch (error) {
            console.warn('Voice offer failed:', error.message);
            if (isMounted.current && screenShareStreamRef.current) setMediaError('Có kết nối chưa gửi được màn hình. Hãy thử kết nối lại kênh.');
        } finally {
            if (offerTasks.current.get(key) === task) offerTasks.current.delete(key);
            makingOffers.current.delete(key);
            if (!stopped.current && peers.current.get(key) === peer && !handlingDescriptions.current.has(key)
                && peer.signalingState === 'stable' && pendingOffers.current.has(key)) setTimeout(() => makeOffer(remoteId), 0);
        }
    };

    const attachScreenShare = async (remoteId, peer) => {
        const key = String(remoteId);
        const stream = screenShareStreamRef.current;
        const track = stream?.getVideoTracks().find(track => track.readyState !== 'ended');
        if (!track || peer.signalingState === 'closed') return;
        let slot = screenShareSlots.current.get(key);
        if (!slot || slot.stopped) {
            slot = peer.addTransceiver(track, { direction: 'sendonly', streams: [stream] });
            screenShareSlots.current.set(key, slot);
        } else {
            if (slot.sender.track?.id !== track.id) await slot.sender.replaceTrack(track);
            if (stopped.current || screenShareStreamRef.current !== stream) return;
            slot.direction = 'sendonly';
        }
        // Browser replaceTrack không tự gắn msid vào slot đã tạo bằng recvonly.
        slot.sender.setStreams?.(stream);
        preferScreenCodec(slot);
        screenShareSenders.current.set(key, slot.sender);
        const audio = stream.getAudioTracks().find(track => track.readyState !== 'ended');
        if (audio && Platform.OS === 'web' && webScreenAudio.current) {
            const sender = voiceAudioSenders.current.get(key);
            const mixedTrack = webScreenAudio.current.track;
            if (sender && sender.track !== mixedTrack) await sender.replaceTrack(mixedTrack);
            const transceiver = peer.getTransceivers().find(item => sameSender(item.sender, sender));
            if (transceiver && !['sendrecv', 'sendonly'].includes(transceiver.direction)) transceiver.direction = 'sendrecv';
        } else if (audio) {
            let sender = screenAudioSenders.current.get(key);
            if (!sender) { sender = peer.addTrack(audio, stream); screenAudioSenders.current.set(key, sender); }
            else if (sender.track !== audio) await sender.replaceTrack(audio);
        }
    };

    const stopScreenShare = async (renegotiate = true) => {
        screenShareAttemptRef.current += 1;
        const restoreMicrophone = stopWebScreenAudio();
        const broadcastWait = iosBroadcastWait.current;
        if (broadcastWait) {
            clearInterval(broadcastWait.timer);
            iosBroadcastWait.current = null;
            broadcastWait.reject(new Error('Đã hủy chia sẻ màn hình.'));
            if (isMounted.current) setIsIOSBroadcastWaiting(false);
        }
        const claim = screenShareClaimRef.current;
        if (claim) {
            clearTimeout(claim.timer);
            screenShareClaimRef.current = null;
            sendVoiceSignal({ from: currentUser.id, to: 'all', type: 'screen-share-stop', sessionId: claim.sessionId });
            claim.reject(new Error('Đã hủy yêu cầu chia sẻ.'));
        }
        const stream = screenShareStreamRef.current;
        screenShareStreamRef.current = null;
        const owner = screenShareOwnerRef.current;
        const owned = String(owner?.id) === String(currentUser.id);
        if (owned) {
            retiredScreenSessions.current.add(owner.sessionId);
            if (Platform.OS === 'ios') NativeModules.NagomiScreenShare?.stop(owner.sessionId).catch(() => {});
            if (Platform.OS === 'android') { NativeModules.NagomiScreenShareControls?.clear(owner.sessionId); NativeModules.NagomiPlaybackAudio?.stopCapture(owner.sessionId); }
            sendVoiceSignal({ from: currentUser.id, to: 'all', type: 'screen-share-stop', sessionId: owner.sessionId });
            screenShareOwnerRef.current = null;
            if (isMounted.current) { setScreenShareOwner(null); setScreenShareStream(null); }
        }
        stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
        const changedPeers = [];
        screenShareSenders.current.forEach((sender, id) => {
            const peer = peers.current.get(id);
            if (!peer || peer.signalingState === 'closed') return;
            try {
                peer.removeTrack(sender);
                changedPeers.push(id);
            } catch (error) { console.warn('[Chia sẻ] Không gỡ được sender:', error.message); }
        });
        screenShareSenders.current.clear();
        screenAudioSenders.current.forEach((sender, id) => {
            try { peers.current.get(id)?.removeTrack(sender); if (!changedPeers.includes(id)) changedPeers.push(id); } catch (_) { }
        });
        screenAudioSenders.current.clear();
        // WebRTC native cần release để giải phóng MediaProjection service.
        stream?.release?.();
        if (isMounted.current) setIsScreenSharing(false);
        await restoreMicrophone;
        if (renegotiate && !stopped.current) await Promise.all(changedPeers.map(id => makeOffer(id)));
    };

    const requestScreenShare = (sessionId) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            if (screenShareClaimRef.current?.sessionId !== sessionId) return;
            screenShareClaimRef.current = null;
            sendVoiceSignal({ from: currentUser.id, to: 'all', type: 'screen-share-stop', sessionId });
            reject(new Error('Không nhận được quyền chia sẻ. Hãy kiểm tra backend đã cập nhật.'));
        }, 10000);
        screenShareClaimRef.current = { sessionId, resolve, reject, timer };
        sendVoiceSignal({ from: currentUser.id, to: 'all', type: 'screen-share-claim', sessionId });
    });

    const waitForIOSBroadcast = (sessionId) => new Promise((resolve, reject) => {
        const deadline = Date.now() + 45000;
        let checking = false;
        const finish = (error) => {
            const pending = iosBroadcastWait.current;
            if (pending?.sessionId !== sessionId) return;
            clearInterval(pending.timer);
            iosBroadcastWait.current = null;
            if (isMounted.current) setIsIOSBroadcastWaiting(false);
            if (error) reject(error); else resolve();
        };
        const check = async () => {
            if (checking) return;
            checking = true;
            try {
                const status = await NativeModules.NagomiScreenShare.status(sessionId);
                if (status === 'active' || status === 'paused') finish();
                else if (status === 'stopped' || status === 'stopping') finish(new Error('Đã dừng chia sẻ màn hình iOS.'));
                else if (Date.now() >= deadline) finish(new Error('Chưa bắt đầu broadcast. Hãy bấm Bắt đầu phát hoặc thử chia sẻ lại.'));
            } catch (error) { finish(error); }
            finally { checking = false; }
        };
        iosBroadcastWait.current = { sessionId, reject, timer: setInterval(check, 500) };
        setIsIOSBroadcastWaiting(true);
        check();
    });

    const toggleScreenShare = async () => {
        if (isPreview || stopped.current) return;
        if (screenShareChangingRef.current) {
            if (Platform.OS === 'ios' && iosBroadcastWait.current) await stopScreenShare();
            return;
        }
        if (screenShareStreamRef.current) {
            screenShareChangingRef.current = true;
            setIsScreenShareChanging(true);
            try { await stopScreenShare(); }
            finally { screenShareChangingRef.current = false; if (isMounted.current) setIsScreenShareChanging(false); }
            return;
        }
        if (screenShareOwnerRef.current) {
            setMediaError('Đang có người chia sẻ màn hình.');
            Alert.alert('Chia sẻ màn hình', 'Đang có người chia sẻ màn hình.');
            return;
        }
        if (!stompClient.current?.connected) return;
        if (typeof mediaDevices?.getDisplayMedia !== 'function') {
            setMediaError(Platform.OS === 'web' ? 'Trình duyệt này chưa hỗ trợ chia sẻ màn hình. Hãy mở bằng Chrome/Edge trên localhost hoặc HTTPS.' : 'Dev client chưa có module chia sẻ màn hình.');
            return;
        }
        if (Platform.OS === 'ios' && (!NativeModules.NagomiScreenShare || !NativeModules.ScreenCapturePickerViewManager?.show)) {
            setMediaError('Cần cài dev client iOS mới có Broadcast Upload Extension; reload không bổ sung được cấu hình native.');
            return;
        }
        screenShareChangingRef.current = true;
        setIsScreenShareChanging(true);
        const attempt = ++screenShareAttemptRef.current;
        const sessionId = String(currentUser.id) + ':' + Date.now() + ':' + attempt;
        let stream = null;
        let browserCapture = null;
        let browserAudioContext = null;
        let screenAudioWarning = '';
        let abandoned = false;
        try {
            if (Platform.OS === 'android' && Number(Platform.Version) >= 33 && NativeModules.NagomiScreenShareControls) {
                const permission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
                if (permission !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('Hãy cho phép thông báo để dùng nút Dừng chia sẻ khi đang ở app khác.');
                if (stopped.current || attempt !== screenShareAttemptRef.current) return;
            }
            if (Platform.OS === 'web') {
                // Khởi động AudioContext và capture ngay trong cú bấm để giữ user activation.
                const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
                if (AudioContext) {
                    browserAudioContext = new AudioContext();
                    browserAudioContext.resume().catch(() => {});
                }
                browserCapture = mediaDevices.getDisplayMedia({ video: { width: { ideal: 1280, max: 1920 }, height: { ideal: 720, max: 1080 }, frameRate: { ideal: 15, max: 20 } }, audio: true, systemAudio: 'include', selfBrowserSurface: 'exclude' }).then(captured => {
                    if (abandoned || stopped.current || attempt !== screenShareAttemptRef.current) {
                        captured.getTracks().forEach(track => track.stop());
                    }
                    return captured;
                });
                browserCapture.catch(() => {});
            }
            await requestScreenShare(sessionId);
            if (stopped.current || !isMounted.current || attempt !== screenShareAttemptRef.current) return;
            if (Platform.OS === 'ios') await NativeModules.NagomiScreenShare.prepare(sessionId);
            if (Platform.OS === 'android' && NativeModules.NagomiPlaybackAudio) {
                const data = await NativeModules.NagomiPlaybackAudio.getDisplayMedia(sessionId);
                stream = new MediaStream({ streamId: data.streamId, streamReactTag: data.streamId, tracks: [data.track] });
                screenAudioWarning = data.audioError || '';
            } else stream = Platform.OS === 'web' ? await browserCapture : await mediaDevices.getDisplayMedia();
            if (Platform.OS === 'ios') {
                const handle = findNodeHandle(screenCapturePickerRef.current);
                if (handle == null) throw new Error('Chưa mở được hộp chia sẻ iOS. Hãy vào lại kênh.');
                NativeModules.ScreenCapturePickerViewManager.show(handle);
                await waitForIOSBroadcast(sessionId);
            }
            if (stopped.current || !isMounted.current || attempt !== screenShareAttemptRef.current) {
                stream.getTracks().forEach(track => track.stop());
                stream.release?.();
                return;
            }
            if (String(screenShareOwnerRef.current?.id) !== String(currentUser.id) || screenShareOwnerRef.current?.sessionId !== sessionId) {
                stream.getTracks().forEach(track => track.stop());
                stream.release?.();
                setMediaError('Đang có người chia sẻ màn hình.');
            Alert.alert('Chia sẻ màn hình', 'Đang có người chia sẻ màn hình.');
                return;
            }
            const track = stream.getVideoTracks().find(track => track.readyState !== 'ended');
            console.info('[Chia sẻ] Capture:', { platform: Platform.OS, streamId: stream.id, trackId: track?.id, readyState: track?.readyState, enabled: track?.enabled });
            if (!track) throw new Error('Không có track màn hình.');
            screenShareStreamRef.current = stream;
            if (Platform.OS === 'web') startWebScreenAudio(stream, browserAudioContext, sessionId);
            const owner = { id: String(currentUser.id), username: currentUser.username, streamId: stream.id,
                sessionId, pending: false };
            screenShareOwnerRef.current = owner;
            setScreenShareOwner(owner);
            track.onended = () => {
                console.info('[Chia sẻ] Hệ thống đã dừng capture');
                if (screenShareStreamRef.current === stream) stopScreenShare();
            };
            if (Platform.OS === 'android' && NativeModules.NagomiScreenShareControls) {
                await NativeModules.NagomiScreenShareControls.show(track.id, sessionId);
                if (stopped.current || attempt !== screenShareAttemptRef.current) return;
            }
            setIsScreenSharing(true);
            setMediaError(screenAudioWarning || (Platform.OS === 'web' && !stream.getAudioTracks().length ? 'Nguồn này chưa có tiếng. Chọn tab có âm thanh và bật Chia sẻ âm thanh trong hộp thoại trình duyệt.' : ''));
            // Công bố stream trước SDP để bên nhận phân biệt với camera.
            sendVoiceSignal({ from: currentUser.id, to: 'all', type: 'screen-share-start', ...owner });
            await Promise.all([...peers.current.entries()].map(([id, peer]) => attachScreenShare(id, peer)));
            await Promise.all([...peers.current.keys()].map(id => makeOffer(id)));
        } catch (error) {
            const attemptIsCurrent = attempt === screenShareAttemptRef.current;
            if (stream && screenShareStreamRef.current === stream) await stopScreenShare();
            else {
                if (screenShareOwnerRef.current?.sessionId === sessionId) await stopScreenShare();
                stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
                stream?.release?.();
            }
            console.warn('[Chia sẻ] Không mở được màn hình:', error.name, error.message);
            if (isMounted.current && !stopped.current && attemptIsCurrent) {
                setMediaError(error.message?.includes('chia sẻ') || error.message?.includes('broadcast') ? error.message
                    : Platform.OS === 'web' ? 'Không mở được màn hình. Hãy cho phép chia sẻ và dùng localhost hoặc HTTPS.'
                        : Platform.OS === 'ios' ? 'Không bắt đầu được broadcast iOS. Hãy kiểm tra dev client và App Group.'
                            : 'Chưa mở được chia sẻ màn hình. Hãy kiểm tra quyền và APK dev client có service MediaProjection.');
            }
        } finally {
            if (browserAudioContext && webScreenAudio.current?.context !== browserAudioContext) browserAudioContext.close().catch(() => {});
            abandoned = true;
            screenShareChangingRef.current = false;
            if (isMounted.current) setIsScreenShareChanging(false);
        }
    };

    const syncPeers = (roster) => {
        const sharingOwner = screenShareOwnerRef.current;
        if (sharingOwner && !roster.some(user => String(user.id) === String(sharingOwner.id))) {
            clearRemoteScreen(sharingOwner.id);
            screenShareOwnerRef.current = null;
            if (isMounted.current) { setScreenShareOwner(null); setScreenShareStream(null); }
        }
        const activeIds = new Set(roster.filter(user => String(user.id) !== String(currentUser.id)).map(user => String(user.id)));
        peers.current.forEach((peer, id) => {
            if (!activeIds.has(id)) { peers.current.delete(id); peer.close(); removeRemoteMedia(id); }
        });
        roster.forEach(user => {
            if (Number(currentUser.id) > Number(user.id) && String(user.id) !== String(currentUser.id) && !peers.current.has(String(user.id))) makeOffer(user.id);
        });
    };

    const handleVoiceSignal = (signal) => {
        if (stopped.current || !isMounted.current || signal?.from == null) return Promise.resolve();
        const key = String(signal.from);
        const version = voiceSessionVersion.current;
        const previous = voiceSignalQueues.current.get(key) || Promise.resolve();
        const next = previous.catch(() => {}).then(() => {
            if (version !== voiceSessionVersion.current) return;
            return processVoiceSignal(signal);
        });
        voiceSignalQueues.current.set(key, next);
        return next.catch(error => console.warn('Voice signal failed:', error.message));
    };

    const processVoiceSignal = async (signal) => {
        if (stopped.current || !isMounted.current || String(signal.from) === String(currentUser.id)) return;
        if (signal.to != null && signal.to !== 'all' && String(signal.to) !== String(currentUser.id)) return;
        if (String(signal.from) === 'server' && ['screen-share-granted', 'screen-share-denied'].includes(signal.type)) {
            const claim = screenShareClaimRef.current;
            if (claim?.sessionId === signal.sessionId) {
                clearTimeout(claim.timer);
                screenShareClaimRef.current = null;
                if (signal.type === 'screen-share-granted') {
                    if (signal.revision != null && Number(signal.revision) < screenShareRevision.current) {
                        claim.reject(new Error('Quyền chia sẻ đã thay đổi. Hãy thử lại.'));
                        return;
                    }
                    console.info('[Chia sẻ] Được cấp quyền:', { sessionId: signal.sessionId, revision: signal.revision });
                    screenShareRevision.current = Math.max(screenShareRevision.current, Number(signal.revision) || 0);
                    screenShareOwnerRef.current = signal.owner;
                    setScreenShareOwner(signal.owner);
                    claim.resolve(signal.owner);
                }
                else claim.reject(new Error('Đang có người chia sẻ màn hình.'));
            }
            return;
        }
        if ((String(signal.from) === 'server' && signal.type === 'screen-share-state') || signal.type === 'screen-share-stop') {
            if (signal.revision != null) {
                const revision = Number(signal.revision);
                if (revision < screenShareRevision.current) return;
                screenShareRevision.current = revision;
            }
        }
        if (String(signal.from) === 'server' && signal.type === 'screen-share-state') {
            console.info('[Chia sẻ] Trạng thái kênh:', { revision: signal.revision, owner: signal.owner });
            const owner = signal.owner;
            if (!owner) {
                if (screenShareStreamRef.current) await stopScreenShare(false);
                const previous = screenShareOwnerRef.current;
                if (previous) { retiredScreenSessions.current.add(previous.sessionId); clearRemoteScreen(previous.id); }
                screenShareOwnerRef.current = null;
                setScreenShareOwner(null);
                setScreenShareStream(null);
            } else if (String(owner.id) === String(currentUser.id)) {
                screenShareOwnerRef.current = owner;
                setScreenShareOwner(owner);
            } else {
                if (screenShareStreamRef.current) await stopScreenShare(false);
                const previous = screenShareOwnerRef.current;
                if (previous && String(previous.id) !== String(owner.id)) {
                    clearRemoteScreen(previous.id);
                    screenShareOwnerRef.current = null;
                }
                rememberScreenShare(owner.id, owner, true);
            }
            return;
        }
        if (signal.type === 'screen-share-query') return;
        if (signal.type === 'screen-share-start') {
            const owner = screenShareOwnerRef.current;
            // Khi hai máy bật gần nhau, ưu tiên ID lớn hơn để cùng chọn một người.
            if (owner && String(owner.id) !== String(signal.from) && Number(owner.id) > Number(signal.from)) return;
            if (screenShareStreamRef.current && String(signal.from) !== String(currentUser.id)) await stopScreenShare();
            rememberScreenShare(signal.from, { id: String(signal.from), username: signal.username, streamId: signal.streamId, sessionId: signal.sessionId });
            return;
        }
        if (signal.type === 'screen-share-stop') {
            retiredScreenSessions.current.add(signal.sessionId);
            const owner = screenShareOwnerRef.current;
            if (String(owner?.id) === String(signal.from) && owner?.sessionId === signal.sessionId) {
                clearRemoteScreen(signal.from);
                screenShareOwnerRef.current = null;
                setScreenShareOwner(null);
                setScreenShareStream(null);
            }
            return;
        }
        // Broadcast chỉ dùng cho trạng thái, không tạo peer có ID all.
        if (signal.to === 'all') return;
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
        const key = String(signal.from);
        if (!['offer', 'answer', 'candidate'].includes(signal.type)) return;
        try {
            const peer = createPeer(signal.from);
            if (signal.type === 'offer') {
                const collision = makingOffers.current.has(key) || peer.signalingState !== 'stable';
                if (collision && Number(currentUser.id) > Number(signal.from)) {
                    ignoredOffers.current.add(key);
                    return;
                }
                handlingDescriptions.current.add(key);
                ignoredOffers.current.delete(key);
                if (collision) {
                    // Bên ID nhỏ nhường: hủy offer đang tạo rồi rollback offer đã gửi.
                    offerVersions.current.set(key, (offerVersions.current.get(key) || 0) + 1);
                    await offerTasks.current.get(key)?.catch(() => {});
                    if (peer.signalingState === 'have-local-offer') await peer.setLocalDescription({ type: 'rollback' });
                }
                if (stopped.current || peers.current.get(key) !== peer) return;
                if (signal.screenShare) rememberScreenShare(key, signal.screenShare);
                await peer.setRemoteDescription(new RTCSessionDescription(signal.description));
                restoreRemoteScreen(key, peer);
                const screenMid = remoteScreenMetadata.current.get(key)?.mid;
                const videoTransceiver = peer.getTransceivers().find(transceiver => transceiver.receiver.track?.kind === 'video'
                    && transceiver.mid != null && (signal.cameraMid != null ? String(transceiver.mid) === String(signal.cameraMid)
                        : String(transceiver.mid) !== String(screenMid)));
                if (videoTransceiver) {
                    videoTransceiver.direction = 'sendrecv';
                    await videoTransceiver.sender.replaceTrack(cameraStreamRef.current?.getVideoTracks()[0] || null);
                    videoSenders.current.set(key, videoTransceiver.sender);
                    const slot = peer.getTransceivers().find(item => item.receiver.track?.kind === 'video'
                        && !sameSender(item.sender, videoTransceiver.sender) && item.mid != null && !item.stopped);
                    if (slot) {
                        // Sau khi từng chia sẻ rồi dừng, slot có thể inactive; cần bật nhận lại.
                        slot.direction = screenShareStreamRef.current ? 'sendonly' : 'recvonly';
                        preferScreenCodec(slot);
                        screenShareSlots.current.set(key, slot);
                    }
                }
                await attachScreenShare(key, peer);
                await flushIceCandidates(key, peer);
                const answer = await peer.createAnswer();
                if (stopped.current || peers.current.get(key) !== peer) return;
                await peer.setLocalDescription(answer);
                sendVoiceSignal({ from: currentUser.id, to: signal.from, type: 'answer', description: peer.localDescription || answer, ...screenDescription(key, peer) });
                queueScreenDiagnostics(key, peer);
                if (screenShareStreamRef.current && (screenShareSlots.current.get(key)?.mid == null
                    || peer.getTransceivers().some(item => sameSender(item.sender, screenAudioSenders.current.get(key)) && item.mid == null))) pendingOffers.current.add(key);
            } else if (signal.type === 'answer') {
                if (peer.signalingState !== 'have-local-offer') return;
                handlingDescriptions.current.add(key);
                ignoredOffers.current.delete(key);
                if (signal.screenShare) rememberScreenShare(key, signal.screenShare);
                await peer.setRemoteDescription(new RTCSessionDescription(signal.description));
                restoreRemoteScreen(key, peer);
                await flushIceCandidates(key, peer);
                queueScreenDiagnostics(key, peer);
            } else if (!ignoredOffers.current.has(key)) {
                if (peer.remoteDescription) await peer.addIceCandidate(new RTCIceCandidate(signal.candidate));
                else pendingIceCandidates.current.set(key, [...(pendingIceCandidates.current.get(key) || []), signal.candidate]);
            }
        } catch (error) { console.warn('Voice signal failed:', error.message); }
        finally {
            handlingDescriptions.current.delete(key);
            const peer = peers.current.get(key);
            if (!stopped.current && peer?.signalingState === 'stable' && pendingOffers.current.has(key)) setTimeout(() => makeOffer(key), 0);
        }
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
        voiceSessionVersion.current += 1;
        screenShareRevision.current = 0;
        // Dừng track và gửi thông báo trước khi ngắt STOMP; không tạo SDP khi rời.
        stopScreenShare(false).catch(error => console.warn('[Chia sẻ] Dọn capture:', error.message));
        screenShareOwnerRef.current = null;
        makingOffers.current.clear();
        pendingOffers.current.clear();
        offerVersions.current.clear();
        offerTasks.current.clear();
        handlingDescriptions.current.clear();
        ignoredOffers.current.clear();
        voiceSignalQueues.current.clear();
        screenDiagnosticsTimers.current.forEach(clearTimeout);
        screenDiagnosticsTimers.current.clear();
        retiredScreenSessions.current.clear();
        [...remoteScreenStreams.current.keys()].forEach(clearRemoteScreen);
        remoteScreenMetadata.current.clear();
        screenShareSlots.current.clear();
        screenAudioChannels.current.forEach(channel => { try { channel.close(); } catch (_) { } });
        screenAudioChannels.current.clear();
        screenAudioSenders.current.clear();
        voiceAudioSenders.current.clear();
        stopReceivedScreenAudio();
        if (isMounted.current) setScreenShareStream(null);
        if (isMounted.current) setScreenShareOwner(null);
        musicPlaybackIntent.current = false;
        musicPendingSeek.current = null;
        musicSeekBar.current.dragging = false;
        if (retryTimer.current) clearTimeout(retryTimer.current);
        retryTimer.current = null;
        const client = stompClient.current;
        stompClient.current = null;
        if (client?.connected) {
            try { client.send('/app/voice.leave/' + channelId + '/' + currentUser.id, {}); }
            catch (error) { console.warn('[Voice] Không gửi được lệnh rời kênh:', error.message); }
        }
        try { client?.disconnect(); } catch (_) { }
        peers.current.forEach(peer => { try { peer.close(); } catch (_) { } });
        peers.current.clear();
        remoteAudioElements.current.forEach(audio => { audio.pause(); audio.srcObject = null; });
        remoteAudioElements.current.clear();
        remoteStreamRefs.current.clear();
        remoteVideoEvents.current.clear();
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

    const leaveChannel = () => {
        // Ngắt phiên ngay cả khi route hiện tại không có lịch sử để goBack.
        voiceMountVersion.current += 1;
        if (String(global.activeVoiceSession?.channelId) === String(channelId)
            && String(global.activeVoiceSession?.userId) === String(currentUser.id)) {
            global.activeVoiceSession = null;
            global.inVoiceChannel = false;
        }
        setScreenShareExpanded(false);
        try { leaveVoiceSession(); }
        catch (error) { console.warn('[Voice] Dọn phiên khi rời kênh:', error.message); }
        finally {
            try { musicSound.current?.remove(); } catch (_) { }
            musicSound.current = null;
            musicSoundUrl.current = null;
            if (navigation.canGoBack()) navigation.goBack();
            else navigation.replace('Main');
            onLeave?.();
        }
    };

    const toggleMic = () => {
        const nextMuted = !isMicMuted;
        localStream.current?.getAudioTracks().forEach(track => { track.enabled = !nextMuted; });
        isMicMutedRef.current = nextMuted;
        if (webScreenAudio.current?.microphoneGain) webScreenAudio.current.microphoneGain.gain.value = nextMuted ? 0 : 1;
        setIsMicMuted(nextMuted);
        sendMediaState();
    };

    const toggleSpeaker = () => {
        const nextOn = !isSpeakerOn;
        isSpeakerOnRef.current = nextOn;
        setIsSpeakerOn(nextOn);
        if (!nextOn) stopReceivedScreenAudio();
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

    const showCameraDiagnostics = async () => {
        const nativeVersion = Platform.constants?.reactNativeVersion;
        const report = {
            platform: Platform.OS,
            hermes: !!global.HermesInternal,
            devClient: !!NativeModules.EXDevLauncher,
            expoGo: isExpoGo,
            nativeReactNative: nativeVersion || null,
            projectReactNative: require('../../package.json').dependencies['react-native'],
            camera: cameraStreamRef.current ? {
                streamURL: cameraStreamRef.current.toURL?.(),
                tracks: cameraStreamRef.current.getVideoTracks().map(track => ({ id: track.id, enabled: track.enabled, readyState: track.readyState, muted: track.muted })),
            } : null,
            nativeViews: nativeVideoLayouts,
            peers: [],
        };
        await Promise.all([...peers.current.entries()].map(async ([id, peer]) => {
            const entry = { id, connectionState: peer.connectionState, video: [] };
            try {
                const stats = await peer.getStats();
                stats.forEach(item => {
                    if (['inbound-rtp', 'outbound-rtp'].includes(item.type) && (item.kind === 'video' || item.mediaType === 'video')) {
                        entry.video.push({ type: item.type, mid: item.mid, bytesReceived: item.bytesReceived, bytesSent: item.bytesSent,
                            framesDecoded: item.framesDecoded, framesEncoded: item.framesEncoded, codec: stats.get(item.codecId)?.mimeType });
                    }
                });
            } catch (error) { entry.error = error.message; }
            report.peers.push(entry);
        }));
        console.log('[Camera native] Chẩn đoán:', report);
        if (isMounted.current) Alert.alert('Chẩn đoán camera', JSON.stringify(report, null, 2));
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
    const musicSourceError = (url) => {
        if (!url?.trim()) return 'Chưa có nguồn âm thanh.';
        if (url.startsWith('/')) return null;
        try {
            const source = new URL(url);
            if (!['http:', 'https:'].includes(source.protocol)) return 'Dùng link âm thanh HTTP hoặc HTTPS.';
            if (/(^|\.)zingmp3\.vn$/i.test(source.hostname) || /\.html?$/i.test(source.pathname)) {
                return 'Đây là link trang web, không phải nguồn âm thanh. Hãy tải file nhạc lên hoặc dùng link audio trực tiếp.';
            }
        } catch (_) { return 'Link âm thanh không hợp lệ.'; }
        return null;
    };

    const formatMusicTime = (seconds) => {
        const value = Math.max(0, Math.floor(Number(seconds) || 0));
        return Math.floor(value / 60) + ':' + String(value % 60).padStart(2, '0');
    };

    const applyPendingMusicSeek = async (player) => {
        if (!player?.isLoaded || musicSound.current !== player || !musicPendingSeek.current || musicSeeking.current) return;
        musicSeeking.current = true;
        const pending = musicPendingSeek.current;
        musicPendingSeek.current = null;
        try {
            const target = player.duration > 0
                ? (musicLoopRef.current ? pending.position % player.duration : Math.min(pending.position, player.duration))
                : pending.position;
            await player.seekTo(Math.max(0, target));
            if (musicSound.current !== player || stopped.current || musicPendingSeek.current) return;
            if (musicPlaybackIntent.current) player.play();
            else player.pause();
        } catch (error) {
            if (isMounted.current && musicSound.current === player) {
                setMusicError('Không thể tua hoặc phát bài hát. Hãy kiểm tra nguồn âm thanh.');
                setMusicLoading(false);
            }
        } finally {
            musicSeeking.current = false;
            if (!stopped.current && musicPendingSeek.current) applyPendingMusicSeek(musicSound.current);
        }
    };

    const handleMusicSync = async (data) => {
        if (!data.url || !isMounted.current || stopped.current) return;
        const sourceError = musicSourceError(data.url);
        if (sourceError) {
            musicPlaybackIntent.current = false;
            musicPendingSeek.current = null;
            musicSound.current?.pause();
            setMusicError(sourceError);
            setIsMusicPlaying(false);
            setMusicLoading(false);
            return;
        }
        try {
            await voiceAudioReady.current;
            if (!isMounted.current || stopped.current) return;
            musicSourceRef.current = data.url;
            const cleanUrl = data.url.startsWith('http') ? data.url : BASE_URL_IMG + data.url;
            const playing = data.playing === true || data.isPlaying === true;
            musicPlaybackIntent.current = playing;
            musicLoopRef.current = data.loop === true;
            setMusicLoop(musicLoopRef.current);
            currentMusicRef.current = { url: cleanUrl, title: data.title };
            setCurrentMusic(currentMusicRef.current);
            setMusicError('');
            let player = musicSound.current;
            if (!player || musicSoundUrl.current !== cleanUrl) {
                player?.remove();
                musicPendingSeek.current = null;
                musicFinishHandled.current = false;
                setMusicDuration(0);
                setMusicPosition(0);
                setMusicLoading(true);
                if (__DEV__) {
                    const source = new URL(cleanUrl);
                    console.log('[Nhạc] Tải nguồn:', Platform.OS, source.origin + source.pathname);
                }
                player = createAudioPlayer({ uri: cleanUrl }, { updateInterval: 250, keepAudioSessionActive: true });
                musicSound.current = player;
                musicSoundUrl.current = cleanUrl;
                player.addListener('playbackStatusUpdate', status => {
                    if (isMounted.current && musicSound.current === player) onPlaybackStatusUpdate(status);
                });
            }
            player.loop = musicLoopRef.current;
            musicPendingSeek.current = { position: Math.max(0, Number(data.position) || 0) / 1000 };
            if (!playing) player.pause();
            await applyPendingMusicSeek(player);
        } catch (error) {
            if (isMounted.current) {
                setMusicError('Không phát được nhạc: ' + error.message);
                setIsMusicPlaying(false);
                setMusicLoading(false);
            }
        }
    };

    const handleMusicCommand = async (data) => {
        if (data.action === 'REFRESH_LIST') return loadChannelMusic();
        // Giữ tương thích lệnh phát/tạm dừng cũ khi backend chưa khởi động lại.
        if (data.action === 'PLAY' || data.action === 'PAUSE') {
            return handleMusicSync({ ...data, playing: data.action === 'PLAY', loop: musicLoopRef.current });
        }
    };

    const onPlaybackStatusUpdate = (ps) => {
        if (!isMounted.current || stopped.current) return;
        if (ps.error) {
            console.warn('[Nhạc] Lỗi phát native:', ps.error);
            setMusicError('Không tải được âm thanh: ' + String(ps.error));
            setMusicLoading(false);
            setIsMusicPlaying(false);
            return;
        }
        setMusicDuration(Number(ps.duration) || 0);
        setMusicPosition(Number(ps.currentTime) || 0);
        setMusicLoading(!ps.isLoaded || ps.isBuffering);
        setIsMusicPlaying(ps.playing);
        if (ps.isLoaded && musicPendingSeek.current) applyPendingMusicSeek(musicSound.current);
        if (ps.playing) musicFinishHandled.current = false;
        if (ps.didJustFinish && !musicLoopRef.current && !musicFinishHandled.current) {
            musicFinishHandled.current = true;
            // Chỉ một thành viên chuyển bài, tránh mỗi máy phát một lệnh.
            const leader = musicMembersRef.current.reduce((id, user) => Math.max(id, Number(user.id)), 0);
            if (leader === Number(currentUser.id)) playNextSong(1, true);
        }
    };

    const sendMusicControl = (action, url = null, title = null, options = {}) => {
        if (!stompClient.current?.connected) {
            setMusicError('Chưa kết nối kênh. Hãy đợi kết nối lại.');
            return;
        }
        const activeMusic = currentMusicRef.current;
        const sourceUrl = url || musicSourceRef.current || playlistRef.current[0]?.url;
        const sourceTitle = title || activeMusic.title || playlistRef.current[0]?.title;
        if (!sourceUrl) return;
        const sourceError = musicSourceError(sourceUrl);
        if (sourceError) { setMusicError(sourceError); return; }
        const player = musicSound.current;
        const restart = action === 'PLAY' && player?.duration > 0 && player.currentTime >= player.duration - 0.1;
        const position = options.position ?? (url || restart ? 0 : Math.round((player?.currentTime || 0) * 1000));
        stompClient.current.send('/app/music.control/' + channelId, {}, JSON.stringify({
            action, url: sourceUrl, title: sourceTitle, position,
            loop: options.loop ?? musicLoopRef.current,
            sender: currentUser.username,
        }));
    };

    const seekMusic = (seconds) => {
        if (!musicSound.current?.isLoaded || !musicSound.current?.duration) return;
        const position = Math.max(0, Math.min(musicSound.current.duration, seconds));
        sendMusicControl('SEEK', null, null, { position: Math.round(position * 1000) });
    };

    const loadChannelMusic = async () => {
        const data = await UserService.getChannelPlaylist(channelId);
        if (!isMounted.current) return;
        playlistRef.current = data;
        setPlaylist(data);
    };

    const playNextSong = (direction = 1, automatic = false) => {
        const list = playlistRef.current;
        if (!list.length) return;
        const currentIndex = list.findIndex(item => (item.url.startsWith('http') ? item.url : BASE_URL_IMG + item.url) === currentMusicRef.current.url);
        if (automatic && currentIndex === list.length - 1) {
            sendMusicControl('PAUSE');
            return;
        }
        const index = currentIndex < 0 ? 0 : (currentIndex + direction + list.length) % list.length;
        sendMusicControl('PLAY', list[index].url, list[index].title);
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
        const title = musicTitle.trim();
        const url = musicLink.trim();
        const error = musicSourceError(url);
        if (!title || error) { setMusicError(error || 'Nhập tên bài hát.'); return; }
        setIsUploading(true);
        try {
            if (editingMusic) {
                await UserService.updateChannelMusic(channelId, editingMusic.id, { title, url });
            } else {
                await UserService.addMusicToChannel(channelId, { title, url, uploadedBy: currentUser.username });
            }
            stompClient.current?.connected && stompClient.current.send('/app/music.control/' + channelId, {}, JSON.stringify({ action: 'REFRESH_LIST' }));
            await loadChannelMusic();
            setLinkModalVisible(false);
            setEditingMusic(null);
            setMusicLink('');
            setMusicTitle('');
            setMusicError('');
        } catch (_) {
            setMusicError('Không lưu được bài hát. Hãy kiểm tra kết nối và thử lại.');
        } finally {
            if (isMounted.current) setIsUploading(false);
        }
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
            <View collapsable={false} style={[styles.participantTile, { width: participantTileWidth, height: participantTileHeight, backgroundColor: ['#78616e', '#39445e', '#51436a', '#385650'][index % 4] }, cameraEnabled && videoTrack && Platform.OS !== 'web' && styles.nativeVideoTile, isSpeaking && styles.speakingTile]}>
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
                ) : (
                    <NativeChannelVideo
                        key={videoKey}
                        debugId={String(item.id)}
                        streamURL={streamURL}
                        objectFit="cover"
                        mirror={isSelf}
                        onLayout={event => {
                            const key = String(item.id);
                            const { width, height } = event.nativeEvent.layout;
                            setNativeVideoLayouts(previous => {
                                const current = previous[key];
                                if (current?.streamURL === streamURL && current.width === width && current.height === height) return previous;
                                return { ...previous, [key]: { ...(current?.streamURL === streamURL ? current : {}), streamURL, width, height } };
                            });
                            console.log('[Camera] Kich thuoc RTCView:', {
                                userId: String(item.id),
                                isSelf,
                                ...event.nativeEvent.layout,
                            });
                        }}
                        onDimensionsChange={event => {
                            const key = String(item.id);
                            const { width: frameWidth, height: frameHeight } = event.nativeEvent;
                            setNativeVideoLayouts(previous => ({ ...previous, [key]: {
                                ...(previous[key]?.streamURL === streamURL ? previous[key] : {}), streamURL,
                                frameWidth, frameHeight,
                            } }));
                            console.log('[Camera] Kich thuoc frame:', {
                                userId: String(item.id),
                                isSelf,
                                streamURL,
                                ...event.nativeEvent,
                            });
                        }}
                    />
                ) : <View style={[styles.avatarRing, isSpeaking && styles.speakingRing]}>
                    <Avatar uri={item.avatarUrl} name={item.username} size={Math.min(width >= 700 ? 80 : 56, Math.max(32, participantTileHeight - 68))} />
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
    const displayedScreenStream = isScreenSharing ? screenShareStreamRef.current : screenShareStream;
    const displayedScreenOwner = isScreenSharing && screenShareStreamRef.current
        ? { ...screenShareOwner, id: String(currentUser.id), username: currentUser.username, pending: false }
        : screenShareOwner;
    const renderSharedScreen = () => (displayedScreenStream ? Platform.OS === 'web' ? <video autoPlay muted playsInline
        aria-label={'Màn hình của ' + displayedScreenOwner.username}
        ref={element => {
            if (element && element.srcObject !== displayedScreenStream) {
                element.srcObject = displayedScreenStream;
                element.play().catch(() => {});
            }
        }}
        style={{ position: 'absolute', width: '100%', height: '100%', objectFit: 'contain' }}
    /> : <NativeChannelVideo key={displayedScreenOwner.sessionId + ':' + displayedScreenStream.toURL()}
        debugId={'screen:' + displayedScreenOwner.id}
        streamURL={displayedScreenStream.toURL()} objectFit="contain" mirror={false}
        onDimensionsChange={event => console.info('[Chia sẻ] Frame native:', event.nativeEvent)}
    /> : <Text style={styles.screenShareWaiting}>Đang kết nối màn hình...</Text>);

    return (
        <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
            {Platform.OS === 'ios' && !isExpoGo && ScreenCapturePickerView && <ScreenCapturePickerView
                ref={screenCapturePickerRef} style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
            />}
            <View style={styles.callHeader}>
                <TouchableOpacity style={styles.headerBack} onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Quay lại, vẫn giữ kết nối kênh thoại">
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

            {displayedScreenOwner && !displayedScreenOwner.pending && <View style={[styles.screenSharePanel, { height: Math.max(150, Math.min(270, width * 9 / 16 + 40)) }]}>
                <View style={styles.screenShareHeading}>
                    <Ionicons name="desktop-outline" size={17} color="#9fefbc" />
                    <Text style={styles.screenShareTitle} numberOfLines={1}>{displayedScreenOwner.username || 'Một thành viên'} đang chia sẻ màn hình</Text>
                    <TouchableOpacity style={styles.screenShareExpandButton} onPress={() => setScreenShareExpanded(true)} accessibilityRole="button" accessibilityLabel="Phóng to màn hình chia sẻ">
                        <Ionicons name="expand-outline" size={20} color="#b9f3cd" /><Text style={styles.screenShareExpandText}>Phóng to</Text>
                    </TouchableOpacity>
                </View>
                <View style={styles.screenShareSurface} collapsable={false}>
                    {!screenShareExpanded && renderSharedScreen()}
                </View>
            </View>}

            <Modal visible={screenShareExpanded && !!displayedScreenOwner} animationType="fade" presentationStyle="fullScreen"
                supportedOrientations={['portrait', 'landscape']} onRequestClose={() => setScreenShareExpanded(false)}>
                <SafeAreaView style={styles.screenShareFullscreen}>
                    <View style={styles.screenShareFullscreenHeading}>
                        <Text style={styles.screenShareTitle} numberOfLines={1}>{displayedScreenOwner?.username || 'Một thành viên'} đang chia sẻ màn hình</Text>
                        <TouchableOpacity style={styles.headerBack} onPress={() => setScreenShareExpanded(false)} accessibilityRole="button" accessibilityLabel="Thu nhỏ màn hình chia sẻ">
                            <Ionicons name="contract-outline" size={25} color="#fff" />
                        </TouchableOpacity>
                    </View>
                    <View style={styles.screenShareSurface} collapsable={false}>{screenShareExpanded && displayedScreenOwner && renderSharedScreen()}</View>
                    {isScreenSharing && <TouchableOpacity style={styles.screenShareStopButton} onPress={() => stopScreenShare()} accessibilityRole="button" accessibilityLabel="Dừng chia sẻ màn hình">
                        <Text style={styles.screenShareStopText}>Dừng chia sẻ</Text>
                    </TouchableOpacity>}
                </SafeAreaView>
            </Modal>

            <View
                style={styles.callStage}
                onLayout={event => {
                    const { width: stageWidth, height: stageHeight } = event.nativeEvent.layout;
                    const nextWidth = Math.round(stageWidth);
                    const nextHeight = Math.round(stageHeight);
                    setVoiceStageLayout(previous => previous.width === nextWidth && previous.height === nextHeight
                        ? previous : { width: nextWidth, height: nextHeight });
                }}
            >
                <FlatList
                    style={styles.callStage}
                    contentContainerStyle={styles.stageContent}
                    data={isPreview ? [currentUser] : members}
                    key={`participants-${participantColumns}`}
                    numColumns={participantColumns}
                    renderItem={renderMember}
                    extraData={{ cameraStream, isCameraOff, remoteStreams, memberMediaStates, nativeVideoLayouts, participantTileWidth, participantTileHeight }}
                    removeClippedSubviews={false}
                    keyExtractor={item => String(item.id)}
                    ListEmptyComponent={<View style={styles.emptyCall}><Ionicons name="people-outline" size={48} color="#949ba4" /><Text style={styles.emptyCallText}>Đang chờ danh sách người tham gia...</Text></View>}
                />
            </View>

            <TouchableOpacity style={[styles.activityCard, isPreview && styles.disabledControl]} disabled={isPreview || connectionStatus !== 'CONNECTED'} onPress={() => setMusicPanelVisible(true)} accessibilityRole="button" accessibilityLabel="Mở nhạc trong kênh">
                <View style={styles.activityIcon}><Ionicons name="musical-notes" size={24} color="#b6a7ff" /></View>
                <View style={{ flex: 1 }}>
                    <Text style={styles.activityTitle}>Nghe nhạc cùng nhau</Text>
                    <Text style={styles.activityDescription} numberOfLines={1}>{isPreview ? 'Khả dụng khi kết nối kênh' : currentMusic.title || 'Mở danh sách và chọn bài hát'}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#b6a7ff" />
            </TouchableOpacity>

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
                    <TouchableOpacity style={[styles.callButton, !isCameraOff && styles.cameraActiveButton, (isPreview || isCameraChanging) && styles.disabledControl]} disabled={isPreview || isCameraChanging} onPress={toggleCamera} onLongPress={__DEV__ && Platform.OS !== 'web' ? showCameraDiagnostics : undefined} accessibilityRole="button" accessibilityLabel={isCameraOff ? 'Bật camera' : 'Tắt camera'}>
                        <Ionicons name={isCameraOff ? 'videocam-off' : 'videocam'} size={23} color="#f2f3f5" />
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.callButton, styles.screenShareButton, isScreenSharing && styles.cameraActiveButton, (isPreview || (isScreenShareChanging && !isIOSBroadcastWaiting) || connectionStatus !== 'CONNECTED') && styles.disabledControl]}
                        disabled={isPreview || (isScreenShareChanging && !isIOSBroadcastWaiting) || connectionStatus !== 'CONNECTED'}
                        onPress={toggleScreenShare}
                        accessibilityRole="button"
                        accessibilityLabel={isIOSBroadcastWaiting ? 'Hủy chia sẻ màn hình' : isScreenSharing ? 'Dừng chia sẻ màn hình' : 'Chia sẻ màn hình'}
                    >
                        <Ionicons name={isScreenSharing ? 'stop-circle-outline' : 'desktop-outline'} size={20} color="#f2f3f5" />
                        <Text style={styles.screenShareButtonText}>{isIOSBroadcastWaiting ? 'Hủy chia sẻ' : isScreenShareChanging ? 'Đang xử lý...' : isScreenSharing ? 'Dừng chia sẻ' : 'Chia sẻ'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.callButton, !isSpeakerOn && styles.mutedButton, isPreview && styles.disabledControl]} disabled={isPreview} onPress={toggleSpeaker} accessibilityRole="button" accessibilityLabel={isSpeakerOn ? 'Tắt âm thanh' : 'Bật âm thanh'}>
                        <Ionicons name={isSpeakerOn ? 'headset' : 'volume-mute'} size={23} color="#f2f3f5" />
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.callButton, styles.leaveButton]} onPress={leaveChannel} accessibilityRole="button" accessibilityLabel="Rời kênh thoại">
                        <Ionicons name="call" size={24} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
                    </TouchableOpacity>
                </View>
                {Platform.OS === 'android' && isScreenSharing && floatingControlsAllowed === false && <TouchableOpacity onPress={enableFloatingControls} accessibilityRole="button" accessibilityLabel="Cấp quyền hiển thị thanh điều khiển nổi">
                    <Text style={[styles.toolbarHint, { color: '#9fefbc' }]}>Bật thanh nổi · Hiện tại có thể dừng trong thông báo</Text>
                </TouchableOpacity>}
                {screenShareOwner && <Text style={styles.toolbarHint}>{screenShareOwner.username || 'Một thành viên'} đang chia sẻ màn hình</Text>}
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
                {musicLoading && <Text style={styles.musicHint}>Đang tải âm thanh...</Text>}
                {!!musicError && <Text style={styles.musicError}>{musicError}</Text>}
                <View
                    style={styles.musicSeekTouch}
                    accessibilityRole="adjustable"
                    accessibilityLabel="Tua nhạc cho cả kênh"
                    accessibilityValue={{ min: 0, max: Math.round(musicDuration), now: Math.round(musicPosition) }}
                    accessibilityActions={[{ name: 'increment', label: 'Tiến 10 giây' }, { name: 'decrement', label: 'Lùi 10 giây' }]}
                    onAccessibilityAction={event => seekMusic(musicPosition + (event.nativeEvent.actionName === 'increment' ? 10 : -10))}
                    onLayout={event => { musicSeekBar.current.width = event.nativeEvent.layout.width; }}
                    onStartShouldSetResponder={() => musicDuration > 0}
                    onMoveShouldSetResponder={() => musicDuration > 0}
                    onResponderGrant={event => {
                        const bar = musicSeekBar.current;
                        bar.dragging = true;
                        bar.startX = event.nativeEvent.pageX;
                        bar.startPosition = Math.max(0, Math.min(1, event.nativeEvent.locationX / (bar.width || 1))) * musicDuration;
                        bar.draft = bar.startPosition;
                        setMusicSeekDraft(bar.draft);
                    }}
                    onResponderMove={event => {
                        const bar = musicSeekBar.current;
                        bar.draft = Math.max(0, Math.min(musicDuration, bar.startPosition + (event.nativeEvent.pageX - bar.startX) / (bar.width || 1) * musicDuration));
                        setMusicSeekDraft(bar.draft);
                    }}
                    onResponderRelease={() => {
                        const bar = musicSeekBar.current;
                        if (bar.dragging) seekMusic(bar.draft);
                        bar.dragging = false;
                        setMusicSeekDraft(null);
                    }}
                    onResponderTerminate={() => { musicSeekBar.current.dragging = false; setMusicSeekDraft(null); }}
                >
                    <View pointerEvents="none" style={styles.musicSeekTrack}>
                        <View style={[styles.musicSeekFill, { width: String(Math.min(100, Math.max(0, (musicSeekDraft ?? musicPosition) / (musicDuration || 1) * 100))) + '%' }]} />
                    </View>
                </View>
                <View style={styles.musicTimeRow}>
                    <Text style={styles.musicHint}>{formatMusicTime(musicSeekDraft ?? musicPosition)}</Text>
                    <Text style={styles.musicHint}>{formatMusicTime(musicDuration)}</Text>
                </View>
                <View style={styles.controls}>
                    <TouchableOpacity style={styles.controlBtn} onPress={() => playNextSong(-1)} accessibilityLabel="Bài trước">
                        <Ionicons name="play-back" size={28} color="#fff" />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.mainPlayBtn} onPress={() => isMusicPlaying ? sendMusicControl('PAUSE') : sendMusicControl('PLAY')}>
                        <Ionicons name={isMusicPlaying ? "pause" : "play"} size={35} color="#fff" />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.controlBtn} onPress={() => playNextSong()}>
                        <Ionicons name="play-forward" size={28} color="#fff" />
                    </TouchableOpacity>
                </View>
                <View style={styles.musicOptions}>
                    <TouchableOpacity style={styles.musicOptionButton} onPress={() => seekMusic(musicPosition - 10)} accessibilityLabel="Lùi 10 giây"><Text style={styles.musicOptionText}>−10 giây</Text></TouchableOpacity>
                    <TouchableOpacity style={[styles.musicOptionButton, musicLoop && styles.cameraActiveButton]} onPress={() => sendMusicControl('LOOP', null, null, { loop: !musicLoopRef.current })} accessibilityLabel="Lặp một bài" accessibilityState={{ selected: musicLoop }}>
                        <Ionicons name="repeat" size={18} color="#fff" /><Text style={styles.musicOptionText}>{musicLoop ? 'Lặp một bài: Bật' : 'Lặp một bài: Tắt'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.musicOptionButton} onPress={() => seekMusic(musicPosition + 10)} accessibilityLabel="Tiến 10 giây"><Text style={styles.musicOptionText}>+10 giây</Text></TouchableOpacity>
                </View>
            </View>

            <View style={styles.playlistSection}>
                <View style={styles.playlistHeader}>
                    <Text style={styles.playlistTitle}>{isUploading ? 'Đang tải nhạc...' : `Danh sách bài hát (${playlist.length})`}</Text>
                    <View style={styles.headerActions}>
                        <TouchableOpacity onPress={addMusicToChannel} style={styles.actionIcon}><Ionicons name="cloud-upload" size={24} color="#43b581" /></TouchableOpacity>
                        <TouchableOpacity onPress={() => { setEditingMusic(null); setMusicTitle(''); setMusicLink(''); setMusicError(''); setLinkModalVisible(true); }} style={styles.actionIcon}><Ionicons name="link" size={24} color="#00b0f4" /></TouchableOpacity>
                    </View>
                </View>
                <FlatList
                    data={playlist}
                    keyExtractor={(item) => item.id.toString()}
                    renderItem={({ item }) => {
                        // Kiểm tra xem bài hát này có phải bài đang phát không
                        const isCurrent = currentMusic.url === (item.url.startsWith('http') ? item.url : BASE_URL_IMG + item.url);

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

                                    <TouchableOpacity style={styles.deleteBtn} onPress={() => {
                                        setEditingMusic(item);
                                        setMusicTitle(item.title);
                                        setMusicLink(item.url);
                                        setMusicError('');
                                        setLinkModalVisible(true);
                                    }} accessibilityLabel={'Sửa bài ' + item.title}>
                                        <Ionicons name="create-outline" size={20} color="#b6a7ff" />
                                    </TouchableOpacity>
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
                        <Text style={styles.modalTitle}>{editingMusic ? 'Sửa bài hát' : 'Thêm nhạc qua link'}</Text>
                        <Text style={styles.musicHint}>Dùng link âm thanh trực tiếp hoặc tải file bằng nút đám mây. Link trang Zing không phát trực tiếp được.</Text>
                        {!!musicError && <Text style={styles.musicError}>{musicError}</Text>}
                        <TextInput style={styles.modalInput} placeholder="Tên bài hát" placeholderTextColor="#72767d" value={musicTitle} onChangeText={setMusicTitle} />
                        <TextInput style={styles.modalInput} autoCapitalize="none" autoCorrect={false} placeholder="Link âm thanh trực tiếp" placeholderTextColor="#72767d" value={musicLink} onChangeText={setMusicLink} />
                        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                            <TouchableOpacity onPress={() => setLinkModalVisible(false)} style={styles.btnCancel}><Text style={{ color: 'white' }}>Hủy</Text></TouchableOpacity>
                            <TouchableOpacity disabled={isUploading} onPress={addMusicViaLink} style={[styles.btnAddLink, isUploading && styles.disabledControl]}><Text style={{ color: 'white', fontWeight: 'bold' }}>{isUploading ? 'Đang lưu...' : editingMusic ? 'Lưu' : 'Thêm'}</Text></TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, minHeight: 0, backgroundColor: '#0b0c0f' },
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
    callStage: { flex: 1, minHeight: 0, minWidth: 0 },
    stageContent: { flexGrow: 1, justifyContent: 'center', padding: 12, width: '100%', maxWidth: 1100, alignSelf: 'center' },
    participantTile: { margin: 6, borderRadius: 12, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
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
    activityCard: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#20122d', borderRadius: 12, marginHorizontal: 18, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: '#392443' },
    activityIcon: { backgroundColor: '#35214c', borderRadius: 10, padding: 8 },
    activityEyebrow: { color: '#a799bd', fontSize: 10, fontWeight: '700', letterSpacing: 1.2 },
    activityTitle: { color: '#f3ecff', fontSize: 14, fontWeight: '700' },
    activityDescription: { color: '#b4a7c5', fontSize: 11, lineHeight: 16, marginTop: 2 },
    callFooter: { alignItems: 'center', paddingHorizontal: 12, paddingTop: 12, paddingBottom: 10, borderTopWidth: 1, borderTopColor: '#202127' },
    connectionRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 12 },
    connectionDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#949ba4' },
    connectedDot: { backgroundColor: '#3ba55d' },
    connectionLabel: { color: '#b5bac1', fontSize: 12 },
    callToolbar: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
    callButton: { width: 48, height: 48, borderRadius: 14, backgroundColor: '#25262c', alignItems: 'center', justifyContent: 'center' },
    screenShareFullscreen: { flex: 1, backgroundColor: '#000' },
    screenShareFullscreenHeading: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, minHeight: 52 },
    screenShareExpandButton: { padding: 8, flexDirection: 'row', alignItems: 'center', gap: 4 },
    screenShareExpandText: { color: '#b9f3cd', fontSize: 12 },
    screenShareStopButton: { alignSelf: 'center', backgroundColor: '#ed4245', borderRadius: 10, margin: 12, paddingHorizontal: 22, paddingVertical: 12 },
    screenShareStopText: { color: '#fff', fontWeight: '600' },
    screenSharePanel: { flexShrink: 0, marginHorizontal: 18, marginTop: 10, borderWidth: 1, borderColor: '#315f45', borderRadius: 12, backgroundColor: '#111b15' },
    screenShareHeading: { height: 36, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10 },
    screenShareTitle: { flex: 1, color: '#b9f3cd', fontSize: 12, fontWeight: '600' },
    screenShareSurface: { flex: 1, minHeight: 0, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
    screenShareWaiting: { color: '#b5bac1', fontSize: 12 },
    screenShareButton: { width: 84, gap: 2 },
    screenShareButtonText: { color: '#f2f3f5', fontSize: 9, textAlign: 'center' },
    mutedButton: { backgroundColor: '#44212a' },
    cameraActiveButton: { backgroundColor: '#5865F2' },
    enableAudioButton: { backgroundColor: '#5865F2', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 12, marginBottom: 10 },
    disabledControl: { opacity: 0.55 },
    leaveButton: { width: 58, backgroundColor: '#ed4245' },
    toolbarHint: { color: '#949ba4', fontSize: 10, lineHeight: 15, textAlign: 'center', marginTop: 10 },
    musicPanel: { flex: 1, backgroundColor: '#202225' },
    musicPanelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8 },
    musicHint: { color: '#b5bac1', fontSize: 12, lineHeight: 18 },
    musicError: { color: '#ff8b94', fontSize: 12, lineHeight: 18, marginVertical: 8 },
    musicSeekTouch: { height: 36, justifyContent: 'center', marginTop: 8 },
    musicSeekTrack: { height: 6, backgroundColor: '#404249', borderRadius: 3, overflow: 'hidden' },
    musicSeekFill: { height: 6, backgroundColor: '#8b7aff', borderRadius: 3 },
    musicTimeRow: { flexDirection: 'row', justifyContent: 'space-between' },
    musicOptions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 12 },
    musicOptionButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 9, backgroundColor: '#30323a', borderRadius: 8 },
    musicOptionText: { color: '#fff', fontSize: 12 },
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
