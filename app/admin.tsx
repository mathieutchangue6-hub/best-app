import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Alert, StatusBar, SafeAreaView, Switch
} from 'react-native';
import MapView, { Marker, Callout } from 'react-native-maps';
import firestore from '@react-native-firebase/firestore';

export default function AdminScreen() {
  const [members, setMembers] = useState<any[]>([]);
  const [tab, setTab] = useState<'carte'|'membres'|'acces'|'historique'>('carte');
  const [selMember, setSelMember] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    const unsubM = firestore().collection('members').onSnapshot(snap => {
      setMembers(snap.docs.map(d => d.data()));
    });
    const unsubH = firestore().collection('history').orderBy('timestamp','desc').limit(30).onSnapshot(snap => {
      setHistory(snap.docs.map(d => d.data()));
    });
    return () => { unsubM(); unsubH(); };
  }, []);

  const toggleTracking = async (uid: string, val: boolean) => {
    await firestore().collection('members').doc(uid).update({ trackingEnabled: val });
  };

  const deleteMember = (uid: string, name: string) => {
    Alert.alert('Supprimer ' + name, 'Cette action supprimera définitivement ce membre.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: async () => {
        await firestore().collection('members').doc(uid).delete();
        Alert.alert('✅ ' + name + ' supprimé');
      }}
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
    if (s < 3600) return Math.floor(s/60) + ' min';
    return Math.floor(s/3600) + 'h';
  };

  const activeMembers = members.filter(m => m.lat && m.lng);
  const region = activeMembers.length > 0 ? {
    latitude: activeMembers.reduce((s, m) => s + m.lat, 0) / activeMembers.length,
    longitude: activeMembers.reduce((s, m) => s + m.lng, 0) / activeMembers.length,
    latitudeDelta: 0.05, longitudeDelta: 0.05
  } : { latitude: 4.05, longitude: 9.7, latitudeDelta: 0.5, longitudeDelta: 0.5 };

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#060B18"/>
      <View style={s.header}>
        <View>
          <Text style={s.h1}>🏠 Best</Text>
          <Text style={s.hsub}>{members.filter(m=>m.status==='En déplacement').length} en mouv. · {members.length} membres</Text>
        </View>
        <View style={{flexDirection:'row',gap:8,alignItems:'center'}}>
          <View style={s.adminBadge}><Text style={{color:'#A8FF3E',fontSize:10,fontFamily:'monospace'}}>👑 ADMIN</Text></View>
          <TouchableOpacity style={s.iconBtn} onPress={handleLogout}><Text style={{fontSize:18}}>🚪</Text></TouchableOpacity>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabBar} contentContainerStyle={{gap:6,padding:8}}>
        {(['carte','membres','acces','historique'] as const).map((t,i) => (
          <TouchableOpacity key={t} style={[s.tbtn, tab===t&&s.tbtnA]} onPress={() => setTab(t)}>
            <Text style={[s.tbtnT, tab===t&&s.tbtnTA]}>{['🗺️ Carte','👨‍👩‍👧‍👦 Membres','🔐 Accès','📋 Historique'][i]}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {tab === 'carte' && (
        <View style={{flex:1}}>
          <MapView style={{height:300}} region={region} showsUserLocation={false}>
            {activeMembers.map(m => (
              <Marker key={m.uid} coordinate={{latitude:m.lat,longitude:m.lng}} onPress={() => setSelMember(m)}>
                <View style={[s.markerWrap, {borderColor:m.color||'#A8FF3E'}]}>
                  <Text style={{fontSize:18}}>{m.emoji||'👤'}</Text>
                </View>
                <View style={[s.markerLabel, {backgroundColor:m.color||'#A8FF3E'}]}>
                  <Text style={{color:'#060B18',fontSize:9,fontWeight:'700'}}>{m.name}</Text>
                </View>
              </Marker>
            ))}
          </MapView>
          {selMember && (
            <View style={[s.detailCard, {borderColor:selMember.color||'#A8FF3E'}]}>
              <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                <View style={{flexDirection:'row',alignItems:'center',gap:10}}>
                  <Text style={{fontSize:28}}>{selMember.emoji||'👤'}</Text>
                  <View>
                    <Text style={{color:'#fff',fontWeight:'700',fontSize:16}}>{selMember.name}</Text>
                    <Text style={{color:selMember.color||'#A8FF3E',fontSize:11}}>{selMember.status}</Text>
                  </View>
                </View>
                <TouchableOpacity onPress={() => setSelMember(null)} style={s.closeBtn}>
                  <Text style={{color:'rgba(255,255,255,0.5)'}}>✕</Text>
                </TouchableOpacity>
              </View>
              <View style={s.detailGrid}>
                <View style={s.detailItem}><Text style={s.detailL}>📍 Position</Text><Text style={s.detailV}>{selMember.locationName||'N/A'}</Text></View>
                <View style={s.detailItem}><Text style={s.detailL}>🕐 Vu</Text><Text style={s.detailV}>{timeAgo(selMember.lastSeen)}</Text></View>
                <View style={s.detailItem}><Text style={s.detailL}>🔋 Batterie</Text><Text style={s.detailV}>{selMember.battery ? selMember.battery+'%' : 'N/A'}</Text></View>
                <View style={s.detailItem}><Text style={s.detailL}>📡 Suivi</Text><Text style={s.detailV}>{selMember.trackingEnabled===false?'🚫 Bloqué':'✅ Actif'}</Text></View>
              </View>
            </View>
          )}
          <ScrollView style={{flex:1}} contentContainerStyle={{padding:12}}>
            {members.map(m => <MemberCard key={m.uid} m={m} onPress={() => setSelMember(m)} timeAgo={timeAgo}/>)}
          </ScrollView>
        </View>
      )}

      {tab === 'membres' && (
        <ScrollView contentContainerStyle={{padding:14}}>
          {members.map(m => <MemberCard key={m.uid} m={m} onPress={() => {}} timeAgo={timeAgo}/>)}
        </ScrollView>
      )}

      {tab === 'acces' && (
        <ScrollView contentContainerStyle={{padding:14}}>
          <Text style={{color:'rgba(255,255,255,0.5)',fontSize:12,marginBottom:12}}>Active/désactive le suivi. Supprime si nécessaire.</Text>
          {members.map(m => {
            const en = m.trackingEnabled !== false;
            return (
              <View key={m.uid} style={s.accessRow}>
                <View style={{flexDirection:'row',alignItems:'center',gap:10,flex:1}}>
                  <Text style={{fontSize:24}}>{m.emoji||'👤'}</Text>
                  <View>
                    <Text style={{fontWeight:'600',fontSize:14,color:'#fff'}}>{m.name}</Text>
                    <Text style={{fontSize:11,color:en?'#A8FF3E':'#FF4757'}}>{en?'✅ Suivi actif':'🚫 Désactivé'}</Text>
                    <Text style={{fontSize:10,color:'rgba(255,255,255,0.3)'}}>{m.email||''}</Text>
                  </View>
                </View>
                <View style={{flexDirection:'row',alignItems:'center',gap:8}}>
                  <TouchableOpacity style={s.delBtn} onPress={() => deleteMember(m.uid, m.name)}>
                    <Text style={{color:'#FF4757',fontSize:11}}>🗑️</Text>
                  </TouchableOpacity>
                  <Switch value={en} onValueChange={v => toggleTracking(m.uid, v)} trackColor={{false:'rgba(255,255,255,0.15)',true:'#A8FF3E'}} thumbColor={en?'#060B18':'white'}/>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}

      {tab === 'historique' && (
        <ScrollView contentContainerStyle={{padding:14}}>
          {history.map((h,i) => (
            <View key={i} style={s.histItem}>
              <View style={s.histIcon}><Text style={{fontSize:15}}>📍</Text></View>
              <View>
                <Text style={{fontSize:12,color:'#fff'}}><Text style={{color:'#A8FF3E'}}>{h.memberEmoji} {h.memberName}</Text> · {h.event}</Text>
                <Text style={{color:'rgba(255,255,255,0.3)',fontSize:10}}>{h.timestamp ? timeAgo(h.timestamp) : ''}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function MemberCard({ m, onPress, timeAgo }: any) {
  const bat = m.battery || 0;
  const bc = bat < 20 ? '#FF4757' : bat < 40 ? '#FFA502' : m.color || '#A8FF3E';
  return (
    <TouchableOpacity style={[s.mc, m.trackingEnabled===false&&{opacity:0.45}]} onPress={onPress}>
      <View style={{flexDirection:'row',alignItems:'center',gap:10}}>
        <View style={[s.mav, {borderColor:m.color||'#A8FF3E',backgroundColor:`${m.color||'#A8FF3E'}22`}]}>
          <Text style={{fontSize:22}}>{m.emoji||'👤'}</Text>
        </View>
        <View style={{flex:1}}>
          <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center'}}>
            <Text style={{fontWeight:'600',fontSize:13,color:'#fff'}}>{m.name} {m.trackingEnabled===false?'🚫':''}</Text>
            <View style={{backgroundColor:m.status==='En déplacement'?'rgba(168,255,62,0.15)':'rgba(255,255,255,0.08)',paddingHorizontal:7,paddingVertical:2,borderRadius:20}}>
              <Text style={{color:m.status==='En déplacement'?'#A8FF3E':'rgba(255,255,255,0.4)',fontSize:9}}>{m.status==='En déplacement'?'● MOUV.':'● ARRÊTÉ'}</Text>
            </View>
          </View>
          <Text style={{color:'rgba(255,255,255,0.4)',fontSize:11,marginTop:2}} numberOfLines={1}>📍 {m.locationName||(m.lat?m.lat.toFixed(4)+'°':'Position inconnue')} · {timeAgo(m.lastSeen)}</Text>
          {m.battery ? (
            <View style={{flexDirection:'row',alignItems:'center',gap:5,marginTop:4}}>
              <View style={{width:36,height:7,backgroundColor:'rgba(255,255,255,0.1)',borderRadius:4,overflow:'hidden'}}>
                <View style={{width:`${bat}%`,height:'100%',backgroundColor:bc,borderRadius:4}}/>
              </View>
              <Text style={{color:bc,fontSize:10}}>{bat}%</Text>
            </View>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  safe:{flex:1,backgroundColor:'#060B18'},
  header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',padding:16,borderBottomWidth:1,borderBottomColor:'rgba(255,255,255,0.06)'},
  h1:{fontSize:17,fontWeight:'700',color:'#fff'},
  hsub:{color:'rgba(255,255,255,0.4)',fontSize:10,fontFamily:'monospace'},
  adminBadge:{paddingHorizontal:10,paddingVertical:4,backgroundColor:'rgba(168,255,62,0.15)',borderWidth:1,borderColor:'rgba(168,255,62,0.4)',borderRadius:20},
  iconBtn:{width:34,height:34,backgroundColor:'rgba(255,255,255,0.07)',borderRadius:17,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:'rgba(255,255,255,0.1)'},
  tabBar:{borderBottomWidth:1,borderBottomColor:'rgba(255,255,255,0.05)'},
  tbtn:{paddingHorizontal:14,paddingVertical:7,borderRadius:20,backgroundColor:'rgba(255,255,255,0.06)'},
  tbtnA:{backgroundColor:'#A8FF3E'},
  tbtnT:{color:'rgba(255,255,255,0.5)',fontSize:12,fontWeight:'600'},
  tbtnTA:{color:'#060B18'},
  markerWrap:{width:38,height:38,borderRadius:19,backgroundColor:'#0D1528',borderWidth:2.5,alignItems:'center',justifyContent:'center'},
  markerLabel:{paddingHorizontal:5,paddingVertical:1,borderRadius:4,marginTop:2,alignSelf:'center'},
  detailCard:{margin:12,padding:14,backgroundColor:'rgba(10,15,30,0.95)',borderWidth:1,borderRadius:14},
  detailGrid:{flexDirection:'row',flexWrap:'wrap',gap:8,marginTop:10},
  detailItem:{flex:1,minWidth:'45%',padding:10,backgroundColor:'rgba(255,255,255,0.05)',borderRadius:10},
  detailL:{color:'rgba(255,255,255,0.4)',fontSize:10,marginBottom:3},
  detailV:{fontWeight:'600',fontSize:12,color:'#fff'},
  closeBtn:{width:28,height:28,backgroundColor:'rgba(255,255,255,0.08)',borderRadius:14,alignItems:'center',justifyContent:'center'},
  mc:{padding:12,backgroundColor:'rgba(255,255,255,0.03)',borderWidth:1,borderColor:'rgba(255,255,255,0.06)',borderRadius:12,marginBottom:8},
  mav:{width:42,height:42,borderRadius:21,alignItems:'center',justifyContent:'center',borderWidth:2},
  accessRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',padding:14,backgroundColor:'rgba(255,255,255,0.03)',borderRadius:10,borderWidth:1,borderColor:'rgba(255,255,255,0.06)',marginBottom:8},
  delBtn:{padding:8,backgroundColor:'rgba(255,71,87,0.15)',borderRadius:8,borderWidth:1,borderColor:'rgba(255,71,87,0.3)'},
  histItem:{flexDirection:'row',alignItems:'center',gap:10,padding:12,backgroundColor:'rgba(255,255,255,0.03)',borderRadius:10,borderWidth:1,borderColor:'rgba(255,255,255,0.05)',marginBottom:8},
  histIcon:{width:32,height:32,backgroundColor:'rgba(168,255,62,0.15)',borderRadius:8,alignItems:'center',justifyContent:'center'},
});
