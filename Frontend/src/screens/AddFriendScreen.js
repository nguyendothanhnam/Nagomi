import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsFocused } from '@react-navigation/native';
import { debounce } from 'lodash';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator, Alert, FlatList, Platform, ScrollView, StyleSheet,
    Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Avatar from '../components/Avatar';
import UserService from '../services/UserService';

const TABS = [
    { id: 'search', label: 'Tìm kiếm' },
    { id: 'sent', label: 'Đã gửi' },
    { id: 'received', label: 'Chờ xác nhận' },
    { id: 'blocked', label: 'Bị chặn' },
];

export default function AddFriendScreen({ navigation }) {
    const [myId, setMyId] = useState(null);
    const [searchText, setSearchText] = useState('');
    const [results, setResults] = useState([]);
    const [suggestions, setSuggestions] = useState([]);
    const [requests, setRequests] = useState([]);
    const [activeTab, setActiveTab] = useState('search');
    const [loading, setLoading] = useState(false);
    const isFocused = useIsFocused();
    const searchSequence = useRef(0);

    useEffect(() => {
        AsyncStorage.getItem('userId').then(setMyId).catch(console.error);
    }, []);

    const searchUsers = useCallback(async (text) => {
        const sequence = ++searchSequence.current;
        if (!text.trim() || !myId) {
            setResults([]);
            return;
        }
        setLoading(true);
        try {
            const data = await UserService.searchUsers(myId, text.trim());
            if (sequence === searchSequence.current) setResults(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('User search failed:', error);
        } finally {
            if (sequence === searchSequence.current) setLoading(false);
        }
    }, [myId]);

    const debouncedSearch = useMemo(() => debounce(searchUsers, 400), [searchUsers]);
    useEffect(() => () => debouncedSearch.cancel(), [debouncedSearch]);

    const loadSuggestions = useCallback(async () => {
        if (!myId) return;
        try {
            const data = await UserService.searchUsers(myId, '');
            setSuggestions((Array.isArray(data) ? data : []).filter(user => user.friendStatus === 'NONE').slice(0, 6));
        } catch (error) {
            console.error('Could not load friend suggestions:', error);
        }
    }, [myId]);

    const loadRequests = useCallback(async () => {
        if (!myId) return;
        const loader = activeTab === 'sent' ? UserService.getSentRequests : UserService.getPendingRequests;
        setLoading(true);
        try {
            const data = await loader(myId);
            setRequests(Array.isArray(data) ? data : []);
        } finally {
            setLoading(false);
        }
    }, [activeTab, myId]);

    useEffect(() => {
        if (!isFocused || !myId) return;
        loadSuggestions();
        if (activeTab === 'sent' || activeTab === 'received') loadRequests();
    }, [activeTab, isFocused, loadRequests, loadSuggestions, myId]);

    // Keep relationship badges current while the search screen is open on another device.
    useEffect(() => {
        if (!isFocused || !myId || activeTab !== 'search' || !searchText.trim()) return undefined;
        const interval = setInterval(() => searchUsers(searchText), 4000);
        return () => clearInterval(interval);
    }, [activeTab, isFocused, myId, searchText, searchUsers]);

    const handleTextChange = (text) => {
        setSearchText(text);
        if (!text.trim()) {
            debouncedSearch.cancel();
            searchSequence.current += 1;
            setResults([]);
            setLoading(false);
            return;
        }
        if (myId) debouncedSearch(text);
    };

    const notify = (title, message) => {
        if (Platform.OS === 'web') window.alert(`${title}\n\n${message}`);
        else Alert.alert(title, message);
    };

    const handleSendRequest = async (target) => {
        try {
            const result = await UserService.addFriend(myId, target.username);
            notify('Thông báo', typeof result === 'string' ? result : `Đã gửi lời mời tới ${target.username}.`);
            if (searchText.trim()) await searchUsers(searchText);
            await loadSuggestions();
        } catch (error) {
            notify('Lỗi', error.response?.data || 'Không thể gửi lời mời.');
        }
    };

    const handleAcceptRequest = async (requestId) => {
        try {
            await UserService.acceptRequest(requestId);
            await loadRequests();
            await loadSuggestions();
        } catch (error) {
            notify('Lỗi', error.response?.data || 'Không thể chấp nhận lời mời.');
        }
    };

    const handleCancelRequest = async (requestId) => {
        try {
            await UserService.cancelRequest(requestId);
            await loadRequests();
            await loadSuggestions();
        } catch (error) {
            notify('Lỗi', error.response?.data || 'Không thể hủy lời mời.');
        }
    };

    const renderRelationAction = (item) => {
        if (item.friendStatus === 'FRIENDS') {
            return <View style={[styles.actionButton, styles.friendButton]}><Ionicons name="checkmark" size={19} color="white" /></View>;
        }
        if (item.friendStatus === 'REQUEST_SENT') {
            return <View style={[styles.actionButton, styles.sentButton]}><Ionicons name="time-outline" size={18} color="white" /></View>;
        }
        if (item.friendStatus === 'REQUEST_RECEIVED') {
            return <TouchableOpacity accessibilityLabel="Chấp nhận lời mời" style={[styles.actionButton, styles.addButton]} onPress={() => handleAcceptRequest(item.friendRequestId)}>
                <Ionicons name="checkmark" size={19} color="white" />
            </TouchableOpacity>;
        }
        return <TouchableOpacity accessibilityLabel={`Thêm ${item.username}`} style={[styles.actionButton, styles.addButton]} onPress={() => handleSendRequest(item)}>
            <Ionicons name="person-add" size={18} color="white" />
        </TouchableOpacity>;
    };

    const renderUser = ({ item }) => (
        <View style={styles.userItem}>
            <View style={styles.avatarWrap}>
                <Avatar uri={item.avatarUrl} name={item.username} size={42} />
                <View style={styles.onlineDot} />
            </View>
            <View style={styles.userInfo}>
                <Text style={styles.userName}>{item.username}</Text>
                <Text style={styles.mutualText}>
                    {item.friendStatus === 'FRIENDS' ? 'Đã là bạn bè'
                        : item.friendStatus === 'REQUEST_SENT' ? 'Đã gửi lời mời'
                            : item.friendStatus === 'REQUEST_RECEIVED' ? 'Đang chờ bạn xác nhận'
                                : item.mutualFriends > 0 ? `${item.mutualFriends} bạn chung` : 'Chưa có bạn chung'}
                </Text>
            </View>
            {renderRelationAction(item)}
        </View>
    );

    const renderRequest = ({ item }) => {
        const person = activeTab === 'sent' ? item.receiver : item.sender;
        if (!person) return null;
        return (
            <View style={styles.userItem}>
                <Avatar uri={person.avatarUrl} name={person.username} size={42} />
                <View style={styles.userInfo}>
                    <Text style={styles.userName}>{person.username}</Text>
                    <Text style={styles.mutualText}>{activeTab === 'sent' ? 'Đang chờ phản hồi' : 'Muốn kết bạn với bạn'}</Text>
                </View>
                {activeTab === 'received' && <TouchableOpacity style={[styles.actionButton, styles.acceptButton]} onPress={() => handleAcceptRequest(item.id)}>
                    <Ionicons name="checkmark" size={19} color="white" />
                </TouchableOpacity>}
                <TouchableOpacity style={[styles.actionButton, styles.cancelButton]} onPress={() => handleCancelRequest(item.id)}>
                    <Ionicons name={activeTab === 'sent' ? 'close' : 'close'} size={18} color="white" />
                </TouchableOpacity>
            </View>
        );
    };

    const emptySearch = searchText.trim().length === 0;
    return (
        <View style={styles.container}>
            <View style={styles.pageHeader}>
                <TouchableOpacity accessibilityLabel="Quay lại" style={styles.backButton} onPress={() => navigation.goBack()}>
                    <Ionicons name="arrow-back" size={22} color="#f4f4f5" />
                </TouchableOpacity>
                <View style={styles.brandMark}><Ionicons name="game-controller" size={18} color="#a5f3d3" /><Text style={styles.brandFlower}>✿</Text></View>
                <Text style={styles.pageTitle}>Thêm bạn bè</Text>
                <View style={styles.headerActions}>
                    <TouchableOpacity style={styles.headerIcon}><Ionicons name="notifications" size={19} color="#b9bbbe" /></TouchableOpacity>
                    <TouchableOpacity style={styles.headerIcon}><Ionicons name="chatbox-ellipses" size={19} color="#b9bbbe" /></TouchableOpacity>
                    <TouchableOpacity style={styles.headerIcon}><Ionicons name="settings-sharp" size={19} color="#b9bbbe" /></TouchableOpacity>
                </View>
            </View>
            <View style={styles.tabs}>
                {TABS.map(tab => (
                    <TouchableOpacity key={tab.id} style={[styles.tab, activeTab === tab.id && styles.activeTab]} onPress={() => setActiveTab(tab.id)}>
                        <Text style={[styles.tabText, activeTab === tab.id && styles.activeTabText]}>{tab.label}</Text>
                    </TouchableOpacity>
                ))}
            </View>

            {activeTab === 'search' ? (
                <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.searchContent}>
                    <View style={styles.searchCard}>
                        <Text style={styles.eyebrow}>TÌM KIẾM BẰNG TÊN ĐĂNG NHẬP</Text>
                        <View style={styles.searchRow}>
                            <View style={styles.searchBox}>
                                <Ionicons name="search" size={17} color="#9ba0aa" />
                                <TextInput style={styles.searchInput} placeholder="Tìm kiếm bằng tên đăng nhập (ví dụ: nagomi#1234)" placeholderTextColor="#81858e" value={searchText} onChangeText={handleTextChange} autoCapitalize="none" autoCorrect={false} />
                                {!!searchText && <TouchableOpacity onPress={() => handleTextChange('')}><Ionicons name="close-circle" size={18} color="#9ba0aa" /></TouchableOpacity>}
                            </View>
                            <TouchableOpacity style={styles.searchButton} onPress={() => searchUsers(searchText)}>
                                <Text style={styles.searchButtonText}>Tìm kiếm</Text>
                            </TouchableOpacity>
                        </View>
                        {loading && <ActivityIndicator color="#8792ff" style={{ marginTop: 14 }} />}
                        {!loading && !emptySearch && results.length === 0 && (
                            <View style={styles.emptyState}>
                                <Text style={styles.emptyEmoji}>🔎</Text>
                                <Text style={styles.emptyTitle}>Không có ai ở đây cả...</Text>
                                <Text style={styles.emptyTitle}>Hãy kết nối với những người bạn mới!</Text>
                                <Text style={styles.emptyDescription}>Bạn có thể thêm bạn bằng cách sử dụng tên đăng nhập Nagomi của họ.</Text>
                            </View>
                        )}
                        {!loading && !emptySearch && results.length > 0 && <View style={styles.resultsList}>{results.map(user => <View key={String(user.id)}>{renderUser({ item: user })}</View>)}</View>}
                    </View>

                    {emptySearch && <>
                        <Text style={styles.sectionHeading}>GỢI Ý KẾT BẠN</Text>
                        {suggestions.slice(0, 3).map(user => <View key={`suggested-${user.id}`} style={styles.suggestionCard}>{renderUser({ item: user })}</View>)}
                        {suggestions.length === 0 && <Text style={styles.hintText}>Chưa có gợi ý. Hãy tìm tên đăng nhập để kết nối nhé.</Text>}
                        {suggestions.length > 3 && <>
                            <Text style={[styles.sectionHeading, styles.recentHeading]}>BẠN BÈ GẦN ĐÂY</Text>
                            {suggestions.slice(3).map(user => <View key={`recent-${user.id}`} style={styles.suggestionCard}>{renderUser({ item: user })}</View>)}
                        </>}
                    </>}
                </ScrollView>
            ) : activeTab === 'blocked' ? (
                <View style={styles.tabEmpty}><Ionicons name="shield-checkmark-outline" size={38} color="#7d8290" /><Text style={styles.emptyTitle}>Danh sách chặn đang trống</Text><Text style={styles.emptyDescription}>Người bạn chặn sẽ xuất hiện ở đây.</Text></View>
            ) : (
                <FlatList data={requests} keyExtractor={item => String(item.id)} renderItem={renderRequest} contentContainerStyle={requests.length === 0 ? styles.requestEmptyList : undefined}
                    ListEmptyComponent={<View style={styles.tabEmpty}><Ionicons name={activeTab === 'sent' ? 'paper-plane-outline' : 'people-outline'} size={38} color="#7d8290" /><Text style={styles.emptyTitle}>{activeTab === 'sent' ? 'Chưa gửi lời mời nào' : 'Bạn đã xem hết lời mời'}</Text><Text style={styles.emptyDescription}>Các lời mời kết bạn sẽ hiển thị tại đây.</Text></View>} />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#202124' },
    pageHeader: { minHeight: 54, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#151619' },
    backButton: { width: 34, height: 36, justifyContent: 'center', marginRight: 8 },
    brandMark: { width: 30, height: 30, borderRadius: 10, backgroundColor: '#35363b', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
    brandFlower: { color: '#f3a8ca', position: 'absolute', top: -6, right: -2, fontSize: 15 },
    pageTitle: { color: '#f4f4f5', fontSize: 18, fontWeight: '700', flex: 1 },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    headerIcon: { padding: 4 },
    tabs: { flexDirection: 'row', paddingHorizontal: 24, borderBottomWidth: 1, borderBottomColor: '#36373c', gap: 4 },
    tab: { paddingHorizontal: 12, paddingVertical: 13, borderBottomWidth: 2, borderBottomColor: 'transparent' },
    activeTab: { borderBottomColor: '#a9d7dc' },
    tabText: { color: '#a3a5ad', fontSize: 13 },
    activeTabText: { color: '#f0f1f3', fontWeight: '600' },
    searchContent: { padding: 16, paddingBottom: 32 },
    searchCard: { borderColor: '#4a4b52', borderWidth: 1, borderRadius: 10, padding: 14, backgroundColor: '#222327' },
    eyebrow: { color: '#aaaeb8', fontSize: 10, fontWeight: '700', marginBottom: 8 },
    searchRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
    searchBox: { flex: 1, minHeight: 42, borderWidth: 1, borderColor: '#9f77aa', borderRadius: 9, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1c1d20' },
    searchInput: { flex: 1, minWidth: 0, paddingVertical: 8, color: '#f3f4f6', fontSize: 13 },
    searchButton: { backgroundColor: '#6971e8', borderRadius: 9, minHeight: 40, justifyContent: 'center', paddingHorizontal: 13 },
    searchButtonText: { color: 'white', fontWeight: '600', fontSize: 12 },
    emptyState: { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 12 },
    emptyEmoji: { fontSize: 58, marginBottom: 8 },
    emptyTitle: { color: '#e5e6e9', fontWeight: '700', textAlign: 'center', fontSize: 14, marginTop: 5 },
    emptyDescription: { color: '#999ca5', textAlign: 'center', fontSize: 12, marginTop: 7, lineHeight: 18 },
    sectionHeading: { color: '#a8abb4', fontWeight: '700', fontSize: 10, marginTop: 21, marginBottom: 8, paddingHorizontal: 2 },
    recentHeading: { marginTop: 18 },
    suggestionCard: { backgroundColor: '#292a2f', borderRadius: 9, marginBottom: 6, overflow: 'hidden' },
    userItem: { minHeight: 62, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#35363b' },
    avatarWrap: { position: 'relative' },
    onlineDot: { position: 'absolute', right: -1, bottom: 0, width: 11, height: 11, borderRadius: 6, backgroundColor: '#4bc18a', borderWidth: 2, borderColor: '#292a2f' },
    userInfo: { flex: 1, marginLeft: 11 },
    userName: { color: '#f0f1f3', fontSize: 14, fontWeight: '600' },
    mutualText: { color: '#a4a6ae', fontSize: 12, marginTop: 3 },
    actionButton: { width: 38, height: 34, borderRadius: 7, alignItems: 'center', justifyContent: 'center', marginLeft: 7 },
    addButton: { backgroundColor: '#6872e8' },
    friendButton: { backgroundColor: '#399b72' },
    sentButton: { backgroundColor: '#4b4d55' },
    acceptButton: { backgroundColor: '#399b72' },
    cancelButton: { backgroundColor: '#42444b' },
    resultsList: { marginTop: 14, borderRadius: 8, overflow: 'hidden' },
    hintText: { color: '#999ca5', fontSize: 12, padding: 12 },
    tabEmpty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },
    requestEmptyList: { flexGrow: 1 },
});
