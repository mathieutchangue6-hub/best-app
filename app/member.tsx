import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Alert, StatusBar, SafeAreaView, AppState
} from 'react-native';
import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';

const LOCATION_TASK = 'background-location-task';
const FETCH_TASK = 'background-fetch-task';

// ─── Reverse geocoding ───────────────────────────────────────────────────────
async function getLocationName(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { 'Accept-Language': 'fr' } }
    );
    const gd = await res.json();
    if (gd.address) {
      const a = gd.address;
      const name = a.neighbourhood || a.suburb || a.quarter || a.road || a.village || a.town || a.city || '';
      const city = a.city || a.town || a.village || '';
      if (name && city && name !== city) return `${name}, ${city}`;
      return name || city || `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`;
    }
  } catch {}
  return `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`;
}

// ─── Détection de mouvement ──────────────────────────────────────────────────
let _lastLat = 0;
let _lastLng = 0;
function detectStatus(lat: number, lng: number): string {
  const dist = Math.sqrt(Math.pow(lat - _lastLat, 2) + Math.pow(lng - _lastLng, 2)) * 111000;
  _lastLat = lat; _lastLng = lng;
  return dist > 30 ? 'En déplacement' : 'Arrêtée';
}

// ─── Background location task ────────────────────────────────────────────────
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }: any) => {
  if (error || !data) return;
  const { locations } = data;
  const loc = locations?.[0];
  if (!loc) return;
  const user = auth().currentUser;
  if (!user) return;
  try {
    const bat = await Battery.getBatteryLevelAsync();
    const locationName = await getLocationName(loc.coords.latitude, loc.coords.longitude);
    const status = detectStatus(loc.coords.latitude, loc.coords.longitude);
    await firestore().collection('members').doc(user.uid).update({
      lat: loc.coords.latitude,
      lng: loc.coords.longitude,
      battery: Math.round(bat * 100),
      locationName,
      status,
      lastSeen: firestore.FieldValue.serverTimestamp(),
    });
    // Historique seulement si en déplacement
    if (status === 'En déplacement') {
      const snap = await firestore().collection('members').doc(user.uid).get();
      const name = snap.data()?.name || '?';
      const emoji = snap.data()?.emoji || '👤';
      await firestore().collection('history').add({
        memberName: name, memberEmoji: emoji,
        event: 'A partagé sa position', type: 'location',
        timestamp: firestore.FieldValue.serverTimestamp(),
      });
    }
  } catch {}
});

