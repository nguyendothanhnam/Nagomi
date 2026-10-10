// src/utils/constants.js
import { Platform } from 'react-native';

// 👇 KHI ĐỔI MẠNG, CHỈ CẦN SỬA SỐ IP Ở DÒNG NÀY LÀ XONG
const LAN_IP_ADDRESS = '172.26.30.182';
const WEB_HOST = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
export const IP_ADDRESS = Platform.OS === 'web' ? WEB_HOST : LAN_IP_ADDRESS;

export const PORT = '8080';

// Các đường dẫn dùng chung
export const BASE_URL = `http://${IP_ADDRESS}:${PORT}/api`;
export const SOCKET_URL = `http://${IP_ADDRESS}:${PORT}/ws`;
export const BASE_URL_IMG = `http://${IP_ADDRESS}:${PORT}`;
