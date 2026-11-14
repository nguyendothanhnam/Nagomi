import { useFocusEffect } from '@react-navigation/native';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import VoiceChannelScreen from '../screens/VoiceChannelScreen';

const VoiceSessionContext = createContext(null);
export const useVoiceSession = () => useContext(VoiceSessionContext);

// Route chỉ điều khiển việc hiện màn hình; phiên WebRTC được giữ ở ngoài stack.
export function VoiceChannelRoute({ route, navigation }) {
    const { open, hide } = useVoiceSession();
    useFocusEffect(useCallback(() => {
        open(route.params, navigation);
        return hide;
    }, [open, hide, route.params, navigation]));
    return <View style={{ flex: 1, backgroundColor: '#0b0c0f' }} />;
}

export default function VoiceSessionHost({ children }) {
    const [session, setSession] = useState(null);
    const [visible, setVisible] = useState(false);
    const visibleRef = useRef(false);
    visibleRef.current = visible;
    const open = useCallback((params, navigation) => {
        setSession(previous => ({ params: previous && String(previous.params.channelId) === String(params.channelId)
            && String(previous.params.currentUser.id) === String(params.currentUser.id) ? previous.params : params, navigation }));
        setVisible(true);
    }, []);
    const hide = useCallback(() => setVisible(false), []);
    const close = useCallback(() => { setSession(null); setVisible(false); }, []);
    const navigation = useMemo(() => session ? {
        ...session.navigation,
        // Nút rời trên thanh phiên đang gọi không thay đổi trang người dùng đang xem.
        canGoBack: () => !visibleRef.current || session.navigation.canGoBack(),
        goBack: () => { if (visibleRef.current) session.navigation.goBack(); },
        replace: (...args) => { if (visibleRef.current) session.navigation.replace(...args); },
    } : null, [session?.navigation]);
    return <VoiceSessionContext.Provider value={{ session: session?.params, open, hide, close }}>
        <View style={{ flex: 1 }}>
            {children}
            {session && <View style={[StyleSheet.absoluteFill, { display: visible ? 'flex' : 'none', zIndex: 100 }]}>
                <VoiceChannelScreen key={String(session.params.channelId) + ':' + session.params.currentUser.id}
                    route={{ params: session.params }} navigation={navigation} onLeave={close} />
            </View>}
        </View>
    </VoiceSessionContext.Provider>;
}
