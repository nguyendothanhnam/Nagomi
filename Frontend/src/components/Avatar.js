import { Image, StyleSheet, Text, View } from 'react-native';
import { BASE_URL_IMG } from '../utils/constants';

const Avatar = ({ uri, name, size = 48, style }) => {
    const borderRadius = size / 2;
    const fontSize = size * 0.4;

    // 1. Trường hợp CÓ ảnh -> Hiển thị Image
    if (uri) {
        // Xử lý đường dẫn: Nếu uri đã có http (ảnh mạng) thì giữ nguyên
        // Nếu là đường dẫn tương đối (/uploads/...) thì nối thêm IP server
        const fullUri = uri.startsWith('http') ? uri : BASE_URL_IMG + uri;

        return (
            <Image
                source={{ uri: fullUri }}
                style={[{ width: size, height: size, borderRadius }, style]}
                resizeMode="cover"
            />
        );
    }

    // 2. Trường hợp KHÔNG có ảnh -> Hiển thị chữ cái đầu
    return (
        <View style={[styles.placeholder, { width: size, height: size, borderRadius }, style]}>
            <Text style={[styles.placeholderText, { fontSize }]}>
                {name ? name.charAt(0).toUpperCase() : '?'}
            </Text>
        </View>
    );
};

const styles = StyleSheet.create({
    placeholder: {
        backgroundColor: '#5865F2', // Màu xanh đặc trưng Discord
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden'
    },
    placeholderText: {
        color: 'white',
        fontWeight: 'bold',
    },
});

export default Avatar;