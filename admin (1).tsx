import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Alert, StatusBar, SafeAreaView, Switch, Animated, Dimensions, Linking,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import firestore from '@react-native-firebase/firestore';
import * as Location from 'expo-location';
import DeviceInfo from 'react-native-device-info';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#0d1117' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8ec3b9' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a3646' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1a2744' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2c3e6d' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1626' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#111827' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#0a111e' }] },
];

export default function AdminScreen() {
  const [members, setMembers] = useState<any[]>([]);
  const [tab, setTab] = useState<'carte' | 'membres' | 'acces' | 'historique' | 'quick'>('carte');
  const [selMember, setSelMember] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [mapType, setMapType] = useState<'standard' | 'satellite' | 'terrain'>('standard');
  const [adminLocation, setAdminLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [isAdminDevice, setIsAdminDevice] = useState(false);

  const panelAnim = useRef(new Animated.Value(0)).current;
  const mapRef = useRef<MapView>(null);

  // ── Device check ─────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const adminDoc = await firestore().collection('config').doc('adminDevice').get();
        const deviceId = await DeviceInfo.getUniqueId();
        if (adminDoc.exists && adminDoc.data()?.deviceId === deviceId) {
          setIsAdminDevice(true);
        } else if (!adminDoc.exists) {
          await firestore().collection('config').doc('adminDevice').set({ deviceId });
          setIsAdminDevice(true);
        }
      } catch {
        setIsAdminDevice(true);
      }
    })();
  }, []);

  // ── Admin GPS ultra-précis ────────────────────────────────────────────────
  useEffect(() => {
    if (!isAdminDevice) return;
    let sub: any;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      // Position immédiate haute précision
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
      });
      setAdminLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      mapRef.current?.animateToRegion({
        latitude: loc.coords.latitude, longitude: loc.coords.longitude,
        latitudeDelta: 0.008, longitudeDelta: 0.008,
      }, 800);
      // Suivi continu toutes les 5 secondes / 5 mètres
      sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 5000,
          distanceInterval: 5,
        },
        (l) => {
          setAdminLocation({ lat: l.coords.latitude, lng: l.coords.longitude });
          firestore().collection('config').doc('adminLocation').set({
            lat: l.coords.latitude, lng: l.coords.longitude,
            updatedAt: firestore.FieldValue.serverTimestamp(),
          });
        }
      );
    })();
    return () => sub?.remove?.();
  }, [isAdminDevice]);

  // ── Firestore ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const unsubM = firestore().collection('members').onSnapshot(snap => {
      setMembers(snap.docs.map(d => ({ ...d.data(), uid: d.id })));
    });
    const unsubH = firestore().collection('history')
      .orderBy('timestamp', 'desc').limit(30)
      .onSnapshot(snap => setHistory(snap.docs.map(d => d.data())));
    return () => { unsubM(); unsubH(); };
  }, []);

  // ── Panel ─────────────────────────────────────────────────────────────────
  const togglePanel = () => {
    const toValue = panelOpen ? 0 : 1;
    Animated.spring(panelAnim, { toValue, useNativeDriver: true, tension: 65, friction: 11 }).start();
    setPanelOpen(!panelOpen);
  };

  const panelTranslateY = panelAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [SCREEN_HEIGHT * 0.4, 0],
  });

  // ── Map ───────────────────────────────────────────────────────────────────
  const centerOnAdmin = () => {
    if (!adminLocation) { Alert.alert('Position admin indisponible'); return; }
    mapRef.current?.animateToRegion({
      latitude: adminLocation.lat, longitude: adminLocation.lng,
      latitudeDelta: 0.005, longitudeDelta: 0.005,
    }, 600);
  };

  const focusMember = (m: any) => {
    if (!m.lat || !m.lng) { Alert.alert('Position inconnue pour ' + m.name); return; }
    setSelMember(m);
    if (tab !== 'carte') setTab('carte');
    setTimeout(() => {
      mapRef.current?.animateToRegion({
        latitude: m.lat, longitude: m.lng,
        latitudeDelta: 0.005, longitudeDelta: 0.005,
      }, 600);
    }, 100);
  };

  // ── Firestore actions ─────────────────────────────────────────────────────
  const toggleTracking = async (uid: string, val: boolean) => {
    await firestore().collection('members').doc(uid).update({ trackingEnabled: val });
  };

  const deleteMember = (uid: string, name: string) => {
    Alert.alert('Supprimer ' + name, 'Action irréversible.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer', style: 'destructive', onPress: async () => {
          await firestore().collection('members').doc(uid).delete();
          Alert.alert('✅ ' + name + ' supprimé');
        }
      }
    ]);
  };

  const handleLogout = () => {
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

  const activeMembers = members.filter(m => m.lat && m.lng);
  const initialRegion = adminLocation
    ? { latitude: adminLocation.lat, longitude: adminLocation.lng, latitudeDelta: 0.008, longitudeDelta: 0.008 }
    : { latitude: 4.05, longitude: 9.7, latitudeDelta: 0.5, longitudeDelta: 0.5 };

  const TABS = [
    { key: 'carte',      label: '🗺️ Carte' },
    { key: 'membres',    label: '👨‍👩‍👧‍👦 Membres' },
    { key: 'acces',      label: '🔐 Accès' },
    { key: 'historique', label: '📋 Historique' },
    { key: 'quick',      label: '🔍 Quick' },
  ] as const;

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="#060B18" />

      {/* ── Header + Tabs ── */}
      <SafeAreaView style={s.headerSafe}>
        <View style={s.header}>
          <View>
            <Text style={s.h1}>🏠 Best</Text>
            <Text style={s.hsub}>
              {members.filter(m => m.status === 'En déplacement').length} en mouv. · {members.length} membres
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <View style={s.adminBadge}>
              <Text style={{ color: '#A8FF3E', fontSize: 10, fontFamily: 'monospace' }}>👑 ADMIN</Text>
            </View>
            <TouchableOpacity style={s.iconBtn} onPress={handleLogout}>
              <Text style={{ fontSize: 18 }}>🚪</Text>
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          horizontal showsHorizontalScrollIndicator={false}
          style={s.tabBar}
          contentContainerStyle={{ gap: 6, paddingHorizontal: 12, paddingVertical: 8 }}
        >
          {TABS.map(t => (
            <TouchableOpacity key={t.key} style={[s.tbtn, tab === t.key && s.tbtnA]} onPress={() => setTab(t.key)}>
              <Text style={[s.tbtnT, tab === t.key && s.tbtnTA]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </SafeAreaView>

      {/* ══════════════════════════════════════════════════════════════════════
          TAB : CARTE
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'carte' && (
        <View style={s.mapContainer}>
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            provider={PROVIDER_GOOGLE}
            mapType={mapType === 'terrain' ? 'terrain' : mapType}
            customMapStyle={mapType === 'standard' ? DARK_MAP_STYLE : undefined}
            initialRegion={initialRegion}
            showsUserLocation={false}
            showsCompass={false}
            showsMyLocationButton={false}
          >
            {activeMembers.map(m => (
              <Marker key={m.uid} coordinate={{ latitude: m.lat, longitude: m.lng }} onPress={() => setSelMember(m)}>
                <View style={[s.markerWrap, { borderColor: m.color || '#A8FF3E' }]}>
                  <Text style={{ fontSize: 18 }}>{m.emoji || '👤'}</Text>
                </View>
                <View style={[s.markerLabel, { backgroundColor: m.color || '#A8FF3E' }]}>
                  <Text style={{ color: '#060B18', fontSize: 9, fontWeight: '700' }}>{m.name}</Text>
                </View>
              </Marker>
            ))}
            {adminLocation && (
              <Marker coordinate={{ latitude: adminLocation.lat, longitude: adminLocation.lng }} anchor={{ x: 0.5, y: 0.5 }}>
                <View style={s.adminMarker}><Text style={{ fontSize: 22 }}>📌</Text></View>
              </Marker>
            )}
          </MapView>

          {/* Boutons mode carte */}
          <View style={s.mapControls}>
            <TouchableOpacity style={s.mapCtrlBtn} onPress={centerOnAdmin}>
              <Text style={{ fontSize: 16 }}>📌</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.mapCtrlBtn, mapType === 'standard' && s.mapCtrlBtnActive]} onPress={() => setMapType('standard')}>
              <Text style={{ fontSize: 16 }}>🌐</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.mapCtrlBtn, mapType === 'satellite' && s.mapCtrlBtnActive]} onPress={() => setMapType('satellite')}>
              <Text style={{ fontSize: 16 }}>🛰️</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.mapCtrlBtn, mapType === 'terrain' && s.mapCtrlBtnActive]} onPress={() => setMapType('terrain')}>
              <Text style={{ fontSize: 16 }}>🏔️</Text>
            </TouchableOpacity>
          </View>

          {/* Fiche membre sélectionné */}
          {selMember && (
            <View style={[s.detailCard, { borderColor: selMember.color || '#A8FF3E' }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ fontSize: 26 }}>{selMember.emoji || '👤'}</Text>
                  <View>
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{selMember.name}</Text>
                    <Text style={{ color: selMember.color || '#A8FF3E', fontSize: 11 }}>{selMember.status}</Text>
                  </View>
                </View>
                <TouchableOpacity onPress={() => setSelMember(null)} style={s.closeBtn}>
                  <Text style={{ color: 'rgba(255,255,255,0.5)' }}>✕</Text>
                </TouchableOpacity>
              </View>
              <View style={s.detailGrid}>
                <View style={s.detailItem}>
                  <Text style={s.detailL}>📍 Position</Text>
                  <Text style={s.detailV} numberOfLines={1}>{selMember.locationName || 'N/A'}</Text>
                </View>
                <View style={s.detailItem}>
                  <Text style={s.detailL}>🕐 Vu</Text>
                  <Text style={s.detailV}>{timeAgo(selMember.lastSeen)}</Text>
                </View>
                <View style={s.detailItem}>
                  <Text style={s.detailL}>🔋 Batterie</Text>
                  <Text style={s.detailV}>{selMember.battery ? selMember.battery + '%' : 'N/A'}</Text>
                </View>
                <View style={s.detailItem}>
                  <Text style={s.detailL}>📡 Suivi</Text>
                  <Text style={s.detailV}>{selMember.trackingEnabled === false ? '🚫 Bloqué' : '✅ Actif'}</Text>
                </View>
              </View>
            </View>
          )}

          {/* Bouton panel — zIndex 35 */}
          <TouchableOpacity style={s.panelToggleBtn} onPress={togglePanel}>
            <Text style={{ fontSize: 12, color: '#060B18', fontWeight: '700' }}>
              {panelOpen ? '▼ Fermer' : '▲ Membres'}
            </Text>
          </TouchableOpacity>

          {/* Panel coulissant */}
          <Animated.View style={[s.slidingPanel, { transform: [{ translateY: panelTranslateY }] }]}>
            <TouchableOpacity onPress={togglePanel} style={s.panelHandleArea} activeOpacity={0.6}>
              <View style={s.panelHandle} />
              <Text style={s.panelHandleHint}>{panelOpen ? '▼ fermer' : '▲ ouvrir'}</Text>
            </TouchableOpacity>
            <Text style={s.panelTitle}>👨‍👩‍👧‍👦 Membres — appuie pour localiser</Text>
            <ScrollView
              showsVerticalScrollIndicator={false}
              style={{ maxHeight: SCREEN_HEIGHT * 0.3 }}
              contentContainerStyle={{ paddingBottom: 16 }}
            >
              {members.map(m => (
                <MemberCard
                  key={m.uid} m={m} timeAgo={timeAgo}
                  onPress={() => { focusMember(m); if (panelOpen) togglePanel(); }}
                />
              ))}
            </ScrollView>
          </Animated.View>
        </View>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB : MEMBRES
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'membres' && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14 }}>
          {members.map(m => (
            <MemberCard key={m.uid} m={m} onPress={() => focusMember(m)} timeAgo={timeAgo} />
          ))}
        </ScrollView>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB : ACCÈS
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'acces' && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14 }}>
          <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginBottom: 12 }}>
            Active/désactive le suivi. Supprime si nécessaire.
          </Text>
          {members.map(m => {
            const en = m.trackingEnabled !== false;
            return (
              <View key={m.uid} style={s.accessRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                  <Text style={{ fontSize: 24 }}>{m.emoji || '👤'}</Text>
                  <View>
                    <Text style={{ fontWeight: '600', fontSize: 14, color: '#fff' }}>{m.name}</Text>
                    <Text style={{ fontSize: 11, color: en ? '#A8FF3E' : '#FF4757' }}>
                      {en ? '✅ Suivi actif' : '🚫 Désactivé'}
                    </Text>
                    <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{m.email || ''}</Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <TouchableOpacity style={s.delBtn} onPress={() => deleteMember(m.uid, m.name)}>
                    <Text style={{ color: '#FF4757', fontSize: 11 }}>🗑️</Text>
                  </TouchableOpacity>
                  <Switch
                    value={en}
                    onValueChange={v => toggleTracking(m.uid, v)}
                    trackColor={{ false: 'rgba(255,255,255,0.15)', true: '#A8FF3E' }}
                    thumbColor={en ? '#060B18' : 'white'}
                  />
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB : HISTORIQUE
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'historique' && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14 }}>
          {history.map((h, i) => (
            <View key={i} style={s.histItem}>
              <View style={s.histIcon}><Text style={{ fontSize: 15 }}>📍</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, color: '#fff' }}>
                  <Text style={{ color: '#A8FF3E' }}>{h.memberEmoji} {h.memberName}</Text> · {h.event}
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>
                  {h.timestamp ? timeAgo(h.timestamp) : ''}
                </Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB : QUICK LOCATION
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'quick' && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>

          {/* Titre */}
          <View style={s.quickHeader}>
            <Text style={{ fontSize: 32, marginBottom: 8 }}>🔍</Text>
            <Text style={s.quickTitle}>Quick Location</Text>
            <Text style={s.quickSub}>
              Pour localiser un téléphone{'\n'}non inscrit dans Best
            </Text>
          </View>

          {/* Explication */}
          <View style={s.quickInfoCard}>
            <Text style={{ color: '#FFA502', fontSize: 12, lineHeight: 20 }}>
              ⚠️ <Text style={{ fontWeight: '700' }}>Comment ça marche :</Text>{'\n'}
              Appuie sur le bouton correspondant à l'appareil de la personne. 
              Le service s'ouvre directement. Entre son compte Gmail (Android) 
              ou son identifiant Apple (iPhone) pour voir sa position.{'\n\n'}
              ✅ <Text style={{ fontWeight: '700' }}>Condition :</Text> La personne doit avoir activé 
              "Localiser mon appareil" dans ses paramètres au préalable.
            </Text>
          </View>

          {/* Android */}
          <View style={s.quickCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <View style={s.quickIconWrap}>
                <Text style={{ fontSize: 28 }}>🤖</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.quickCardTitle}>Android</Text>
                <Text style={s.quickCardSub}>Google Find My Device</Text>
              </View>
            </View>
            <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginBottom: 12, lineHeight: 17 }}>
              Localise n'importe quel téléphone Android lié à un compte Google. 
              Entre son adresse Gmail quand la page s'ouvre.
            </Text>
            <TouchableOpacity
              style={s.quickBtnAndroid}
              onPress={() => Linking.openURL('https://www.google.com/android/find')}
            >
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>
                🔍 Ouvrir Google Find My Device
              </Text>
            </TouchableOpacity>
          </View>

          {/* iPhone */}
          <View style={s.quickCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <View style={[s.quickIconWrap, { backgroundColor: 'rgba(255,255,255,0.08)' }]}>
                <Text style={{ fontSize: 28 }}>🍎</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.quickCardTitle}>iPhone</Text>
                <Text style={s.quickCardSub}>Apple Find My / Localiser</Text>
              </View>
            </View>
            <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginBottom: 12, lineHeight: 17 }}>
              Localise un iPhone via iCloud. Entre son identifiant Apple 
              (adresse email Apple) quand la page s'ouvre.
            </Text>
            <TouchableOpacity
              style={s.quickBtnApple}
              onPress={() => Linking.openURL('https://www.icloud.com/find')}
            >
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>
                🔍 Ouvrir Apple Find My
              </Text>
            </TouchableOpacity>
          </View>

          {/* Astuce finale */}
          <View style={[s.quickInfoCard, { borderColor: 'rgba(168,255,62,0.2)', backgroundColor: 'rgba(168,255,62,0.05)' }]}>
            <Text style={{ color: '#A8FF3E', fontSize: 12, lineHeight: 20 }}>
              💡 <Text style={{ fontWeight: '700' }}>Conseil préventif :</Text>{'\n'}
              Demande à chaque membre de ta famille d'installer Best et de s'inscrire 
              dès maintenant — avant toute urgence. C'est la solution la plus fiable 
              et la plus précise.
            </Text>
          </View>

        </ScrollView>
      )}
    </View>
  );
}

