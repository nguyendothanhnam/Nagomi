import AsyncStorage from '@react-native-async-storage/async-storage';
import { debounce } from 'lodash';
import { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator, Alert,
    FlatList,
    StyleSheet,
    Text, TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import Avatar from '../components/Avatar';
import UserService from '../services/UserService';

export default function AddFriendScreen({ navigation }) {
    const [myId, setMyId] = useState(null);
    const [searchText, setSearchText] = useState('');
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const getMyId = async () => {
            const id = await AsyncStorage.getItem('userId');
            setMyId(id);
        };
        getMyId();
    }, []);

    // Hàm gọi API tìm kiếm
    const searchUsers = async (text) => {
        if (!text.trim()) {
            setResults([]);
            return;
        }
        setLoading(true);
        try {
            // Lưu ý: Bạn cần cập nhật UserService.searchUsers để gọi API tìm kiếm mới ở Backend
            const data = await UserService.searchUsers(myId, text.trim());
            setResults(data);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    // Sử dụng debounce để giảm tải cho server (đợi 500ms sau khi ngừng gõ mới gọi API)
    const debouncedSearch = useRef(debounce((text) => searchUsers(text), 500)).current;

    const handleTextChange = (text) => {
        setSearchText(text);
        debouncedSearch(text);
    };

    const handleSendRequest = async (targetUsername) => {
        try {
            const result = await UserService.addFriend(myId, targetUsername);
            Alert.alert("Thành công", `Đã gửi lời mời tới ${targetUsername}`);
        } catch (error) {
            Alert.alert("Lỗi", error.response?.data || "Không thể gửi lời mời.");
        }
    };

    return (
        <View style={styles.container}>
            <View style={styles.searchHeader}>
                <Ionicons name="search" size={20} color="#b9bbbe" style={styles.searchIcon} />
                <TextInput
                    style={styles.input}
                    placeholder="Tìm kiếm bằng tên đăng nhập..."
                    placeholderTextColor="#72767d"
                    value={searchText}
                    onChangeText={handleTextChange}
                    autoCapitalize="none"
                    autoFocus={true}
                />
                {searchText !== '' && (
                    <TouchableOpacity onPress={() => handleTextChange('')}>
                        <Ionicons name="close-circle" size={20} color="#b9bbbe" />
                    </TouchableOpacity>
                )}
            </View>

            {loading ? (
                <ActivityIndicator color="#5865F2" style={{ marginTop: 20 }} />
            ) : (
                <FlatList
                    data={results}
                    keyExtractor={(item) => item.id.toString()}
                    ListEmptyComponent={
                        searchText !== '' && !loading && (
                            <Text style={styles.emptyText}>Không tìm thấy người dùng nào</Text>
                        )
                    }
                    renderItem={({ item }) => (
                        <View style={styles.userItem}>
                            <Avatar uri={item.avatarUrl} name={item.username} size={45} />
                            <View style={styles.userInfo}>
                                <Text style={styles.userName}>{item.username}</Text>
                                <Text style={styles.mutualText}>
                                    {item.mutualFriends > 0 ? `${item.mutualFriends} bạn chung` : 'Chưa có bạn chung'}
                                </Text>
                            </View>
                            <TouchableOpacity
                                style={styles.addBtn}
                                onPress={() => handleSendRequest(item.username)}
                            >
                                <Ionicons name="person-add" size={20} color="white" />
                            </TouchableOpacity>
                        </View>
                    )}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#36393f' },
    searchHeader: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: '#202225', margin: 15,
        paddingHorizontal: 15, borderRadius: 8, height: 50
    },
    searchIcon: { marginRight: 10 },
    input: { flex: 1, color: 'white', fontSize: 16 },
    userItem: {
        flexDirection: 'row', alignItems: 'center',
        padding: 15, borderBottomWidth: 1, borderBottomColor: '#2f3136'
    },
    userInfo: { flex: 1, marginLeft: 15 },
    userName: { color: 'white', fontSize: 16, fontWeight: 'bold' },
    mutualText: { color: '#b9bbbe', fontSize: 12, marginTop: 2 },
    addBtn: { backgroundColor: '#5865F2', padding: 8, borderRadius: 5 },
    emptyText: { textAlign: 'center', color: '#72767d', marginTop: 50 }
});