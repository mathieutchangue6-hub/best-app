import { View, Text, StyleSheet } from 'react-native';

export default function LoginScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Best App 🎉</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060B18',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: '#A8FF3E',
    fontSize: 32,
    fontWeight: 'bold',
  },
});
