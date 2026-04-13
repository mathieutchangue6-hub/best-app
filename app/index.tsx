import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, StatusBar, ActivityIndicator, SafeAreaView
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ADMIN_PIN = '2580';
const COLORS = ['#FF6B35','#E91E8C','#00C9FF','#A8FF3E','#FFD700','#FF9FF3','#4ECDC4','#FF4757'];
const EMOJIS = ['👨','👩','👦','👧','👴','👵','👶','🧒'];

// Firebase config
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';

export default function LoginScreen() {
  const [tab, setTab] = useState<'member'|'admin'|'register'>('member');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPass, setRegPass] = useState('');
  const [emoji, setEmoji] = useState('👤');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const unsub = auth().onAuthStateChanged(async user => {
      if (user) {
        const snap = await firestore().collection('members').doc(user.uid).get();
        if (snap.exists) {
          // Navigate to member screen
          const { router } = require('expo-router');
          router.replace('/member');
        }
      }
      setChecking(false);
    });
    return unsub;
  }, []);

  const handlePinPress = (val: string) => {
    if (pin.length >= 4) return;
    const newPin = pin + val;
    setPin(newPin);
    if (newPin.length === 4) {
      if (newPin === ADMIN_PIN) {
        const { router } = require('expo-router');
        router.replace('/admin');
      } else {
        Alert.alert('PIN incorrect', 'Réessaie');
        setPin('');
      }
    }
  };

  const handleLogin = async () => {
    if (!email || !password) { Alert.alert('Erreur', 'Remplis tous les champs'); return; }
    setLoading(true);
    try {
      await auth().signInWithEmailAndPassword(email, password);
      const { router } = require('expo-router');
      router.replace('/member');
    } catch(e: any) {
      Alert.alert('Erreur', 'Email ou mot de passe incorrect');
    }
    setLoading(false);
  };

  const handleRegister = async () => {
    if (!name || !regEmail || regPass.length < 6) {
      Alert.alert('Erreur', 'Remplis tous les champs (mot de passe min. 6 caractères)');
      return;
    }
    setLoading(true);
    try {
      // Check device already registered
      const deviceId = await getDeviceId();
      const existing = await firestore().collection('members').where('deviceId','==',deviceId).get();
      if (!existing.empty) {
        Alert.alert('Compte existant', 'Un compte existe déjà sur cet appareil. Contacte l\'admin pour le supprimer.');
        setLoading(false); return;
      }
      const cred = await auth().createUserWithEmailAndPassword(regEmail, regPass);
      await firestore().collection('members').doc(cred.user.uid).set({
        name, email: regEmail, emoji, deviceId,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        uid: cred.user.uid, role: 'member', trackingEnabled: true,
        lat: null, lng: null, battery: null, locationName: null,
        status: 'Hors ligne', lastSeen: null,
        createdAt: firestore.FieldValue.serverTimestamp()
      });
      const { router } = require('expo-router');
      router.replace('/member');
    } catch(e: any) {
      Alert.alert('Erreur', e.code === 'auth/email-already-in-use' ? 'Email déjà utilisé' : e.message);
    }
    setLoading(false);
  };

  const getDeviceId = async () => {
    let id = await AsyncStorage.getItem('best_device_id');
    if (!id) { id = 'dev_' + Math.random().toString(36).slice(2) + '_' + Date.now(); await AsyncStorage.setItem('best_device_id', id); }
    return id;
  };

  if (checking) return <View style={s.center}><ActivityIndicator color="#A8FF3E" size="large"/></View>;

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#060B18"/>
      <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
        <Text style={s.logo}>🏠</Text>
        <Text style={s.title}>Best</Text>
        <Text style={s.sub}>Application familiale privée</Text>

        <View style={s.card}>
          {/* Tabs */}
          <View style={s.tabs}>
            {(['member','admin','register'] as const).map((t, i) => (
              <TouchableOpacity key={t} style={[s.tab, tab===t && s.tabActive]} onPress={() => setTab(t)}>
                <Text style={[s.tabTxt, tab===t && s.tabTxtActive]}>{['👤 Membre','🔐 Admin','✚ S\'inscrire'][i]}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* MEMBER LOGIN */}
          {tab === 'member' && (
            <View>
              <Text style={s.label}>Email</Text>
              <TextInput style={s.input} value={email} onChangeText={setEmail} placeholder="email@exemple.com" placeholderTextColor="rgba(255,255,255,0.3)" keyboardType="email-address" autoCapitalize="none"/>
              <Text style={s.label}>Mot de passe</Text>
              <TextInput style={s.input} value={password} onChangeText={setPassword} placeholder="••••••••" placeholderTextColor="rgba(255,255,255,0.3)" secureTextEntry/>
              <TouchableOpacity style={s.btn} onPress={handleLogin} disabled={loading}>
                {loading ? <ActivityIndicator color="#060B18"/> : <Text style={s.btnTxt}>Se connecter</Text>}
              </TouchableOpacity>
            </View>
          )}

          {/* ADMIN PIN */}
          {tab === 'admin' && (
            <View style={s.pinWrap}>
              <Text style={s.pinTitle}>Code PIN administrateur</Text>
              <View style={s.pinDots}>
                {[0,1,2,3].map(i => <View key={i} style={[s.dot, i < pin.length && s.dotFilled]}/>)}
              </View>
              <View style={s.pinPad}>
                {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k,i) => (
                  <TouchableOpacity key={i} style={[s.pinBtn, k===''&&{opacity:0}]} onPress={() => k==='⌫' ? setPin(p=>p.slice(0,-1)) : k && handlePinPress(k)}>
                    <Text style={[s.pinBtnTxt, k==='⌫'&&{color:'#FF4757'}]}>{k}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* REGISTER */}
          {tab === 'register' && (
            <View>
              <Text style={s.label}>Prénom</Text>
              <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Ex: Papa, Lucas..." placeholderTextColor="rgba(255,255,255,0.3)"/>
              <Text style={s.label}>Email</Text>
              <TextInput style={s.input} value={regEmail} onChangeText={setRegEmail} placeholder="email@exemple.com" placeholderTextColor="rgba(255,255,255,0.3)" keyboardType="email-address" autoCapitalize="none"/>
              <Text style={s.label}>Mot de passe</Text>
              <TextInput style={s.input} value={regPass} onChangeText={setRegPass} placeholder="Min. 6 caractères" placeholderTextColor="rgba(255,255,255,0.3)" secureTextEntry/>
              <Text style={s.label}>Avatar</Text>
              <View style={s.emojiRow}>
                {EMOJIS.map(e => (
                  <TouchableOpacity key={e} style={[s.emojiBtn, emoji===e && s.emojiBtnSel]} onPress={() => setEmoji(e)}>
                    <Text style={{fontSize:26}}>{e}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity style={s.btn} onPress={handleRegister} disabled={loading}>
                {loading ? <ActivityIndicator color="#060B18"/> : <Text style={s.btnTxt}>Créer mon compte</Text>}
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex:1, backgroundColor:'#060B18' },
  center: { flex:1, backgroundColor:'#060B18', alignItems:'center', justifyContent:'center' },
  container: { alignItems:'center', padding:24, paddingTop:60 },
  logo: { fontSize:60, marginBottom:8 },
  title: { fontSize:32, fontWeight:'800', color:'#A8FF3E', marginBottom:4 },
  sub: { color:'rgba(255,255,255,0.4)', fontSize:13, marginBottom:40 },
  card: { backgroundColor:'rgba(255,255,255,0.05)', borderWidth:1, borderColor:'rgba(255,255,255,0.1)', borderRadius:20, padding:24, width:'100%' },
  tabs: { flexDirection:'row', backgroundColor:'rgba(255,255,255,0.05)', borderRadius:10, padding:4, marginBottom:24 },
  tab: { flex:1, padding:8, borderRadius:8, alignItems:'center' },
  tabActive: { backgroundColor:'#A8FF3E' },
  tabTxt: { color:'rgba(255,255,255,0.5)', fontSize:11, fontWeight:'600' },
  tabTxtActive: { color:'#060B18' },
  label: { color:'rgba(255,255,255,0.5)', fontSize:11, marginBottom:5, marginTop:10, textTransform:'uppercase', letterSpacing:1 },
  input: { backgroundColor:'rgba(255,255,255,0.07)', borderWidth:1, borderColor:'rgba(255,255,255,0.1)', borderRadius:10, color:'#fff', fontSize:14, padding:12, marginBottom:4 },
  btn: { backgroundColor:'#A8FF3E', borderRadius:12, padding:14, alignItems:'center', marginTop:14 },
  btnTxt: { color:'#060B18', fontWeight:'700', fontSize:15 },
  pinWrap: { alignItems:'center' },
  pinTitle: { color:'rgba(255,255,255,0.5)', fontSize:13, marginBottom:16 },
  pinDots: { flexDirection:'row', gap:14, marginBottom:24 },
  dot: { width:16, height:16, borderRadius:8, borderWidth:2, borderColor:'rgba(255,255,255,0.3)' },
  dotFilled: { backgroundColor:'#A8FF3E', borderColor:'#A8FF3E' },
  pinPad: { flexDirection:'row', flexWrap:'wrap', width:240, gap:10 },
  pinBtn: { width:70, height:56, backgroundColor:'rgba(255,255,255,0.07)', borderWidth:1, borderColor:'rgba(255,255,255,0.1)', borderRadius:12, alignItems:'center', justifyContent:'center' },
  pinBtnTxt: { color:'#fff', fontSize:22, fontWeight:'600' },
  emojiRow: { flexDirection:'row', flexWrap:'wrap', gap:8, marginBottom:8 },
  emojiBtn: { padding:8, borderRadius:8, borderWidth:2, borderColor:'transparent' },
  emojiBtnSel: { borderColor:'#A8FF3E', backgroundColor:'rgba(168,255,62,0.1)' },
});