// ─── Background fetch task (filet de sécurité) ───────────────────────────────
TaskManager.defineTask(FETCH_TASK, async () => {
  try {
    const user = auth().currentUser;
    if (!user) return BackgroundFetch.BackgroundFetchResult.NoData;
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    const bat = await Battery.getBatteryLevelAsync();
    const locationName = await getLocationName(loc.coords.latitude, loc.coords.longitude);
    const status = detectStatus(loc.coords.latitude, loc.coords.longitude);
    await firestore().collection('members').doc(user.uid).update({
      lat: loc.coords.latitude, lng: loc.coords.longitude,
      battery: Math.round(bat * 100), locationName, status,
      lastSeen: firestore.FieldValue.serverTimestamp(),
    });
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// ─── SCREEN ──────────────────────────────────────────────────────────────────
export default function MemberScreen() {
  const [userData, setUserData] = useState<any>(null);
  const [sharing, setSharing] = useState(false);
  const [autoSharing, setAutoSharing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('Appuie pour partager ta position');
  const [battery, setBattery] = useState<number | null>(null);
  const [tracking, setTracking] = useState(true);
  const [history, setHistory] = useState<any[]>([]);
  const [tab, setTab] = useState<'position' | 'historique'>('position');
  const foregroundIntervalRef = useRef<any>(null);
  const batterySubRef = useRef<any>(null);

  useEffect(() => {
    const user = auth().currentUser;
    if (!user) return;

    // Écoute Firestore (données membre)
    const unsub = firestore().collection('members').doc(user.uid).onSnapshot(snap => {
      if (snap.exists) {
        const data = snap.data();
        setUserData(data);
        setTracking(data?.trackingEnabled !== false);
      }
    });

    // Historique
    const unsubHist = firestore().collection('history')
      .orderBy('timestamp', 'desc').limit(20)
      .onSnapshot(snap => setHistory(snap.docs.map(d => d.data())));

    // Batterie en temps réel
    startBatteryMonitoring();

    // Démarre le tracking automatiquement
    setupBackgroundTasks();

    // Quand l'app revient au premier plan → mise à jour immédiate
    const appStateSub = AppState.addEventListener('change', state => {
      if (state === 'active') sendPosition();
    });

    return () => {
      unsub();
      unsubHist();
      appStateSub.remove();
      if (foregroundIntervalRef.current) clearInterval(foregroundIntervalRef.current);
      batterySubRef.current?.remove?.();
    };
  }, []);

  // ── Batterie en temps réel ──────────────────────────────────────────────
  const startBatteryMonitoring = async () => {
    const b = await Battery.getBatteryLevelAsync();
    setBattery(Math.round(b * 100));
    // Abonnement aux changements de batterie
    batterySubRef.current = Battery.addBatteryLevelListener(({ batteryLevel }) => {
      const pct = Math.round(batteryLevel * 100);
      setBattery(pct);
      // Sync batterie dans Firestore immédiatement
      const user = auth().currentUser;
      if (user) {
        firestore().collection('members').doc(user.uid).update({ battery: pct });
      }
    });
  };

  // ── Envoie la position une fois ────────────────────────────────────────
  const sendPosition = async () => {
    const user = auth().currentUser;
    if (!user) return;
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const bat = await Battery.getBatteryLevelAsync();
      const locationName = await getLocationName(loc.coords.latitude, loc.coords.longitude);
      const status = detectStatus(loc.coords.latitude, loc.coords.longitude);
      await firestore().collection('members').doc(user.uid).update({
        lat: loc.coords.latitude, lng: loc.coords.longitude,
        battery: Math.round(bat * 100), locationName, status,
        lastSeen: firestore.FieldValue.serverTimestamp(),
      });
      setBattery(Math.round(bat * 100));
    } catch {}
  };

  // ── Setup background tasks ──────────────────────────────────────────────
  const setupBackgroundTasks = async () => {
    try {
      const fg = await Location.requestForegroundPermissionsAsync();
      if (fg.status !== 'granted') {
        setStatusMsg('❌ Permission GPS refusée');
        return;
      }
      const bg = await Location.requestBackgroundPermissionsAsync();
      if (bg.status !== 'granted') {
        setStatusMsg('⚠️ Permission arrière-plan refusée — va dans Paramètres > Localisation > Toujours autoriser');
        return;
      }

      // Arrêt propre avant redémarrage
      try {
        const isReg = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK);
        if (isReg) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
      } catch {}

      // Démarrage tracking GPS continu
      await Location.startLocationUpdatesAsync(LOCATION_TASK, {
        accuracy: Location.Accuracy.High,           // Haute précision
        timeInterval: 15000,                         // Toutes les 15 secondes
        distanceInterval: 10,                        // Ou tous les 10 mètres
        foregroundService: {
          notificationTitle: '🏠 Best — Partage actif',
          notificationBody: 'Ta position est partagée avec ta famille',
          notificationColor: '#A8FF3E',
        },
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        activityType: Location.ActivityType.Other,
      });

      // Background fetch toutes les 15 min (filet de sécurité)
      try {
        await BackgroundFetch.registerTaskAsync(FETCH_TASK, {
          minimumInterval: 15 * 60,
          stopOnTerminate: false,
          startOnBoot: true,
        });
      } catch {}

      // Intervalle foreground : toutes les 10 secondes quand l'app est ouverte
      if (foregroundIntervalRef.current) clearInterval(foregroundIntervalRef.current);
      foregroundIntervalRef.current = setInterval(sendPosition, 10000);

      setAutoSharing(true);
      setStatusMsg('🟢 Partage en temps réel actif');

      // Première position immédiate
      await sendPosition();
    } catch (e: any) {
      setStatusMsg('❌ Erreur : ' + e.message);
    }
  };

  // ── Partage manuel ──────────────────────────────────────────────────────
  const sharePosition = async () => {
    if (!tracking) { Alert.alert('Bloqué', "L'admin a désactivé ton partage"); return; }
    setSharing(true);
    setStatusMsg('📡 Localisation en cours...');
    await sendPosition();
    setStatusMsg('✅ Position mise à jour !');
    setSharing(false);
  };

  // ── Arrêt partage ───────────────────────────────────────────────────────
  const stopSharing = async () => {
    if (foregroundIntervalRef.current) {
      clearInterval(foregroundIntervalRef.current);
      foregroundIntervalRef.current = null;
    }
    try {
      const isReg = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK);
      if (isReg) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
      await BackgroundFetch.unregisterTaskAsync(FETCH_TASK);
    } catch {}
    setAutoSharing(false);
    setStatusMsg('⏹ Partage arrêté');
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
    if (s < 3600) return Math.floor(s / 60) + ' min';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    return Math.floor(s / 86400) + 'j';
  };

  const batColor = !battery ? '#fff' : battery < 20 ? '#FF4757' : battery < 40 ? '#FFA502' : '#A8FF3E';

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#060B18" />

      {/* ── Header ── */}
      <View style={s.header}>
        <View>
          <Text style={s.h1}>🏠 Best</Text>
          <Text style={s.hsub}>Connecté : {userData?.name || '...'}</Text>
        </View>
        <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
          <Text style={{ fontSize: 18 }}>🚪</Text>
        </TouchableOpacity>
      </View>

      {/* ── Tabs ── */}
      <View style={s.tabBar}>
        <TouchableOpacity style={[s.tbtn, tab === 'position' && s.tbtnA]} onPress={() => setTab('position')}>
          <Text style={[s.tbtnT, tab === 'position' && s.tbtnTA]}>📍 Ma position</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.tbtn, tab === 'historique' && s.tbtnA]} onPress={() => setTab('historique')}>
          <Text style={[s.tbtnT, tab === 'historique' && s.tbtnTA]}>📋 Historique</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>

        {/* ══ TAB POSITION ══ */}
        {tab === 'position' && (
          !tracking ? (
            <View style={s.blockedCard}>
              <Text style={{ fontSize: 44, marginBottom: 12 }}>🚫</Text>
              <Text style={{ color: '#FF4757', fontWeight: '700', fontSize: 16, marginBottom: 8 }}>Accès désactivé</Text>
              <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, textAlign: 'center' }}>
                L'administrateur a désactivé le partage de ta position.
              </Text>
            </View>
          ) : (
            <View>
              {/* Carte profil */}
              <View style={s.posCard}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                  <Text style={{ fontSize: 36 }}>{userData?.emoji || '👤'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700', fontSize: 18, color: '#fff' }}>{userData?.name || 'Moi'}</Text>
                    <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }} numberOfLines={1}>
                      📍 {userData?.locationName || 'Position non partagée'}
                    </Text>
                  </View>
                </View>

                {/* Status badge */}
                <View style={[s.statusBadge, autoSharing && { backgroundColor: 'rgba(168,255,62,0.12)', borderColor: 'rgba(168,255,62,0.4)' }]}>
                  <Text style={{ color: autoSharing ? '#A8FF3E' : 'rgba(255,255,255,0.5)', fontSize: 12 }}>
                    {statusMsg}
                  </Text>
                </View>

                {/* Batterie inline */}
                {battery !== null && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
                    <View style={{ flex: 1, height: 8, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 4, overflow: 'hidden' }}>
                      <View style={{ width: `${battery}%`, height: '100%', backgroundColor: batColor, borderRadius: 4 }} />
                    </View>
                    <Text style={{ color: batColor, fontSize: 12, fontWeight: '700' }}>{battery}%</Text>
                  </View>
                )}
              </View>

              {/* Boutons */}
              <TouchableOpacity style={s.shareBtn} onPress={sharePosition} disabled={sharing}>
                <Text style={s.shareBtnT}>{sharing ? '📡 Mise à jour...' : '📍 Mettre à jour ma position'}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.autoBtn, autoSharing && { backgroundColor: 'rgba(168,255,62,0.15)', borderColor: '#A8FF3E' }]}
                onPress={setupBackgroundTasks}
              >
                <Text style={{ color: autoSharing ? '#A8FF3E' : '#00C9FF', fontSize: 13, fontWeight: '600' }}>
                  {autoSharing ? '🟢 Partage temps réel actif' : '🔄 Activer partage arrière-plan'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity style={s.stopBtn} onPress={stopSharing}>
                <Text style={{ color: '#FF4757', fontSize: 13 }}>⏹ Arrêter le partage</Text>
              </TouchableOpacity>

              {/* Conseil */}
              <View style={s.tipCard}>
                <Text style={{ color: '#FFA502', fontSize: 12, lineHeight: 20 }}>
                  💡 <Text style={{ fontWeight: '700' }}>Pour un suivi parfait :</Text>{'\n'}
                  • Autorise "Toujours" dans Paramètres › Localisation{'\n'}
                  • Désactive l'optimisation batterie pour Best{'\n'}
                  • Ne force pas la fermeture de l'app
                </Text>
              </View>
            </View>
          )
        )}

        {/* ══ TAB HISTORIQUE ══ */}
        {tab === 'historique' && (
          <View>
            {history.length === 0 ? (
              <View style={s.empty}>
                <Text style={{ fontSize: 36 }}>📋</Text>
                <Text style={{ color: 'rgba(255,255,255,0.3)', marginTop: 8 }}>Aucun historique</Text>
              </View>
            ) : history.map((h, i) => (
              <View key={i} style={s.histItem}>
                <View style={s.histIcon}><Text style={{ fontSize: 16 }}>📍</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, color: '#fff' }}>
                    <Text style={{ color: '#A8FF3E' }}>{h.memberEmoji} {h.memberName}</Text> · {h.event}
                  </Text>
                  <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, fontFamily: 'monospace' }}>
                    {h.timestamp ? timeAgo(h.timestamp) : ''}
                  </Text>
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
  safe: { flex: 1, backgroundColor: '#060B18' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)'
  },
  h1: { fontSize: 18, fontWeight: '700', color: '#fff' },
  hsub: { color: 'rgba(255,255,255,0.4)', fontSize: 10, fontFamily: 'monospace' },
  logoutBtn: {
    width: 36, height: 36, backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)'
  },
  tabBar: { flexDirection: 'row', padding: 8, gap: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  tbtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.06)' },
  tbtnA: { backgroundColor: '#A8FF3E' },
  tbtnT: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600' },
  tbtnTA: { color: '#060B18' },
  blockedCard: { alignItems: 'center', padding: 60 },
  posCard: {
    padding: 16, backgroundColor: 'rgba(168,255,62,0.06)',
    borderWidth: 1, borderColor: 'rgba(168,255,62,0.2)', borderRadius: 16, marginBottom: 12
  },
  statusBadge: {
    padding: 10, backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', marginBottom: 2
  },
  shareBtn: { backgroundColor: '#A8FF3E', borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 8 },
  shareBtnT: { color: '#060B18', fontWeight: '700', fontSize: 14 },
  autoBtn: {
    borderRadius: 12, padding: 12, alignItems: 'center', marginBottom: 8,
    borderWidth: 1, borderColor: 'rgba(0,201,255,0.3)', backgroundColor: 'rgba(0,201,255,0.08)'
  },
  stopBtn: { borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,71,87,0.3)', marginBottom: 12 },
  tipCard: { padding: 14, backgroundColor: 'rgba(255,165,2,0.08)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,165,2,0.2)' },
  empty: { alignItems: 'center', padding: 40 },
  histItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12,
    backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', marginBottom: 8
  },
  histIcon: { width: 32, height: 32, backgroundColor: 'rgba(168,255,62,0.15)', borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
});