// ─── MemberCard ───────────────────────────────────────────────────────────────
function MemberCard({ m, onPress, timeAgo }: any) {
  const bat = m.battery || 0;
  const bc = bat < 20 ? '#FF4757' : bat < 40 ? '#FFA502' : m.color || '#A8FF3E';
  return (
    <TouchableOpacity style={[s.mc, m.trackingEnabled === false && { opacity: 0.45 }]} onPress={onPress}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={[s.mav, { borderColor: m.color || '#A8FF3E', backgroundColor: `${m.color || '#A8FF3E'}22` }]}>
          <Text style={{ fontSize: 22 }}>{m.emoji || '👤'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontWeight: '600', fontSize: 13, color: '#fff' }}>
              {m.name} {m.trackingEnabled === false ? '🚫' : ''}
            </Text>
            <View style={{
              backgroundColor: m.status === 'En déplacement' ? 'rgba(168,255,62,0.15)' : 'rgba(255,255,255,0.08)',
              paddingHorizontal: 7, paddingVertical: 2, borderRadius: 20
            }}>
              <Text style={{ color: m.status === 'En déplacement' ? '#A8FF3E' : 'rgba(255,255,255,0.4)', fontSize: 9 }}>
                {m.status === 'En déplacement' ? '● MOUV.' : '● ARRÊTÉ'}
              </Text>
            </View>
          </View>
          <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 2 }} numberOfLines={1}>
            📍 {m.locationName || (m.lat ? m.lat.toFixed(4) + '°' : 'Position inconnue')} · {timeAgo(m.lastSeen)}
          </Text>
          {m.battery ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 }}>
              <View style={{ width: 36, height: 7, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 4, overflow: 'hidden' }}>
                <View style={{ width: `${bat}%`, height: '100%', backgroundColor: bc, borderRadius: 4 }} />
              </View>
              <Text style={{ color: bc, fontSize: 10 }}>{bat}%</Text>
            </View>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#060B18' },
  headerSafe: { backgroundColor: '#060B18', zIndex: 10 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)'
  },
  h1: { fontSize: 17, fontWeight: '700', color: '#fff' },
  hsub: { color: 'rgba(255,255,255,0.4)', fontSize: 10, fontFamily: 'monospace' },
  adminBadge: {
    paddingHorizontal: 10, paddingVertical: 4,
    backgroundColor: 'rgba(168,255,62,0.15)',
    borderWidth: 1, borderColor: 'rgba(168,255,62,0.4)', borderRadius: 20
  },
  iconBtn: {
    width: 34, height: 34, backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)'
  },
  tabBar: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  tbtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.06)', minWidth: 80, alignItems: 'center' },
  tbtnA: { backgroundColor: '#A8FF3E' },
  tbtnT: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600' },
  tbtnTA: { color: '#060B18' },

  // ── Map ──
  mapContainer: { flex: 1, position: 'relative' },
  mapControls: { position: 'absolute', top: 12, right: 12, gap: 8, zIndex: 20 },
  mapCtrlBtn: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: 'rgba(6,11,24,0.88)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  mapCtrlBtnActive: { backgroundColor: 'rgba(168,255,62,0.2)', borderColor: '#A8FF3E' },
  adminMarker: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(168,255,62,0.2)',
    borderWidth: 2.5, borderColor: '#A8FF3E',
    alignItems: 'center', justifyContent: 'center',
  },
  markerWrap: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: '#0D1528', borderWidth: 2.5,
    alignItems: 'center', justifyContent: 'center',
  },
  markerLabel: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, marginTop: 2, alignSelf: 'center' },
  detailCard: {
    position: 'absolute', top: 12, left: 12, right: 64,
    padding: 12, backgroundColor: 'rgba(8,12,28,0.96)',
    borderWidth: 1, borderRadius: 14, zIndex: 20,
  },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  detailItem: { flex: 1, minWidth: '45%', padding: 8, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 10 },
  detailL: { color: 'rgba(255,255,255,0.4)', fontSize: 10, marginBottom: 2 },
  detailV: { fontWeight: '600', fontSize: 11, color: '#fff' },
  closeBtn: { width: 26, height: 26, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  panelToggleBtn: {
    position: 'absolute', bottom: 14,
    left: '28%', right: '28%',
    backgroundColor: '#A8FF3E', borderRadius: 24,
    paddingVertical: 10, paddingHorizontal: 18,
    alignItems: 'center', zIndex: 35,
    shadowColor: '#A8FF3E', shadowOpacity: 0.45, shadowRadius: 10, elevation: 8,
  },
  slidingPanel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(8,12,28,0.97)',
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    borderTopWidth: 1, borderColor: 'rgba(168,255,62,0.2)',
    paddingHorizontal: 14, paddingBottom: 8, zIndex: 30,
    maxHeight: SCREEN_HEIGHT * 0.48,
  },
  panelHandleArea: { alignItems: 'center', paddingTop: 10, paddingBottom: 6 },
  panelHandle: { width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.25)' },
  panelHandleHint: { color: 'rgba(255,255,255,0.2)', fontSize: 10, marginTop: 3 },
  panelTitle: { color: 'rgba(255,255,255,0.45)', fontSize: 11, marginBottom: 8, fontFamily: 'monospace' },

  // ── Cards communes ──
  mc: {
    padding: 12, backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', borderRadius: 12, marginBottom: 8,
  },
  mav: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  accessRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 14, backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', marginBottom: 8,
  },
  delBtn: { padding: 8, backgroundColor: 'rgba(255,71,87,0.15)', borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,71,87,0.3)' },
  histItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12,
    backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', marginBottom: 8,
  },
  histIcon: { width: 32, height: 32, backgroundColor: 'rgba(168,255,62,0.15)', borderRadius: 8, alignItems: 'center', justifyContent: 'center' },

  // ── Quick Location ──
  quickHeader: {
    alignItems: 'center', paddingVertical: 20,
    marginBottom: 16,
  },
  quickTitle: { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 6 },
  quickSub: { color: 'rgba(255,255,255,0.4)', fontSize: 13, textAlign: 'center', lineHeight: 20 },
  quickInfoCard: {
    padding: 14, backgroundColor: 'rgba(255,165,2,0.08)',
    borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,165,2,0.25)',
    marginBottom: 14,
  },
  quickCard: {
    padding: 16, backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 14,
  },
  quickCardTitle: { fontSize: 16, fontWeight: '700', color: '#fff' },
  quickCardSub: { fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  quickIconWrap: {
    width: 52, height: 52, borderRadius: 14,
    backgroundColor: 'rgba(168,255,62,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  quickBtnAndroid: {
    backgroundColor: '#34A853',
    borderRadius: 12, padding: 13, alignItems: 'center',
  },
  quickBtnApple: {
    backgroundColor: '#555',
    borderRadius: 12, padding: 13, alignItems: 'center',
  },
});
