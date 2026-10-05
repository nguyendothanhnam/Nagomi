import AsyncStorage from '@react-native-async-storage/async-storage';

import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useEffect, useState } from 'react';

import { ActivityIndicator, View } from 'react-native';
import AddFriendScreen from '../screens/AddFriendScreen';
import AddServerOptionsScreen from '../screens/AddServerOptionsScreen';
import ChangePasswordScreen from '../screens/ChangePasswordScreen';
import ChatScreen from '../screens/ChatScreen';
import EditProfileScreen from '../screens/EditProfileScreen';
import JoinServerScreen from '../screens/JoinServerScreen';
import LoginScreen from '../screens/LoginScreen';
import MainLayout from '../screens/MainLayout';
import ProfileScreen from '../screens/ProfileScreen';
import RegisterScreen from '../screens/RegisterScreen';
import ServerProfileScreen from '../screens/ServerProfileScreen';
import VoiceChannelScreen from '../screens/VoiceChannelScreen';
const Stack = createNativeStackNavigator();
export default function AppNavigator() {
    const [isLoading, setIsLoading] = useState(true);
    const [initialRoute, setInitialRoute] = useState('Login');

    // 👇 LOGIC TỰ ĐỘNG ĐĂNG NHẬP

    useEffect(() => {
        const checkLoginStatus = async () => {
            try {
                console.log("...Đang kiểm tra đăng nhập...");
                const token = await AsyncStorage.getItem('userToken');
                const userId = await AsyncStorage.getItem('userId');
                console.log("Token:", token, "UserID:", userId);
                if (token && userId) {

                    // 👇 SỬA Ở ĐÂY: Chuyển hướng vào 'Main' thay vì 'Home'

                    setInitialRoute('Main');
                }

            } catch (e) {
                console.warn("Lỗi check token:", e);
            } finally {
                console.log("Đã kiểm tra xong, tắt loading.");
                setIsLoading(false);
            }
        };
        checkLoginStatus();

    }, []);
    if (isLoading) {
        return (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#36393f' }}>
                <ActivityIndicator size="large" color="#5865F2" />
            </View>
        );
    }
    return (
        <Stack.Navigator initialRouteName={initialRoute}>
            <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Register" component={RegisterScreen} options={{ headerShown: false }} />
            {/* Màn hình chính (Sidebar + Channel) */}
            <Stack.Screen name="Main" component={MainLayout} options={{ headerShown: false }} />
            <Stack.Screen name="Profile" component={ProfileScreen} options={{ headerShown: false }} />
            <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} options={{ headerShown: false }} />
            <Stack.Screen name="ServerProfile" component={ServerProfileScreen} options={{ headerShown: false }} />
            {/* Màn hình Chat */}
            <Stack.Screen name="Chat" component={ChatScreen} options={{ title: 'Chat' }} />
            <Stack.Screen name="EditProfile" component={EditProfileScreen} options={{ headerShown: false }} />
            <Stack.Screen name="AddServerOptions" component={AddServerOptionsScreen} options={{ headerShown: false }} />
            <Stack.Screen name="JoinServer" component={JoinServerScreen} options={{ headerShown: false }} />

            <Stack.Screen name="AddFriend" component={AddFriendScreen} options={{ title: 'Thêm bạn bè' }} />

            <Stack.Screen name="VoiceChannel" component={VoiceChannelScreen} />

        </Stack.Navigator>

    );

}

