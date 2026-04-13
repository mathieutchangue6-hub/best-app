import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Alert, StatusBar, SafeAreaView, AppState, Platform
} from 'react-native';
import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';

const LOCATION_TASK = 'background-location-task';
const FETCH_TASK = 'background-fetch-task';

// Background location task
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }: any) => {
  if (error) return;
  if (data) {
    const { locations } = data;
    const loc = locations[0];
    if (loc) {
      const user = auth().currentUser;
      if (user) {
        const bat = await Battery.getBatteryLevelAsync();
        let locationName = `${loc.coords.latitude.toFixed(4)}°, ${loc.coords.longitude.toFixed(4)}°`;
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${loc.coords.latitude}&lon=${loc.coords.longitude}&format=json`);
          const gd = await res.json();
          if (gd.address) {
            const a = gd.address;
            locationName = a.neighbourhood || a.suburb || a.quarter || a.road || a.village || a.town || a.city || locationName;
            if ((a.city || a.town || a.village) && locationName !== (a.city || a.town || a.village)) {
              locationName += ', ' + (a.city || a.town || a.village);
            }
          }
        } catch {}
        await firestore().collection('members').doc(user.uid).update({
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
          battery: Math.round(bat * 100),
          locationName,
          status: 'En déplacement',
          lastSeen: firestore.FieldValue.serverTimestamp()
        });
      }
    }
  }
});

// Background fetch task
TaskManager.defineTask(FETCH_TASK, async () => {
  try {
    const user = auth().currentUser;
    if (!user) return BackgroundFetch.BackgroundFetchResult.NoData;
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const bat = await Battery.getBatteryLevelAsync();
    let locationName = `${loc.coords.latitude.toFixed(4)}°`;
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${loc.coords.latitude}&lon=${loc.coords.longitude}&format=json`);
      const gd = await res.json();
      if (gd.address) {
        const a = gd.address;
        locationName = a.neighbourhood || a.suburb || a.quarter || a.road || a.village || a.town || a.city || locationName;
      }
    } catch {}
    await firestore().collection('members').doc(user.uid).update({
      lat: loc.coords.latitude, lng: loc.coords.longitude,
      battery: Math.round(bat * 100), locationName,
      status: 'Arrêtée', lastSeen: firestore.FieldValue.serverTimestamp()
    });
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export default function MemberScreen() {
  const [userData, setUserData] = useState<any>(null);
  const [sharing, setSharing] = useState(false);
  const [autoSharing, setAutoSharing] = useState(false);
  const [status, setStatus] = useState('Appuie pour partager ta position');
  const [battery, setBattery] = useState<number|null>(null);
  const [tracking, setTracking] = useState(true);
  const [history, setHistory] = useState<any[]>([]);
  const [tab, setTab] = useState<'position'|'historique'>('position');
  const intervalRef = useRef<any>(null);

  useEffect(() => {
    const user = auth().currentUser;
    if (!user) return;
    const unsub = firestore().collection('members').doc(user.uid).onSnapshot(snap => {
      if (snap.exists) {
        const data = snap.data();
        setUserData(data);
        setTracking(data?.trackingEnabled !== false);
      }
    });
    loadBattery();
    setupBackgroundTasks();
    const unsubHist = firestore().collection('history').orderBy('timestamp','desc').limit(20).onSnapshot(snap => {
      setHistory(snap.docs.map(d => d.data()));
    });
    return () => { unsub(); unsubHist(); };
  }, []);

  const loadBattery = async () => {
    const b = await Battery.getBatteryLevelAsync();
    setBattery(Math.round(b * 100));
  };

  const setupBackgroundTasks = async () => {
    try {
      const { status } = await Location.requestBackgroundPermissionsAsync();
      if (status === 'granted') {
        const isRegistered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK);
        if (!isRegistered) {
          await Location.startLocationUpdatesAsync(LOCATION_TASK, {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 30000,
            distanceInterval: 50,
            foregroundService: {
              notificationTitle: 'Best — Partage actif',
              notificationBody: 'Ta position est partagée avec ta famille',
              notificationColor: '#A8FF3E',
            },
            pausesUpdatesAutomatically: false,
            showsBackgroundLocationIndicator: true,
          });
        }
        // Background fetch every 15 min
        await BackgroundFetch.registerTaskAsync(FETCH_TASK, {
          minimumInterval: 15 * 60,
          stopOnTerminate: false,
          startOnBoot: true,
        });
        setAutoSharing(true);
        setStatus('🟢 Partage en arrière-plan actif !');
      }
    } catch(e) {}
  };

  const sharePosition = async () => {
    if (!tracking) { Alert.alert('Bloqué', 'L\'admin a désactivé ton partage'); return; }
    setSharing(true);
    setStatus('📡 Localisation en cours...');
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setStatus('❌ Permission GPS refusée'); setSharing(false); return; }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const bat = await Battery.getBatteryLevelAsync();
      let locationName = `${loc.coords.latitude.toFixed(4)}°, ${loc.coords.longitude.toFixed(4)}°`;
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${loc.coords.latitude}&lon=${loc.coords.longitude}&format=json`);
        const gd = await res.json();
        if (gd.address) {
          const a = gd.address;
          locationName = a.neighbourhood || a.suburb || a.quarter || a.road || a.village || a.town || a.city || locationName;
          if ((a.city || a.town || a.village) && locationName !== (a.city || a.town || a.village)) locationName += ', ' + (a.city || a.town || a.village);
        }
      } catch {}
      const user = auth().currentUser!;
      await firestore().collection('members').doc(user.uid).update({
        lat: loc.coords.latitude, lng: loc.coords.longitude,
        battery: Math.round(bat * 100), locationName,
        status: 'Arrêtée', lastSeen: firestore.FieldValue.serverTimestamp()
      });
      await firestore().collection('history').add({
        memberName: userData?.name || '?', memberEmoji: userData?.emoji || '👤',
        event: 'A partagé sa position', type: 'location',
        timestamp: firestore.FieldValue.serverTimestamp()
      });
      setStatus(`✅ Partagée : ${locationName}`);
      setBattery(Math.round(bat * 100));
    } catch(e: any) {
      setStatus('❌ Impossible d\'obtenir la position. Active le GPS.');
    }
    setSharing(false);
  };

  const stopSharing = async () => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    try {
      const isReg = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK);
      if (isReg) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
      await BackgroundFetch.unregisterTaskAsync(FETCH_TASK);
    } catch {}
    setAutoSharing(false);
    setStatus('Partage arrêté');
  };

  const handleLogout = async () => {
    await stopSharing();
    await auth().signOut();
    const { router } = require('expo-router');
    router.replace('/');
  };

  const timeAgo = (ts: any) => {
    if (!ts) return 'Jamais';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const s = (Date.now() - d.getTime()) / 1000;
    if (s < 60) return 'À l\'instant';
    if (s < 3600) return Math.floor(s/60) + ' min';
    if (s < 86400) return Math.floor(s/3600) + 'h';
    return Math.floor(s/86400) + 'j';
  };

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#060B18"/>
      <View style={s.header}>
        <View>
          <Text style={s.h1}>🏠 Best</Text>
          <Text style={s.hsub}>Connecté : {userData?.name || '...'}</Text>
        </View>
        <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
          <Text style={{fontSize:18}}>🚪</Text>
        </TouchableOpacity>
      </View>
      <View style={s.tabBar}>
        <TouchableOpacity style={[s.tbtn, tab==='position'&&s.tbtnA]} onPress={() => setTab('position')}>
          <Text style={[s.tbtnT, tab==='position'&&s.tbtnTA]}>📍 Ma position</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.tbtn, tab==='historique'&&s.tbtnA]} onPress={() => setTab('historique')}>
          <Text style={[s.tbtnT, tab==='historique'&&s.tbtnTA]}>📋 Historique</Text>
        </TouchableOpacity>
      </View>
      <ScrollView style={{flex:1}} contentContainerStyle={{padding:16}}>
        {tab === 'position' && (
          !tracking ? (
            <View style={s.blockedCard}>
              <Text style={{fontSize:44,marginBottom:12}}>🚫</Text>
              <Text style={{color:'#FF4757',fontWeight:'700',fontSize:16,marginBottom:8}}>Accès désactivé</Text>
              <Text style={{color:'rgba(255,255,255,0.4)',fontSize:13,textAlign:'center'}}>L'administrateur a désactivé le partage de ta position.</Text>
            </View>
          ) : (
            <View>
              <View style={s.posCard}>
                <View style={{flexDirection:'row',alignItems:'center',gap:12,marginBottom:12}}>
                  <Text style={{fontSize:32}}>{userData?.emoji||'👤'}</Text>
                  <View>
                    <Text style={{fontWeight:'700',fontSize:18,color:'#fff'}}>{userData?.name||'Moi'}</Text>
                    <Text style={{color:'rgba(255,255,255,0.4)',fontSize:12}}>{userData?.locationName||'Position non partagée'}</Text>
                  </View>
                </View>
                <View style={[s.statusBadge, autoSharing&&{backgroundColor:'rgba(168,255,62,0.15)',borderColor:'rgba(168,255,62,0.4)'}]}>
                  <Text style={{color:autoSharing?'#A8FF3E':'rgba(255,255,255,0.5)',fontSize:12}}>{status}</Text>
                </View>
                <TouchableOpacity style={s.shareBtn} onPress={sharePosition} disabled={sharing}>
                  <Text style={s.shareBtnT}>{sharing ? '📡 En cours...' : '📍 Partager ma position'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.autoBtn, autoSharing&&{backgroundColor:'rgba(168,255,62,0.15)',borderColor:'#A8FF3E'}]} onPress={setupBackgroundTasks}>
                  <Text style={{color:autoSharing?'#A8FF3E':'#00C9FF',fontSize:13}}>
                    {autoSharing ? '🟢 Arrière-plan actif' : '🔄 Activer partage arrière-plan'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.stopBtn} onPress={stopSharing}>
                  <Text style={{color:'#FF4757',fontSize:13}}>⏹ Arrêter le partage</Text>
                </TouchableOpacity>
              </View>
              <View style={s.batCard}>
                <Text style={{fontWeight:'600',marginBottom:6,color:'#fff'}}>🔋 Batterie</Text>
                <Text style={{color:'rgba(255,255,255,0.5)',fontSize:13}}>
                  {battery !== null ? `${battery}% — ${battery<20?'⚠️ Très faible':battery<40?'⚡ Faible':'✅ OK'}` : 'Lecture...'}
                </Text>
              </View>
              <View style={s.tipCard}>
                <Text style={{color:'#FFA502',fontSize:12,lineHeight:20}}>
                  💡 <Text style={{fontWeight:'700'}}>Conseil :</Text> Pour que ta position soit partagée en permanence même quand l'app est fermée, active le "Partage arrière-plan" ci-dessus. Ne force pas la fermeture de l'app depuis les paramètres Android.
                </Text>
              </View>
            </View>
          )
        )}
        {tab === 'historique' && (
          <View>
            {history.length === 0 ? (
              <View style={s.empty}><Text style={{fontSize:36}}>📋</Text><Text style={{color:'rgba(255,255,255,0.3)',marginTop:8}}>Aucun historique</Text></View>
            ) : history.map((h,i) => (
              <View key={i} style={s.histItem}>
                <View style={s.histIcon}><Text style={{fontSize:16}}>📍</Text></View>
                <View>
                  <Text style={{fontSize:12,color:'#fff'}}><Text style={{color:'#A8FF3E'}}>{h.memberEmoji} {h.memberName}</Text> · {h.event}</Text>
                  <Text style={{color:'rgba(255,255,255,0.3)',fontSize:10,fontFamily:'monospace'}}>{h.timestamp ? timeAgo(h.timestamp) : ''}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:{flex:1,backgroundColor:'#060B18'},
  header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',padding:16,borderBottomWidth:1,borderBottomColor:'rgba(255,255,255,0.06)'},
  h1:{fontSize:18,fontWeight:'700',color:'#fff'},
  hsub:{color:'rgba(255,255,255,0.4)',fontSize:10,fontFamily:'monospace'},
  logoutBtn:{width:36,height:36,backgroundColor:'rgba(255,255,255,0.07)',borderRadius:18,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:'rgba(255,255,255,0.1)'},
  tabBar:{flexDirection:'row',padding:8,gap:8,borderBottomWidth:1,borderBottomColor:'rgba(255,255,255,0.05)'},
  tbtn:{paddingHorizontal:16,paddingVertical:8,borderRadius:20,backgroundColor:'rgba(255,255,255,0.06)'},
  tbtnA:{backgroundColor:'#A8FF3E'},
  tbtnT:{color:'rgba(255,255,255,0.5)',fontSize:12,fontWeight:'600'},
  tbtnTA:{color:'#060B18'},
  blockedCard:{alignItems:'center',padding:60},
  posCard:{padding:16,backgroundColor:'rgba(168,255,62,0.06)',borderWidth:1,borderColor:'rgba(168,255,62,0.2)',borderRadius:16,marginBottom:12},
  statusBadge:{padding:10,backgroundColor:'rgba(255,255,255,0.05)',borderRadius:10,borderWidth:1,borderColor:'rgba(255,255,255,0.1)',marginBottom:10},
  shareBtn:{backgroundColor:'#A8FF3E',borderRadius:12,padding:14,alignItems:'center',marginBottom:8},
  shareBtnT:{color:'#060B18',fontWeight:'700',fontSize:14},
  autoBtn:{borderRadius:12,padding:12,alignItems:'center',marginBottom:8,borderWidth:1,borderColor:'rgba(0,201,255,0.3)',backgroundColor:'rgba(0,201,255,0.1)'},
  stopBtn:{borderRadius:12,padding:12,alignItems:'center',borderWidth:1,borderColor:'rgba(255,71,87,0.3)'},
  batCard:{padding:14,backgroundColor:'rgba(255,255,255,0.03)',borderRadius:12,borderWidth:1,borderColor:'rgba(255,255,255,0.06)',marginBottom:12},
  tipCard:{padding:14,backgroundColor:'rgba(255,165,2,0.08)',borderRadius:12,borderWidth:1,borderColor:'rgba(255,165,2,0.2)'},
  empty:{alignItems:'center',padding:40},
  histItem:{flexDirection:'row',alignItems:'center',gap:10,padding:12,backgroundColor:'rgba(255,255,255,0.03)',borderRadius:10,borderWidth:1,borderColor:'rgba(255,255,255,0.05)',marginBottom:8},
  histIcon:{width:32,height:32,backgroundColor:'rgba(168,255,62,0.15)',borderRadius:8,alignItems:'center',justifyContent:'center'},
});
