import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function ServerIcon({ name, isSelected, onPress }) {
    return (
        <TouchableOpacity onPress={onPress} style={styles.container}>
            {/* Thanh trắng bên cạnh để biết đang chọn server nào */}
            {isSelected && <View style={styles.indicator} />}

            <View style={[styles.circle, isSelected && styles.selectedCircle]}>
                <Text style={styles.text}>{name.charAt(0).toUpperCase()}</Text>
            </View>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: { alignItems: 'center', marginBottom: 15, position: 'relative' },
    circle: {
        width: 50, height: 50, borderRadius: 25, backgroundColor: '#36393f',
        justifyContent: 'center', alignItems: 'center', overflow: 'hidden'
    },
    selectedCircle: { borderRadius: 15, backgroundColor: '#5865F2' }, // Bo góc vuông hơn khi chọn
    text: { color: 'white', fontWeight: 'bold', fontSize: 18 },
    indicator: {
        position: 'absolute', left: -15, width: 5, height: 40,
        backgroundColor: 'white', borderTopRightRadius: 5, borderBottomRightRadius: 5, top: 5
    }
});