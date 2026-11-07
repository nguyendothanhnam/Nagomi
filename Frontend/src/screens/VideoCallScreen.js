import { useEffect, useRef, useState } from 'react';
import { Alert, Platform, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { isRunningInExpoGo } from 'expo';
import Avatar from '../components/Avatar';

// Expo Go và bản web không có các module native phục vụ cuộc gọi.
const isExpoGo = isRunningInExpoGo();
const webrtc = Platform.OS === 'web' || isExpoGo ? {} : require('react-native-webrtc');
const { mediaDevices, RTCPeerConnection, RTCIceCandidate, RTCSessionDescription, RTCView } = webrtc;
const InCallManager = Platform.OS === 'web' || isExpoGo ? null : require('react-native-incall-manager').default;

export default function VideoCallScreen({ route, navigation }) {
    const { myId, myUsername, friendId, friendUsername, friendAvatarUrl, isCaller } = route.params;
    const [localStream, setLocalStream] = useState(null);
    const [remoteStream, setRemoteStream] = useState(null);
    const [isMicMuted, setIsMicMuted] = useState(false);
    const [isCameraOff, setIsCameraOff] = useState(false);
    const [isFrontCamera, setIsFrontCamera] = useState(true);
    const [isSpeakerOn, setIsSpeakerOn] = useState(true);
    const [callStatus, setCallStatus] = useState('Đang kết nối...');

    const localStreamRef = useRef(null);
    const peerRef = useRef(null);
    const subscriptionRef = useRef(null);
    const pendingIceCandidates = useRef([]);
    const endedRef = useRef(false);
    const shouldSendEnd = useRef(true);
    const callTimerRef = useRef(null);

    const sendSignal = (type, extra = {}) => {
        const client = global.stompClient;
        if (!client?.connected) return false;
        client.send('/app/call.signal', {}, JSON.stringify({
            type,
            fromUserId: myId,
            toUserId: friendId,
            fromUsername: myUsername,
            fromAvatarUrl: null,
            ...extra,
        }));
        return true;
    };

    const flushIceCandidates = async (peer) => {
        const candidates = pendingIceCandidates.current.splice(0);
        for (const candidate of candidates) {
            try {
                await peer.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (error) {
                console.log('Không thể thêm ICE candidate đang chờ:', error.message);
            }
        }
    };

    const createPeer = () => {
        if (peerRef.current) return peerRef.current;
        const peer = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                // Thêm TURN của bạn ở đây khi đã dựng coturn:
                // { urls: 'turn:turn.example.com:3478', username: 'user', credential: 'password' },
            ],
        });
        localStreamRef.current?.getTracks().forEach(track => peer.addTrack(track, localStreamRef.current));
        peer.onicecandidate = event => {
            if (event.candidate) sendSignal('ICE_CANDIDATE', { candidate: event.candidate.toJSON() });
        };
        peer.ontrack = event => {
            const stream = event.streams?.[0];
            if (stream) setRemoteStream(stream);
        };
        peer.onconnectionstatechange = () => {
            if (peer.connectionState === 'connected') setCallStatus('Đang gọi');
            if (peer.connectionState === 'failed') setCallStatus('Kết nối thất bại');
        };
        peerRef.current = peer;
        return peer;
    };

    const handleSignal = async (signal) => {
        if (String(signal.fromUserId) !== String(friendId) || String(signal.toUserId) !== String(myId)) return;

        if (signal.type === 'CALL_ACCEPT' && isCaller) {
            if (callTimerRef.current) clearTimeout(callTimerRef.current);
            setCallStatus('Đang thiết lập cuộc gọi...');
            try {
                const peer = createPeer();
                const offer = await peer.createOffer();
                await peer.setLocalDescription(offer);
                sendSignal('OFFER', { sdp: offer });
            } catch (error) {
                Alert.alert('Không thể bắt đầu cuộc gọi', error.message);
                endCall();
            }
            return;
        }

        if (signal.type === 'CALL_REJECT') {
            shouldSendEnd.current = false;
            endedRef.current = true;
            if (callTimerRef.current) clearTimeout(callTimerRef.current);
            cleanupCall();
            Alert.alert('Cuộc gọi bị từ chối', signal.reason || 'Bạn của bạn hiện không thể nghe máy.');
            navigation.goBack();
            return;
        }

        if (signal.type === 'CALL_END') {
            shouldSendEnd.current = false;
            endedRef.current = true;
            cleanupCall();
            navigation.goBack();
            return;
        }

        try {
            if (signal.type === 'OFFER' && signal.sdp) {
                const peer = createPeer();
                await peer.setRemoteDescription(new RTCSessionDescription(signal.sdp));
                await flushIceCandidates(peer);
                const answer = await peer.createAnswer();
                await peer.setLocalDescription(answer);
                sendSignal('ANSWER', { sdp: answer });
                setCallStatus('Đang kết nối...');
            } else if (signal.type === 'ANSWER' && signal.sdp && peerRef.current) {
                await peerRef.current.setRemoteDescription(new RTCSessionDescription(signal.sdp));
                await flushIceCandidates(peerRef.current);
                setCallStatus('Đang kết nối...');
            } else if (signal.type === 'ICE_CANDIDATE' && signal.candidate) {
                if (peerRef.current?.remoteDescription) {
                    await peerRef.current.addIceCandidate(new RTCIceCandidate(signal.candidate));
                } else {
                    pendingIceCandidates.current.push(signal.candidate);
                }
            }
        } catch (error) {
            console.log('Lỗi xử lý tín hiệu cuộc gọi:', error.message);
        }
    };

    const cleanupCall = () => {
        if (callTimerRef.current) clearTimeout(callTimerRef.current);
        callTimerRef.current = null;
        try { subscriptionRef.current?.unsubscribe(); } catch (_) { }
        subscriptionRef.current = null;
        if (peerRef.current) {
            peerRef.current.onicecandidate = null;
            peerRef.current.ontrack = null;
            peerRef.current.onconnectionstatechange = null;
            peerRef.current.close();
            peerRef.current = null;
        }
        localStreamRef.current?.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
        setLocalStream(null);
        setRemoteStream(null);
        pendingIceCandidates.current = [];
        try { InCallManager?.stop(); } catch (_) { }
        if (global.activeVideoCall && String(global.activeVideoCall.friendId) === String(friendId)) {
            global.activeVideoCall = null;
        }
    };

    const endCall = () => {
        if (endedRef.current) return;
        endedRef.current = true;
        if (shouldSendEnd.current) sendSignal('CALL_END');
        cleanupCall();
        navigation.goBack();
    };

    useEffect(() => {
        if (isExpoGo) {
            Alert.alert('Cần bản development build', 'Expo Go không hỗ trợ gọi video bằng WebRTC. Bạn vẫn có thể dùng các màn hình khác.');
            endCall();
            return undefined;
        }
        if (Platform.OS === 'web') {
            setCallStatus('Gọi video chỉ hỗ trợ trên ứng dụng di động.');
            return undefined;
        }
        const client = global.stompClient;
        if (!client?.connected) {
            if (global.activeVideoCall && String(global.activeVideoCall.friendId) === String(friendId)) {
                global.activeVideoCall = null;
            }
            Alert.alert('Mất kết nối', 'Kết nối chat chưa sẵn sàng. Hãy quay lại và thử lại.');
            navigation.goBack();
            return undefined;
        }

        subscriptionRef.current = client.subscribe(`/topic/call.${myId}`, message => {
            try { handleSignal(JSON.parse(message.body)); } catch (error) { console.log(error.message); }
        });

        if (isCaller) {
            callTimerRef.current = setTimeout(() => {
                if (!endedRef.current) {
                    Alert.alert('Không có phản hồi', 'Cuộc gọi đã kết thúc sau 30 giây.');
                    endCall();
                }
            }, 30000);
        }

        const startCall = async () => {
            try {
                const stream = await mediaDevices.getUserMedia({ audio: true, video: { facingMode: 'user' } });
                if (endedRef.current) {
                    stream.getTracks().forEach(track => track.stop());
                    return;
                }
                localStreamRef.current = stream;
                setLocalStream(stream);
                InCallManager.start({ media: 'video' });
                InCallManager.setForceSpeakerphoneOn(true);
                InCallManager.setSpeakerphoneOn?.(true);
                if (!isCaller) sendSignal('CALL_ACCEPT');
                setCallStatus(isCaller ? 'Đang đổ chuông...' : 'Đang kết nối...');
            } catch (error) {
                Alert.alert('Không thể mở camera hoặc micro', 'Hãy cấp quyền camera và micro trong cài đặt ứng dụng.');
                shouldSendEnd.current = true;
                endCall();
            }
        };
        startCall();

        return () => {
            if (!endedRef.current && shouldSendEnd.current) sendSignal('CALL_END');
            endedRef.current = true;
            cleanupCall();
        };
    }, []);

    const toggleMic = () => {
        const nextMuted = !isMicMuted;
        localStreamRef.current?.getAudioTracks().forEach(track => { track.enabled = !nextMuted; });
        setIsMicMuted(nextMuted);
    };

    const toggleCamera = () => {
        const nextOff = !isCameraOff;
        localStreamRef.current?.getVideoTracks().forEach(track => { track.enabled = !nextOff; });
        setIsCameraOff(nextOff);
    };

    const switchCamera = () => {
        localStreamRef.current?.getVideoTracks().forEach(track => track._switchCamera?.());
        setIsFrontCamera(value => !value);
    };

    const toggleSpeaker = () => {
        const nextOn = !isSpeakerOn;
        try {
            InCallManager?.setForceSpeakerphoneOn(nextOn);
            InCallManager?.setSpeakerphoneOn?.(nextOn);
        } catch (_) { }
        setIsSpeakerOn(nextOn);
    };

    return (
        <View style={styles.container}>
            <StatusBar barStyle="light-content" backgroundColor="#000" />
            {remoteStream ? (
                <RTCView streamURL={remoteStream.toURL()} style={styles.remoteVideo} objectFit="cover" />
            ) : (
                <View style={styles.waitingView}>
                    <Avatar uri={friendAvatarUrl} name={friendUsername} size={104} />
                    <Text style={styles.friendName}>{friendUsername}</Text>
                    <Text style={styles.callStatus}>{callStatus}</Text>
                </View>
            )}
            {localStream && !isCameraOff && (
                <RTCView streamURL={localStream.toURL()} style={styles.localVideo} objectFit="cover" mirror={isFrontCamera} />
            )}
            <View style={styles.topBar}>
                <Text style={styles.topName}>{friendUsername}</Text>
                <Text style={styles.topStatus}>{callStatus}</Text>
            </View>
            <View style={styles.controls}>
                <TouchableOpacity style={[styles.controlButton, isMicMuted && styles.controlOff]} onPress={toggleMic}>
                    <Ionicons name={isMicMuted ? 'mic-off' : 'mic'} size={23} color="white" />
                </TouchableOpacity>
                <TouchableOpacity style={[styles.controlButton, isCameraOff && styles.controlOff]} onPress={toggleCamera}>
                    <Ionicons name={isCameraOff ? 'videocam-off' : 'videocam'} size={23} color="white" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.controlButton} onPress={switchCamera}>
                    <Ionicons name="camera-reverse" size={23} color="white" />
                </TouchableOpacity>
                <TouchableOpacity style={[styles.controlButton, !isSpeakerOn && styles.controlOff]} onPress={toggleSpeaker}>
                    <Ionicons name={isSpeakerOn ? 'volume-high' : 'volume-mute'} size={23} color="white" />
                </TouchableOpacity>
                <TouchableOpacity style={[styles.controlButton, styles.endButton]} onPress={endCall}>
                    <Ionicons name="call" size={23} color="white" />
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#202225' },
    remoteVideo: { ...StyleSheet.absoluteFillObject },
    waitingView: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2f3136' },
    friendName: { color: 'white', fontSize: 22, fontWeight: '700', marginTop: 18 },
    callStatus: { color: '#b9bbbe', fontSize: 15, marginTop: 8 },
    topBar: { position: 'absolute', top: 54, alignSelf: 'center', alignItems: 'center' },
    topName: { color: 'white', fontSize: 18, fontWeight: '700' },
    topStatus: { color: '#dcddde', fontSize: 13, marginTop: 4 },
    localVideo: { position: 'absolute', top: 104, right: 16, width: 112, height: 158, borderRadius: 12, overflow: 'hidden', backgroundColor: '#202225' },
    controls: { position: 'absolute', bottom: 38, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 13 },
    controlButton: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#4f545c', alignItems: 'center', justifyContent: 'center' },
    controlOff: { backgroundColor: '#ed4245' },
    endButton: { backgroundColor: '#ed4245', width: 62, height: 62, borderRadius: 31, transform: [{ rotate: '135deg' }] },
});
