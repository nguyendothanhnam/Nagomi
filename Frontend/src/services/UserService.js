import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { Platform } from 'react-native'; // 👇 QUAN TRỌNG: Thêm cái này để fix lỗi upload ảnh
import { BASE_URL } from '../utils/constants';


const UserService = {
    searchUsers: async (myId, keyword) => {
        try {
            const token = await UserService.getToken();
            const response = await axios.get(`${BASE_URL}/users/search`, {
                // Đảm bảo myId là Number, keyword là String
                params: {
                    myId: Number(myId),
                    keyword: String(keyword)
                },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return response.data;
        } catch (error) {
            console.error("Lỗi tìm kiếm người dùng:", error);
            throw error;
        }
    },
    updateServerInfo: async (serverId, data) => {
        try {
            const token = await UserService.getToken();
            const response = await axios.put(`${BASE_URL}/servers/${serverId}`, data, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json' // Quan trọng: Đảm bảo Server nhận được JSON
                }
            });
            return response.data;
        } catch (error) {
            console.error("❌ Lỗi cập nhật server:", error.response || error.message);
            const errorMessage = error.response?.data
                || "Cập nhật server thất bại (Lỗi kết nối hoặc không rõ)";
            throw errorMessage;
        }
    },
    getMutualFriendsCount: async (user1Id, user2Id) => {
        try {
            const token = await UserService.getToken();
            const response = await axios.get(`${BASE_URL}/friends/mutual-count`, {
                params: { user1Id, user2Id },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return response.data; // Trả về con số (ví dụ: 5)
        } catch (error) {
            console.error("Lỗi lấy số bạn chung:", error);
            return 0;
        }
    },
    getServerById: async (serverId) => {
        try {
            const token = await UserService.getToken();
            // Backend cần endpoint GET /api/servers/{serverId} trả về Server object có list members
            const response = await axios.get(`${BASE_URL}/servers/${serverId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return response.data;
        } catch (error) {
            console.error("Lỗi tải thông tin server:", error);
            throw error.response?.data || "Lỗi không xác định khi tải server.";
        }
    },
    getUserId: async () => {
        return await AsyncStorage.getItem('userId');
    },
    // 1. Lấy Token đã lưu
    getToken: async () => {
        return await AsyncStorage.getItem('userToken');
    },

    // 2. Đăng ký & Đăng xuất
    register: async (username, password, email) => {
        try {
            const response = await axios.post(`${BASE_URL}/auth/register`, {
                username, password, email
            });
            return response.data;
        } catch (error) {
            // Lấy thông báo lỗi cụ thể từ Backend trả về (ResponseEntity.body)
            const msg = error.response?.data || "Lỗi kết nối Server";
            throw msg;
        }
    },
    logout: async () => {
        try {
            const userId = await AsyncStorage.getItem('userId');
            if (userId) {
                await UserService.updateStatus(userId, 'OFFLINE');
            }
            await AsyncStorage.multiRemove(['userToken', 'userId', 'username', 'avatarUrl']);
        } catch (e) { console.error("Lỗi đăng xuất:", e); }
    },

    // 3. Bạn Bè
    getFriends: async (userId) => {
        try {
            const token = await UserService.getToken();
            const response = await axios.get(`${BASE_URL}/users/friends/${userId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return response.data;
        } catch (error) {
            console.error("Lỗi lấy bạn bè:", error);
            return [];
        }
    },

    addFriend: async (userId, friendUsername) => {
        try {
            const token = await UserService.getToken();
            const response = await axios.post(`${BASE_URL}/friends/add`, null, {
                params: { senderId: userId, friendUsername },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return response.data;
        } catch (error) {
            console.error("Lỗi thêm bạn:", error);
            throw error;
        }
    },

    getPendingRequests: async (userId) => {
        try {
            const token = await UserService.getToken();
            const response = await axios.get(`${BASE_URL}/friends/requests/${userId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return response.data;
        } catch (error) { return []; }
    },

    getSentRequests: async (userId) => {
        try {
            const token = await UserService.getToken();
            const response = await axios.get(`${BASE_URL}/friends/sent/${userId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return response.data;
        } catch (error) { return []; }
    },

    acceptRequest: async (requestId) => {
        try {
            const token = await UserService.getToken();
            const response = await axios.post(`${BASE_URL}/friends/accept/${requestId}`, null, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return response.data;
        } catch (error) { throw error; }
    },

    cancelRequest: async (requestId) => {
        try {
            const token = await UserService.getToken();
            const response = await axios.delete(`${BASE_URL}/friends/cancel/${requestId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return response.data;
        } catch (error) { throw error; }
    },

    // 4. Chat & Upload
    getChatHistory: async (userId, friendId) => {
        try {
            const token = await UserService.getToken();
            const response = await axios.get(`${BASE_URL}/messages/${userId}/${friendId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return response.data;
        } catch (error) {
            console.error("Lỗi lấy lịch sử chat:", error);
            return [];
        }
    },

    uploadFile: async (fileUri, fileType, fileName) => {
        const formData = new FormData();

        // Nếu không truyền tên, tự lấy từ đường dẫn
        let name = fileName || fileUri.split('/').pop();

        // Nếu không truyền loại, mặc định là binary
        let type = fileType || 'application/octet-stream';

        if (Platform.OS === 'web') {
            try {
                const res = await fetch(fileUri);
                const blob = await res.blob();
                const file = new File([blob], name, { type: blob.type });
                formData.append('file', file);
            } catch (e) { return null; }
        } else {
            formData.append('file', { uri: fileUri, name, type });
        }

        try {
            const response = await axios.post(`${BASE_URL}/files/upload`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                timeout: 30000,
            });
            return response.data;
        } catch (error) {
            console.error("Upload lỗi:", error);
            return null;
        }
    },

    // 5. Server & Channel
    createServer: async (userId, name, iconUrl) => {
        try {
            const token = await UserService.getToken();
            const response = await axios.post(`${BASE_URL}/servers/create`, null, {
                // Truyền iconUrl vào đây (có thể là null nếu không chọn ảnh)
                params: { ownerId: userId, name, iconUrl },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return response.data;
        } catch (error) { return null; }
    },
    createChannel: async (serverId, name, type) => {
        try {
            const token = await UserService.getToken();
            const response = await axios.post(`${BASE_URL}/channels/create`, null, {
                params: { serverId, name, type },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return response.data;
        } catch (error) { return null; }
    },

    inviteMember: async (serverId, userId) => {
        try {
            const token = await UserService.getToken();
            const response = await axios.post(`${BASE_URL}/servers/${serverId}/invite`, null, {
                params: { userId },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return response.data;
        } catch (error) { return "Lỗi kết nối"; }
    },

    getChannelHistory: async (channelId) => {
        try {
            const token = await UserService.getToken();
            const response = await axios.get(`${BASE_URL}/channels/${channelId}/messages`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return response.data;
        } catch (error) {
            console.error("Lỗi lấy lịch sử kênh:", error);
            return [];
        }
    },

    // 👇 THÊM API MỚI: Lấy danh sách thành viên trong Server
    getServerMembers: async (serverId) => {
        try {
            const token = await UserService.getToken();
            const response = await axios.get(`${BASE_URL}/servers/${serverId}/members`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return response.data; // Trả về danh sách ID [1, 2, 5]
        } catch (error) {
            console.error("Lỗi lấy thành viên:", error);
            return [];
        }
    },
    updateUserAvatar: async (userId, avatarUrl) => {
        try {
            const token = await UserService.getToken();
            await axios.put(`${BASE_URL}/users/${userId}/avatar`, null, {
                params: { avatarUrl },
                headers: { 'Authorization': `Bearer ${token}` }
            });
        } catch (error) { console.error("Lỗi update avatar:", error); }
    },
    getProfileDetail: async (myId, targetId) => {
        try {
            const token = await UserService.getToken();
            const response = await axios.get(`${BASE_URL}/friends/profile-detail`, {
                params: { myId, targetId },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return response.data;
        } catch (error) {
            console.error("Lỗi lấy hồ sơ:", error);
            throw error;
        }
    },
    unfriend: async (userId, friendId) => {
        try {
            const token = await AsyncStorage.getItem('userToken');
            const response = await axios.post(`${BASE_URL}/friends/unfriend`, null, {
                params: { userId, friendId },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return response.data;
        } catch (error) {
            console.error("Lỗi xóa bạn:", error);
            throw error;
        }
    },

    updateStatus: async (userId, status) => {
        try {
            const token = await UserService.getToken();
            await axios.put(`${BASE_URL}/users/${userId}/status`, null, {
                params: { status }, // 'ONLINE' hoặc 'OFFLINE'
                headers: { 'Authorization': `Bearer ${token}` }
            });
        } catch (error) {
            console.error("Lỗi cập nhật trạng thái:", error);
        }
    },
    uploadImage: async (fileUri) => {
        // Alias cho hàm uploadFile với loại file mặc định là image/jpeg
        return await UserService.uploadFile(fileUri, 'image/jpeg');
    },
    updateUserProfile: async (userId, username, email) => {
        try {
            const token = await UserService.getToken();
            const response = await axios.put(`${BASE_URL}/users/${userId}`, {
                username,
                email
            }, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            // Server Java cần return một thông báo thành công
            return response.data;
        } catch (error) {
            throw error.response?.data || "Cập nhật thất bại";
        }
    },
    changePassword: async (userId, oldPassword, newPassword) => {
        try {
            const token = await UserService.getToken();
            const response = await axios.post(`${BASE_URL}/users/${userId}/change-password`, {
                oldPassword,
                newPassword
            }, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            // Server Java cần return một thông báo thành công
            return response.data;
        } catch (error) {
            console.error("Lỗi đổi mật khẩu:", error);
            // Ném ra thông báo lỗi cụ thể từ Server (ví dụ: Mật khẩu cũ không đúng)
            throw error.response?.data || "Đổi mật khẩu thất bại";
        }
    },
    deleteMember: async (serverId, memberId) => {
        try {
            const token = await UserService.getToken();
            const response = await axios.delete(`${BASE_URL}/servers/${serverId}/members/${memberId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return response.data; // Trả về thông báo thành công từ Server
        } catch (error) {
            console.error("Lỗi xóa thành viên:", error);
            throw error.response?.data || "Xóa thành viên thất bại.";
        }
    },
    getInviteLink: async (serverId) => {
        try {
            const token = await UserService.getToken();
            // Đã sửa thành /servers/ thay vì /users/servers/
            const response = await axios.get(`${BASE_URL}/servers/${serverId}/invite-link`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return response.data;
        } catch (error) {
            console.error("Lỗi lấy link mời:", error);
            return null;
        }
    },

    joinServer: async (userId, inviteCode) => {
        try {
            const token = await UserService.getToken();
            // Đã sửa thành /servers/join thay vì /users/servers/join
            const response = await axios.post(`${BASE_URL}/servers/join`, null, {
                params: { userId, inviteCode },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return response.data;
        } catch (error) {
            throw error;
        }
    },

    leaveServer: async (serverId, userId) => {
        try {
            const token = await UserService.getToken();
            const response = await axios.post(`${BASE_URL}/servers/${serverId}/leave`, null, {
                params: { userId },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return response.data;
        } catch (error) {
            throw error.response?.data || "Không thể rời nhóm.";
        }
    },
    deleteServer: async (serverId, userId) => {
        try {
            const token = await UserService.getToken();
            // SỬA LẠI: Bỏ bớt /api nếu BASE_URL đã có nó, hoặc kiểm tra lại sự đồng bộ
            const response = await axios.delete(`${BASE_URL}/servers/${serverId}`, {
                params: { userId: userId },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return response.data;
        } catch (error) {
            // Cực kỳ quan trọng: Ném nguyên object error để Screen bắt được response.status
            throw error;
        }
    },

    // Lấy danh sách nhạc đã lưu của kênh từ Database
    getChannelPlaylist: async (channelId) => {
        try {
            const token = await UserService.getToken();
            const response = await axios.get(`${BASE_URL}/channels/${channelId}/music`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return response.data;
        } catch (error) { return []; }
    },

    // Thêm bài hát mới vào Database của kênh
    addMusicToChannel: async (channelId, musicData) => {
        try {
            const token = await UserService.getToken();
            const response = await axios.post(`${BASE_URL}/channels/${channelId}/music`, musicData, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return response.data;
        } catch (error) { throw error; }
    },

    deleteChannelMusic: async (channelId, musicId) => {
        try {
            const token = await UserService.getToken();
            const response = await axios.delete(`${BASE_URL}/channels/${channelId}/music/${musicId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return response.data; // Thường trả về true hoặc message thành công
        } catch (error) {
            console.error("Lỗi xóa nhạc trong Service:", error);
            throw error;
        }
    },


    sendServerInvite: async (serverId, inviterId, friendId) => {
        try {
            const token = await UserService.getToken();
            const response = await axios.post(`${BASE_URL}/servers/invite/send`, null, {
                params: { serverId, inviterId, friendId },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return response.data;
        } catch (error) {
            throw error.response?.data || "Không thể gửi lời mời.";
        }
    },

    getServerInvites: async (userId) => {
        try {
            const token = await UserService.getToken();
            const response = await axios.get(`${BASE_URL}/servers/invites/${userId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return response.data;
        } catch (error) { return []; }
    },

    respondToServerInvite: async (inviteId, accept) => {
        try {
            const token = await UserService.getToken();
            const response = await axios.post(`${BASE_URL}/servers/invite/respond`, null, {
                params: { inviteId, accept },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return response.data;
        } catch (error) {
            throw error.response?.data || "Lỗi xử lý lời mời.";
        }
    },
};

export default UserService;