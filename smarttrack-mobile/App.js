import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
  ActivityIndicator,
  StatusBar,
  SafeAreaView,
  Alert
} from 'react-native';

const API_BASE_URL = 'https://smarttrack-backend-v614.onrender.com';

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [isRegisterMode, setIsRegisterMode] = useState(false);

  // Form Fields
  const [loginId, setLoginId] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [regFullName, setRegFullName] = useState('');
  const [regId, setRegId] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regDept, setRegDept] = useState('BSIT');
  const [regPassword, setRegPassword] = useState('');

  // Modals & Status
  const [loading, setLoading] = useState(false);
  const [showSentModal, setShowSentModal] = useState(false);
  const [sentEmailAddress, setSentEmailAddress] = useState('');
  const [borrowModalItem, setBorrowModalItem] = useState(null);
  const [borrowQty, setBorrowQty] = useState('1');
  const [borrowPurpose, setBorrowPurpose] = useState('Academic Laboratory Project');
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  // App Tabs
  const [activeTab, setActiveTab] = useState('Catalog');
  const [catalog, setCatalog] = useState([]);
  const [tickets, setTickets] = useState([]);

  const fetchInventory = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/public/inventory`);
      const data = await res.json();
      if (Array.isArray(data)) setCatalog(data);
    } catch (e) {
      console.log('Error fetching inventory:', e);
    }
  };

  const fetchTickets = async (id) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/public/requests?identifier=${id}`);
      const data = await res.json();
      if (Array.isArray(data)) setTickets(data);
    } catch (e) {
      console.log('Error fetching tickets:', e);
    }
  };

  useEffect(() => {
    if (currentUser) {
      fetchInventory();
      fetchTickets(currentUser.identifier);
      const interval = setInterval(() => {
        fetchTickets(currentUser.identifier);
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [currentUser]);

  const handleLogin = async () => {
    if (!loginId || !loginPassword) {
      Alert.alert('Notice', 'Please enter your ID and password');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/borrowers/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: loginId, password: loginPassword })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCurrentUser(data.user);
      } else {
        Alert.alert('Login Notice', data.error || 'Login failed');
      }
    } catch (err) {
      Alert.alert('Connection Diagnostic', `Target: ${API_BASE_URL}\n\nDetail: ${err.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!regFullName || !regId || !regEmail || !regPassword) {
      Alert.alert('Notice', 'Please fill out all registration fields.');
      return;
    }
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE_URL}/api/borrowers/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: regFullName,
          identifier: regId,
          email: regEmail,
          department: regDept,
          password: regPassword
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setSentEmailAddress(regEmail);
        setShowSentModal(true);
      } else {
        Alert.alert('Registration Notice', data.error || 'Registration failed');
      }
    } catch (err) {
      Alert.alert(
        'Exact Connection Error',
        `URL: ${API_BASE_URL}/api/borrowers/register\n\nError: ${err.message || String(err)}`
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitBorrow = async () => {
    if (!borrowModalItem) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/public/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requester_name: currentUser.full_name,
          identifier: currentUser.identifier,
          item_name: borrowModalItem.name,
          quantity: parseInt(borrowQty) || 1,
          purpose: borrowPurpose
        })
      });
      const data = await res.json();
      if (res.ok) {
        setBorrowModalItem(null);
        setShowSuccessModal(true);
        fetchTickets(currentUser.identifier);
        setActiveTab('My Tickets');
      } else {
        Alert.alert('Error', data.error || 'Failed to submit requisition');
      }
    } catch (e) {
      Alert.alert('Error', 'Error submitting request');
    } finally {
      setLoading(false);
    }
  };

  if (!currentUser) {
    return (
      <SafeAreaView style={styles.authContainer}>
        <StatusBar barStyle="light-content" />
        <View style={styles.headerArea}>
          <Text style={styles.brandTitle}>CDM SMARTTRACK</Text>
          <Text style={styles.brandSubtitle}>Colegio de Montalban Borrower</Text>
        </View>

        {!isRegisterMode ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Borrower Sign In</Text>

            <TextInput
              style={styles.input}
              placeholder="Student / Faculty ID"
              placeholderTextColor="#64748b"
              value={loginId}
              onChangeText={setLoginId}
              autoCapitalize="none"
            />

            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor="#64748b"
              value={loginPassword}
              onChangeText={setLoginPassword}
              secureTextEntry
            />

            <TouchableOpacity style={styles.primaryButton} onPress={handleLogin} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign In</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={styles.switchButton} onPress={() => setIsRegisterMode(true)}>
              <Text style={styles.switchText}>New Borrower? Register with Gmail →</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Borrower Registration</Text>

            <TextInput
              style={styles.input}
              placeholder="Full Name (e.g. Juan Dela Cruz)"
              placeholderTextColor="#64748b"
              value={regFullName}
              onChangeText={setRegFullName}
            />

            <TextInput
              style={styles.input}
              placeholder="Student / Faculty ID (e.g. 2023-0012)"
              placeholderTextColor="#64748b"
              value={regId}
              onChangeText={setRegId}
              autoCapitalize="none"
            />

            <TextInput
              style={styles.input}
              placeholder="Active Gmail Address"
              placeholderTextColor="#64748b"
              value={regEmail}
              onChangeText={setRegEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <TextInput
              style={styles.input}
              placeholder="BSIT"
              placeholderTextColor="#64748b"
              value={regDept}
              onChangeText={setRegDept}
            />

            <TextInput
              style={styles.input}
              placeholder="Create Password"
              placeholderTextColor="#64748b"
              value={regPassword}
              onChangeText={setRegPassword}
              secureTextEntry
            />

            <TouchableOpacity style={styles.primaryButton} onPress={handleRegister} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Send Activation Email</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={styles.switchButton} onPress={() => setIsRegisterMode(false)}>
              <Text style={styles.switchText}>Already registered? Sign In →</Text>
            </TouchableOpacity>
          </View>
        )}

        <Modal visible={showSentModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.activationDialog}>
              <Text style={styles.dialogHeading}>Activation Link Sent!</Text>
              <Text style={styles.dialogText}>
                We have sent an activation button to <Text style={{ color: '#fff', fontWeight: 'bold' }}>{sentEmailAddress}</Text>.
              </Text>

              <Text style={styles.stepText}>1. Open your Gmail.</Text>
              <Text style={styles.stepText}>2. Tap "Activate My Account".</Text>
              <Text style={styles.stepText}>3. Come back here and Sign In!</Text>

              <TouchableOpacity
                style={styles.dialogButton}
                onPress={() => {
                  setShowSentModal(false);
                  setIsRegisterMode(false);
                }}
              >
                <Text style={styles.dialogButtonText}>GO TO SIGN IN</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.mainContainer}>
      <StatusBar barStyle="light-content" />

      <View style={styles.portalHeader}>
        <View>
          <Text style={styles.portalTitle}>CDM SmartTrack</Text>
          <Text style={styles.portalSubtitle}>
            {currentUser.full_name} ({currentUser.identifier})
          </Text>
        </View>
        <TouchableOpacity style={styles.logoutBtn} onPress={() => setCurrentUser(null)}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'Catalog' && styles.tabItemActive]}
          onPress={() => setActiveTab('Catalog')}
        >
          <Text style={[styles.tabLabel, activeTab === 'Catalog' && styles.tabLabelActive]}>Catalog</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'My Tickets' && styles.tabItemActive]}
          onPress={() => setActiveTab('My Tickets')}
        >
          <Text style={[styles.tabLabel, activeTab === 'My Tickets' && styles.tabLabelActive]}>
            My Tickets ({tickets.length})
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'Catalog' ? (
        <ScrollView style={styles.contentArea}>
          <View style={styles.searchBar}>
            <Text style={{ color: '#64748b' }}>🔍  Search items or asset codes...</Text>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
            {['All', 'Equipment', 'Audio/Visual', 'Laboratory', 'Access'].map((tag, idx) => (
              <View key={idx} style={[styles.filterChip, idx === 0 && styles.filterChipActive]}>
                <Text style={[styles.filterText, idx === 0 && styles.filterTextActive]}>{tag}</Text>
              </View>
            ))}
          </ScrollView>

          {catalog.map((item) => (
            <View key={item.id} style={styles.itemCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.itemTag}>Tag: {item.asset_code} • {item.category}</Text>
                <Text style={styles.itemAvail}>Available: {item.quantity}</Text>
              </View>
              <TouchableOpacity
                style={styles.borrowBtn}
                onPress={() => {
                  setBorrowModalItem(item);
                  setBorrowQty('1');
                }}
              >
                <Text style={styles.borrowBtnText}>Borrow</Text>
              </TouchableOpacity>
            </View>
          ))}
          <View style={{ height: 60 }} />
        </ScrollView>
      ) : (
        <ScrollView style={styles.contentArea}>
          {tickets.length === 0 ? (
            <Text style={{ color: '#64748b', textAlign: 'center', marginTop: 40 }}>No requests submitted yet.</Text>
          ) : (
            tickets.map((t) => (
              <View key={t.id} style={styles.ticketCard}>
                <View style={styles.ticketHeader}>
                  <Text style={styles.ticketNumber}>Ticket #{t.id}</Text>
                  <View style={[
                    styles.statusBadge,
                    t.status === 'PENDING' && styles.badgePending,
                    t.status === 'APPROVED' && styles.badgeApproved,
                    t.status === 'CLAIMED' && styles.badgeClaimed,
                    t.status === 'RETURNED' && styles.badgeReturned
                  ]}>
                    <Text style={[
                      styles.statusBadgeText,
                      t.status === 'PENDING' && { color: '#f59e0b' },
                      t.status === 'APPROVED' && { color: '#10b981' },
                      t.status === 'CLAIMED' && { color: '#38bdf8' },
                      t.status === 'RETURNED' && { color: '#60a5fa' }
                    ]}>{t.status}</Text>
                  </View>
                </View>

                <Text style={styles.ticketItemName}>{t.item_name}</Text>
                <Text style={styles.ticketDetails}>Quantity: {t.quantity}</Text>
                <Text style={styles.ticketDetails}>Purpose: {t.purpose}</Text>
                <Text style={styles.ticketDetails}>Submitted: {t.created_at || '10/15/2026'}</Text>

                {t.status === 'PENDING' && (
                  <View style={styles.pendingBox}>
                    <Text style={styles.pendingText}>⏳ Pending Admin Review. Pull down to refresh your status.</Text>
                  </View>
                )}

                {t.status === 'APPROVED' && (
                  <View style={styles.approvedBox}>
                    <Text style={styles.approvedHeader}>✓ Request Approved by Admin</Text>
                    <Text style={styles.approvedSub}>Present this pass to the custodian counter to claim your equipment:</Text>
                    <View style={styles.payloadBox}>
                      <Text style={styles.payloadTitle}>CUSTODIAN SCAN PAYLOAD:</Text>
                      <Text style={styles.payloadCode}>TICKET-{t.id}:{t.identifier}:{t.quantity}</Text>
                    </View>
                  </View>
                )}

                {t.status === 'CLAIMED' && (
                  <View style={styles.claimedBox}>
                    <Text style={styles.claimedHeader}>● Equipment Released</Text>
                    <Text style={styles.claimedSub}>This item has been physically released to you. Return it in good condition before the deadline.</Text>
                  </View>
                )}

                {t.status === 'RETURNED' && (
                  <View style={styles.returnedBox}>
                    <Text style={styles.returnedHeader}>✓ Item Returned & Inspected</Text>
                    <Text style={styles.returnedSub}>Returned on: {t.returned_on || '10/15/2026'}</Text>
                    <Text style={styles.auditText}>Condition Audit: {t.condition_audit || 'Good Condition'}</Text>
                  </View>
                )}
              </View>
            ))
          )}
          <View style={{ height: 60 }} />
        </ScrollView>
      )}

      <Modal visible={!!borrowModalItem} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.borrowModalCard}>
            <Text style={styles.borrowModalHeading}>Borrow Equipment</Text>
            <Text style={styles.modalItemTitle}>{borrowModalItem?.name}</Text>
            <Text style={styles.modalInStock}>In Stock: {borrowModalItem?.quantity}</Text>

            <Text style={styles.modalLabel}>Quantity Needed:</Text>
            <TextInput
              style={styles.modalInput}
              keyboardType="number-pad"
              value={borrowQty}
              onChangeText={setBorrowQty}
            />

            <Text style={styles.modalLabel}>Purpose / Activity:</Text>
            <TextInput
              style={styles.modalInput}
              value={borrowPurpose}
              onChangeText={setBorrowPurpose}
            />

            <View style={styles.modalButtonRow}>
              <TouchableOpacity style={styles.cancelModalBtn} onPress={() => setBorrowModalItem(null)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.submitModalBtn} onPress={handleSubmitBorrow} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Submit Request</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showSuccessModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.successDialog}>
            <Text style={styles.dialogHeading}>Success</Text>
            <Text style={styles.dialogText}>Requisition submitted for Admin review.</Text>
            <TouchableOpacity style={styles.successBtn} onPress={() => setShowSuccessModal(false)}>
              <Text style={styles.successBtnText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  authContainer: {
    flex: 1,
    backgroundColor: '#0b1329',
    justifyContent: 'center',
    paddingHorizontal: 24
  },
  headerArea: {
    alignItems: 'center',
    marginBottom: 28
  },
  brandTitle: {
    color: '#10b981',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 1
  },
  brandSubtitle: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 4
  },
  card: {
    backgroundColor: '#121d3a',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1e293b'
  },
  cardTitle: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 20
  },
  input: {
    backgroundColor: '#0a1024',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 8,
    color: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    marginBottom: 12
  },
  primaryButton: {
    backgroundColor: '#10b981',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 15
  },
  switchButton: {
    marginTop: 18,
    alignItems: 'center'
  },
  switchText: {
    color: '#38bdf8',
    fontSize: 13
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24
  },
  activationDialog: {
    backgroundColor: '#262d3d',
    borderRadius: 12,
    padding: 24,
    width: '100%',
    maxWidth: 360
  },
  dialogHeading: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 12
  },
  dialogText: {
    color: '#94a3b8',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16
  },
  stepText: {
    color: '#e2e8f0',
    fontSize: 13,
    lineHeight: 20
  },
  dialogButton: {
    marginTop: 24,
    alignSelf: 'flex-end'
  },
  dialogButtonText: {
    color: '#10b981',
    fontWeight: '700',
    fontSize: 13
  },
  mainContainer: {
    flex: 1,
    backgroundColor: '#0b1329'
  },
  portalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b'
  },
  portalTitle: {
    color: '#10b981',
    fontSize: 16,
    fontWeight: '800'
  },
  portalSubtitle: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2
  },
  logoutBtn: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6
  },
  logoutText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600'
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b'
  },
  tabItem: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center'
  },
  tabItemActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#10b981'
  },
  tabLabel: {
    color: '#64748b',
    fontSize: 14,
    fontWeight: '600'
  },
  tabLabelActive: {
    color: '#10b981'
  },
  contentArea: {
    flex: 1,
    padding: 16
  },
  searchBar: {
    backgroundColor: '#121d3a',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    marginBottom: 14
  },
  filterRow: {
    flexDirection: 'row',
    marginBottom: 16
  },
  filterChip: {
    backgroundColor: '#121d3a',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#1e293b'
  },
  filterChipActive: {
    backgroundColor: '#0a3628',
    borderColor: '#10b981'
  },
  filterText: {
    color: '#94a3b8',
    fontSize: 12
  },
  filterTextActive: {
    color: '#10b981',
    fontWeight: '700'
  },
  itemCard: {
    backgroundColor: '#121d3a',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1e293b'
  },
  itemName: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700'
  },
  itemTag: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 4
  },
  itemAvail: {
    color: '#10b981',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4
  },
  borrowBtn: {
    backgroundColor: '#10b981',
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 8
  },
  borrowBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13
  },
  ticketCard: {
    backgroundColor: '#121d3a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#1e293b'
  },
  ticketHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10
  },
  ticketNumber: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600'
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20
  },
  badgePending: {
    backgroundColor: '#451a03',
    borderColor: '#f59e0b',
    borderWidth: 1
  },
  badgeApproved: {
    backgroundColor: '#064e3b',
    borderColor: '#10b981',
    borderWidth: 1
  },
  badgeClaimed: {
    backgroundColor: '#0c4a6e',
    borderColor: '#38bdf8',
    borderWidth: 1
  },
  badgeReturned: {
    backgroundColor: '#1e3a8a',
    borderColor: '#60a5fa',
    borderWidth: 1
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '800'
  },
  ticketItemName: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 6
  },
  ticketDetails: {
    color: '#94a3b8',
    fontSize: 12,
    marginBottom: 3
  },
  pendingBox: {
    marginTop: 12,
    backgroundColor: '#0a1024',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b'
  },
  pendingText: {
    color: '#94a3b8',
    fontSize: 12
  },
  approvedBox: {
    marginTop: 12,
    backgroundColor: '#042f2e',
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#10b981'
  },
  approvedHeader: {
    color: '#10b981',
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 4
  },
  approvedSub: {
    color: '#94a3b8',
    fontSize: 12,
    marginBottom: 10
  },
  payloadBox: {
    backgroundColor: '#021814',
    borderRadius: 6,
    padding: 10,
    borderWidth: 1,
    borderColor: '#10b981',
    alignItems: 'center'
  },
  payloadTitle: {
    color: '#10b981',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5
  },
  payloadCode: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
    marginTop: 2
  },
  claimedBox: {
    marginTop: 12,
    backgroundColor: '#082f49',
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#0284c7'
  },
  claimedHeader: {
    color: '#38bdf8',
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 4
  },
  claimedSub: {
    color: '#94a3b8',
    fontSize: 12
  },
  returnedBox: {
    marginTop: 12,
    backgroundColor: '#172554',
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2563eb'
  },
  returnedHeader: {
    color: '#60a5fa',
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 4
  },
  returnedSub: {
    color: '#94a3b8',
    fontSize: 12,
    marginBottom: 2
  },
  auditText: {
    color: '#93c5fd',
    fontSize: 12,
    fontWeight: '600'
  },
  borrowModalCard: {
    backgroundColor: '#121d3a',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 380,
    borderWidth: 1,
    borderColor: '#1e293b'
  },
  borrowModalHeading: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4
  },
  modalItemTitle: {
    color: '#38bdf8',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2
  },
  modalInStock: {
    color: '#94a3b8',
    fontSize: 12,
    marginBottom: 16
  },
  modalLabel: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6
  },
  modalInput: {
    backgroundColor: '#0a1024',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 8,
    color: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 14
  },
  modalButtonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8
  },
  cancelModalBtn: {
    backgroundColor: '#1e293b',
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginRight: 8
  },
  cancelText: {
    color: '#ffffff',
    fontWeight: '600'
  },
  submitModalBtn: {
    backgroundColor: '#10b981',
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginLeft: 8
  },
  submitText: {
    color: '#ffffff',
    fontWeight: '700'
  },
  successDialog: {
    backgroundColor: '#262d3d',
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 340
  },
  successBtn: {
    marginTop: 20,
    alignSelf: 'flex-end'
  },
  successBtnText: {
    color: '#10b981',
    fontWeight: '700',
    fontSize: 14
  }
});
