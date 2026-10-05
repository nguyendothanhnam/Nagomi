import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import 'text-encoding-polyfill';
import AppNavigator from './src/navigation/AppNavigator';

// Thêm đoạn code này vào đây
if (typeof global.self === 'undefined') {
    global.self = global;
}

export default function App() {
    return (
        <NavigationContainer>
            <StatusBar style="light" />
            <AppNavigator />
        </NavigationContainer>
    );
}