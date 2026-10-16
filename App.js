import React, { useState, useEffect } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  Modal,
  Alert,
  ActivityIndicator,
  StyleSheet,
  StatusBar,
  ScrollView,
  RefreshControl
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';

const BACKEND_URL = 'https://smarttrack-backend-v6l4.onrender.com';

export default function App() {
  // Auth state
  const [currentUser, setCurrentUser] = useState(null);
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'register'
  
  // Credentials & Inputs
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [department, setDepartment] = useState('BSIT');
  const [role, setRole] = useState('Student');
  const [showPassword, setShowPassword] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);

  // Password Recovery Modal
  const [forgotModalVisible, setForgotModalVisible] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [sendingRecovery, setSendingRecovery] = useState(false);

  // App Navigation Tabs
  const [activeTab, setActiveTab] = useState('catalog'); // 'catalog' | 'tickets' | 'profile'

  // Catalog & Inventory
  const [inventory, setInventory] = useState([]);
  // [Requirement 3: Removed Filter Feature - State hook for search/filter removed]
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [borrowModalVisible, setBorrowModalVisible] = useState(false);
  const [borrowQty, setBorrowQty] = useState('1');
  const [borrowPurpose, setBorrowPurpose] = useState('');
  const [submittingBorrow, setSubmittingBorrow] = useState(false);

  // Tickets & Pickup Passes
  const [tickets, setTickets] = useState([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [qrModalVisible, setQrModalVisible] = useState(false);

  useEffect(() => {
    if (currentUser) {
      fetchCatalog();
      fetchMyTickets();
    }
  }, [currentUser]);

  /* ==========================================================================
     AUTHENTICATION HANDLERS
     ========================================================================== */
  const handleLogin = async () => {
    if (!identifier.trim() || !password) {
      Alert.alert('Required Fields', 'Please enter your ID and password.');
      return;
    }
    setAuthLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/borrower/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: identifier.trim(), password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Authentication failed');

      setCurrentUser(data.user);
    } catch (err) {
      Alert.alert('Login Failed', err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!fullName.trim() || !email.trim() || !identifier.trim() || !password) {
      Alert.alert('Required Fields', 'Please complete all required fields.');
      return;
    }
    setAuthLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/borrower/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName.trim(),
          email: email.trim().toLowerCase(),
          identifier: identifier.trim(),
          department: department.trim(),
          role,
          password
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');

      Alert.alert(
        'Registration Complete',
        `Account created successfully. You can now log in with ID ${identifier.trim().toUpperCase()}.`,
        [{ text: 'OK', onPress: () => setAuthMode('login') }]
      );
    } catch (err) {
      Alert.alert('Registration Error', err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!recoveryEmail.trim() || !recoveryEmail.includes('@')) {
      Alert.alert('Invalid Email', 'Please enter a valid official Gmail address.');
      return;
    }
    setSendingRecovery(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/borrower/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: recoveryEmail.trim().toLowerCase() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to dispatch recovery email');

      Alert.alert('Recovery Email Dispatched', data.message);
      setRecoveryEmail('');
      setForgotModalVisible(false);
    } catch (err) {
      Alert.alert('Recovery Error', err.message);
    } finally {
      setSendingRecovery(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to log out of your session?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: () => {
          setCurrentUser(null);
          setIdentifier('');
          setPassword('');
          setShowPassword(false); // Reset password visibility toggle on sign out
          setActiveTab('catalog');
        }
      }
    ]);
  };

  /* ==========================================================================
     CATALOG & REQUISITIONS
     ========================================================================== */
  const fetchCatalog = async () => {
    setCatalogLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/public/inventory`);
      const data = await res.json();
      if (res.ok) setInventory(data);
    } catch (err) {
      console.warn('Catalog fetch error:', err);
    } finally {
      setCatalogLoading(false);
    }
  };

  const openBorrowModal = (item) => {
    setSelectedItem(item);
    setBorrowQty('1');
    setBorrowPurpose('');
    setBorrowModalVisible(true);
  };

  const submitBorrowRequest = async () => {
    const qty = parseInt(borrowQty, 10);
    const available = parseInt(selectedItem?.available_quantity ?? selectedItem?.quantity, 10);

    if (isNaN(qty) || qty < 1) {
      Alert.alert('Invalid Quantity', 'Please request at least 1 unit.');
      return;
    }
    if (qty > available) {
      Alert.alert('Stock Exceeded', `Only ${available} unit(s) currently available.`);
      return;
    }
    if (!borrowPurpose.trim()) {
      Alert.alert('Purpose Required', 'Please specify subject / purpose / room.');
      return;
    }

    setSubmittingBorrow(true);
    try {
      const payload = {
        item_id: selectedItem.id,
        item_name: selectedItem.name,
        quantity: qty,
        requester_name: currentUser.full_name,
        identifier: currentUser.identifier,
        role: currentUser.role || 'Student',
        department: currentUser.department || 'BSIT',
        purpose: borrowPurpose.trim()
      };

      const res = await fetch(`${BACKEND_URL}/api/public/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit borrow request');

      Alert.alert('Ticket Submitted', 'Your requisition ticket has been queued for custodian approval.');
      setBorrowModalVisible(false);
      fetchCatalog();
      fetchMyTickets();
      setActiveTab('tickets');
    } catch (err) {
      Alert.alert('Submission Error', err.message);
    } finally {
      setSubmittingBorrow(false);
    }
  };

  /* ==========================================================================
     TICKETS & QR CLAIM PASS
     ========================================================================== */
  const fetchMyTickets = async () => {
    if (!currentUser?.identifier) return;
    setTicketsLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/public/requests?identifier=${encodeURIComponent(currentUser.identifier)}`);
      const data = await res.json();
      if (res.ok) setTickets(data);
    } catch (err) {
      console.warn('Tickets fetch error:', err);
    } finally {
      setTicketsLoading(false);
    }
  };

  const openQrPass = (ticket) => {
    setSelectedTicket(ticket);
    setQrModalVisible(true);
  };

  // [Requirement 3: Removed Filter Feature - Filtering logic and handlers removed; standard catalog data is served directly]

  /* ==========================================================================
     VIEW: AUTH (LOGIN & REGISTER)
     ========================================================================== */
  if (!currentUser) {
    return (
      <SafeAreaView style={styles.safeContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#060913" />
        <ScrollView contentContainerStyle={styles.authScroll}>
          <View style={styles.authCard}>
            <View style={styles.authHeader}>
              <Text style={styles.brandBadge}>CDM SMARTTRACK</Text>
              <Text style={styles.authTitle}>Borrower Portal</Text>
              <Text style={styles.authSubtitle}>Colegio de Montalban Equipment Requisition</Text>
            </View>

            {/* Toggle Sign In / Register */}
            <View style={styles.authTabs}>
              <TouchableOpacity
                style={[styles.tabBtn, authMode === 'login' && styles.tabBtnActive]}
                onPress={() => setAuthMode('login')}
              >
                <Text style={[styles.tabBtnText, authMode === 'login' && styles.tabBtnTextActive]}>
                  Sign In
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabBtn, authMode === 'register' && styles.tabBtnActive]}
                onPress={() => setAuthMode('register')}
              >
                <Text style={[styles.tabBtnText, authMode === 'register' && styles.tabBtnTextActive]}>
                  Register
                </Text>
              </TouchableOpacity>
            </View>

            {/* Register Fields */}
            {authMode === 'register' && (
              <>
                <Text style={styles.inputLabel}>Full Name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Juan Dela Cruz"
                  placeholderTextColor="#64748b"
                  value={fullName}
                  onChangeText={setFullName}
                />
                <Text style={styles.inputLabel}>Official Gmail Address</Text>
                <TextInput
                  style={styles.input}
                  placeholder="borrower@gmail.com"
                  placeholderTextColor="#64748b"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={email}
                  onChangeText={setEmail}
                />
                <View style={styles.row}>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text style={styles.inputLabel}>Department</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="BSIT"
                      placeholderTextColor="#64748b"
                      value={department}
                      onChangeText={setDepartment}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>Role</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="Student / Faculty"
                      placeholderTextColor="#64748b"
                      value={role}
                      onChangeText={setRole}
                    />
                  </View>
                </View>
              </>
            )}

            {/* Student ID */}
            <Text style={styles.inputLabel}>Student / Employee ID</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 2023-0012"
              placeholderTextColor="#64748b"
              autoCapitalize="characters"
              value={identifier}
              onChangeText={setIdentifier}
            />

            {/* [Requirement 1: Show / Hide Password Feature] */}
            <Text style={styles.inputLabel}>Password</Text>
            <View style={styles.passwordContainer}>
              <TextInput
                style={styles.passwordInput}
                placeholder="••••••••"
                placeholderTextColor="#64748b"
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={setPassword}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="password"
              />
              {/* Interactive Eye Toggle Button */}
              <TouchableOpacity
                style={styles.eyeBtn}
                onPress={() => setShowPassword((prev) => !prev)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
              >
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color="#94a3b8"
                />
              </TouchableOpacity>
            </View>

            {/* [Requirement 2: Forgot Password Option - positioned below password field] */}
            {authMode === 'login' && (
              <TouchableOpacity
                style={styles.forgotBtn}
                onPress={() => setForgotModalVisible(true)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Forgot Password"
              >
                <Text style={styles.forgotText}>Forgot Password?</Text>
              </TouchableOpacity>
            )}

            {/* Action Submit */}
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={authMode === 'login' ? handleLogin : handleRegister}
              disabled={authLoading}
            >
              {authLoading ? (
                <ActivityIndicator color="#022c22" />
              ) : (
                <Text style={styles.primaryBtnText}>
                  {authMode === 'login' ? 'Sign In to Portal' : 'Create Borrower Account'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>

        {/* Forgot Password Modal */}
        <Modal
          visible={forgotModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setForgotModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Password Recovery</Text>
              <Text style={styles.modalSubtitle}>
                Enter your registered official Gmail address. The system will send your ID and temporary password directly to your inbox.
              </Text>

              <TextInput
                style={styles.input}
                placeholder="borrower@gmail.com"
                placeholderTextColor="#64748b"
                keyboardType="email-address"
                autoCapitalize="none"
                value={recoveryEmail}
                onChangeText={setRecoveryEmail}
              />

              <View style={styles.modalBtnRow}>
                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={() => {
                    setForgotModalVisible(false);
                    setRecoveryEmail('');
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.modalConfirmBtn}
                  onPress={handleForgotPassword}
                  disabled={sendingRecovery}
                  activeOpacity={0.7}
                >
                  {sendingRecovery ? (
                    <ActivityIndicator color="#022c22" size="small" />
                  ) : (
                    <Text style={styles.primaryBtnText}>Send Email</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    );
  }

  /* ==========================================================================
     VIEW: MAIN PORTAL TABS
     ========================================================================== */
  return (
    <SafeAreaView style={styles.safeContainer}>
      <StatusBar barStyle="light-content" backgroundColor="#060913" />

      {/* Header */}
      <View style={styles.topBar}>
        <View>
          <Text style={styles.barBadge}>CDM SMARTTRACK</Text>
          <Text style={styles.barTitle}>Borrower Workstation</Text>
        </View>
        <TouchableOpacity style={styles.logoutIconButton} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={20} color="#f87171" />
        </TouchableOpacity>
      </View>

      {/* TAB 1: EQUIPMENT CATALOG */}
      {activeTab === 'catalog' && (
        <View style={styles.tabContent}>
          {/* [Requirement 3: Removed Filter Feature - Search/filter bar removed, displaying standard catalog items] */}
          <FlatList
            data={inventory}
            keyExtractor={(item) => item.id.toString()}
            refreshControl={<RefreshControl refreshing={catalogLoading} onRefresh={fetchCatalog} tintColor="#10b981" />}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons name="cube-outline" size={44} color="#64748b" />
                <Text style={styles.emptyText}>
                  {catalogLoading ? 'Updating catalog...' : 'No equipment available in catalog.'}
                </Text>
              </View>
            }
            renderItem={({ item }) => {
              const available = parseInt(item.available_quantity ?? item.quantity, 10);
              const inStock = available > 0;
              return (
                <View style={styles.itemCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTag}>{item.asset_code || item.asset_tag || 'ASSET-TAG'}</Text>
                    <Text style={styles.itemName}>{item.name}</Text>
                    <Text style={styles.itemCategory}>{item.category || 'General Equipment'}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
                    <View style={[styles.stockBadge, inStock ? styles.stockIn : styles.stockOut]}>
                      <Text style={[styles.stockBadgeText, inStock ? styles.stockInText : styles.stockOutText]}>
                        {inStock ? `${available} Available` : 'Out of Stock'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.requestBtn, !inStock && styles.requestBtnDisabled]}
                      disabled={!inStock}
                      onPress={() => openBorrowModal(item)}
                    >
                      <Text style={styles.requestBtnText}>Borrow</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }}
          />
        </View>
      )}

      {/* TAB 2: MY TICKETS */}
      {activeTab === 'tickets' && (
        <View style={styles.tabContent}>
          <FlatList
            data={tickets}
            keyExtractor={(item) => item.id.toString()}
            refreshControl={<RefreshControl refreshing={ticketsLoading} onRefresh={fetchMyTickets} tintColor="#10b981" />}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons name="receipt-outline" size={44} color="#64748b" />
                <Text style={styles.emptyText}>
                  {ticketsLoading ? 'Fetching requests...' : 'No borrow tickets found.'}
                </Text>
              </View>
            }
            renderItem={({ item }) => {
              const isApproved = item.status === 'APPROVED';
              return (
                <View style={styles.ticketCard}>
                  <View style={styles.ticketHeader}>
                    <Text style={styles.ticketId}>Ticket #{item.id}</Text>
                    <View style={[styles.ticketBadge, styles[`badge_${item.status}`]]}>
                      <Text style={[styles.ticketBadgeText, styles[`badgeText_${item.status}`]]}>
                        {item.status}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.ticketItemName}>{item.item_name} (x{item.quantity})</Text>
                  <Text style={styles.ticketPurpose}>Purpose: {item.purpose || 'Classroom Instruction'}</Text>

                  {/* QR Claim Pass if approved */}
                  {isApproved && (
                    <TouchableOpacity style={styles.qrPassBtn} onPress={() => openQrPass(item)}>
                      <Ionicons name="qr-code-outline" size={16} color="#022c22" style={{ marginRight: 6 }} />
                      <Text style={styles.qrPassBtnText}>Show Pickup QR Pass</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            }}
          />
        </View>
      )}

      {/* TAB 3: BORROWER PROFILE */}
      {activeTab === 'profile' && (
        <ScrollView style={styles.tabContent}>
          <View style={styles.profileCard}>
            <View style={styles.avatarHolder}>
              <Text style={styles.avatarText}>{currentUser.full_name?.charAt(0) || 'U'}</Text>
            </View>
            <Text style={styles.profileName}>{currentUser.full_name}</Text>
            <Text style={styles.profileIdentifier}>{currentUser.identifier}</Text>
            <Text style={styles.profileDept}>{currentUser.department} • {currentUser.role || 'Borrower'}</Text>
            <Text style={styles.profileEmail}>{currentUser.email}</Text>
          </View>

          <View style={styles.infoSection}>
            <Text style={styles.infoTitle}>Custodian Office Guidelines</Text>
            <Text style={styles.infoParagraph}>
              1. Present a valid CDM Student/Faculty ID and the dynamic QR Pass at the Property Custodian counter.
            </Text>
            <Text style={styles.infoParagraph}>
              2. Items must be inspected upon release and returned within official school operational hours.
            </Text>
            <Text style={styles.infoParagraph}>
              3. Damaged or defective items reported on return will be recorded against your student clearance.
            </Text>
          </View>

          <TouchableOpacity style={styles.signOutFullBtn} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={18} color="#fca5a5" style={{ marginRight: 8 }} />
            <Text style={styles.signOutFullText}>Sign Out Account</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* BOTTOM NAVIGATION BAR */}
      <View style={styles.bottomNav}>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setActiveTab('catalog')}
        >
          <Ionicons
            name={activeTab === 'catalog' ? 'grid' : 'grid-outline'}
            size={22}
            color={activeTab === 'catalog' ? '#10b981' : '#94a3b8'}
          />
          <Text style={[styles.navLabel, activeTab === 'catalog' && styles.navLabelActive]}>
            Catalog
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setActiveTab('tickets')}
        >
          <Ionicons
            name={activeTab === 'tickets' ? 'receipt' : 'receipt-outline'}
            size={22}
            color={activeTab === 'tickets' ? '#10b981' : '#94a3b8'}
          />
          <Text style={[styles.navLabel, activeTab === 'tickets' && styles.navLabelActive]}>
            My Tickets
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setActiveTab('profile')}
        >
          <Ionicons
            name={activeTab === 'profile' ? 'person' : 'person-outline'}
            size={22}
            color={activeTab === 'profile' ? '#10b981' : '#94a3b8'}
          />
          <Text style={[styles.navLabel, activeTab === 'profile' && styles.navLabelActive]}>
            Profile
          </Text>
        </TouchableOpacity>
      </View>

      {/* REQUISITION MODAL */}
      <Modal
        visible={borrowModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setBorrowModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Borrow Requisition</Text>
            <Text style={styles.modalSubtitle}>{selectedItem?.name}</Text>

            <Text style={styles.inputLabel}>Quantity</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              value={borrowQty}
              onChangeText={setBorrowQty}
            />

            <Text style={styles.inputLabel}>Subject / Purpose / Room</Text>
            <TextInput
              style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
              multiline
              placeholder="e.g. IT 302 Presentation - Room 402"
              placeholderTextColor="#64748b"
              value={borrowPurpose}
              onChangeText={setBorrowPurpose}
            />

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setBorrowModalVisible(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalConfirmBtn}
                onPress={submitBorrowRequest}
                disabled={submittingBorrow}
              >
                {submittingBorrow ? (
                  <ActivityIndicator color="#022c22" size="small" />
                ) : (
                  <Text style={styles.primaryBtnText}>Submit Ticket</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* QR CLAIM PASS MODAL */}
      <Modal
        visible={qrModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setQrModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { alignItems: 'center' }]}>
            <Text style={styles.modalTitle}>Pickup QR Claim Pass</Text>
            <Text style={styles.modalSubtitle}>Present this at the Property Custodian counter</Text>

            <View style={styles.qrContainer}>
              {selectedTicket && (
                <QRCode
                  value={JSON.stringify({
                    ticket_id: selectedTicket.id,
                    identifier: selectedTicket.identifier,
                    item_id: selectedTicket.item_id,
                    qty: selectedTicket.quantity
                  })}
                  size={180}
                  color="#000000"
                  backgroundColor="#ffffff"
                />
              )}
            </View>

            <Text style={styles.qrItemLabel}>
              Ticket #{selectedTicket?.id} • {selectedTicket?.item_name} (x{selectedTicket?.quantity})
            </Text>

            <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setQrModalVisible(false)}>
              <Text style={styles.modalCancelText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeContainer: {
    flex: 1,
    backgroundColor: '#060913'
  },
  authScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20
  },
  authCard: {
    backgroundColor: '#0f172a',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)'
  },
  authHeader: {
    alignItems: 'center',
    marginBottom: 20
  },
  brandBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    color: '#10b981',
    fontWeight: '900',
    fontSize: 11,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 99,
    marginBottom: 8
  },
  authTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: '#ffffff'
  },
  authSubtitle: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 4
  },
  authTabs: {
    flexDirection: 'row',
    backgroundColor: '#0b111e',
    borderRadius: 12,
    padding: 4,
    marginBottom: 18
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 9
  },
  tabBtnActive: {
    backgroundColor: '#1e293b'
  },
  tabBtnText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '700'
  },
  tabBtnTextActive: {
    color: '#ffffff'
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    marginBottom: 6
  },
  input: {
    backgroundColor: '#0b111e',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#ffffff',
    fontSize: 14,
    marginBottom: 14
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0b111e',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 10,
    marginBottom: 8
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#ffffff',
    fontSize: 14
  },
  eyeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  forgotBtn: {
    alignSelf: 'flex-end',
    marginBottom: 18
  },
  forgotText: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '700'
  },
  primaryBtn: {
    backgroundColor: '#10b981',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center'
  },
  primaryBtnText: {
    color: '#022c22',
    fontWeight: '900',
    fontSize: 14
  },
  row: {
    flexDirection: 'row'
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)'
  },
  barBadge: {
    color: '#10b981',
    fontWeight: '800',
    fontSize: 10,
    letterSpacing: 0.8
  },
  barTitle: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 17
  },
  logoutIconButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.1)'
  },
  tabContent: {
    flex: 1,
    padding: 16
  },
  // [Requirement 3: Removed Filter Feature - Cleaned up searchBarContainer & searchInput styles]
  itemCard: {
    backgroundColor: '#0f172a',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  itemTag: {
    fontFamily: 'monospace',
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '700'
  },
  itemName: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 15,
    marginTop: 2
  },
  itemCategory: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2
  },
  stockBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginBottom: 8
  },
  stockIn: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)'
  },
  stockOut: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)'
  },
  stockBadgeText: {
    fontSize: 10,
    fontWeight: '800'
  },
  stockInText: {
    color: '#6ee7b7'
  },
  stockOutText: {
    color: '#fca5a5'
  },
  requestBtn: {
    backgroundColor: '#10b981',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8
  },
  requestBtnDisabled: {
    backgroundColor: '#334155',
    opacity: 0.6
  },
  requestBtnText: {
    color: '#022c22',
    fontWeight: '800',
    fontSize: 12
  },
  ticketCard: {
    backgroundColor: '#0f172a',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    marginBottom: 12
  },
  ticketHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8
  },
  ticketId: {
    color: '#818cf8',
    fontWeight: '800',
    fontSize: 13
  },
  ticketBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6
  },
  badge_PENDING: { backgroundColor: 'rgba(245, 158, 11, 0.15)' },
  badge_APPROVED: { backgroundColor: 'rgba(16, 185, 129, 0.15)' },
  badge_CLAIMED: { backgroundColor: 'rgba(56, 189, 248, 0.15)' },
  badge_RETURNED: { backgroundColor: 'rgba(129, 140, 248, 0.15)' },
  badge_REJECTED: { backgroundColor: 'rgba(239, 68, 68, 0.15)' },
  ticketBadgeText: { fontSize: 10, fontWeight: '800' },
  badgeText_PENDING: { color: '#fde047' },
  badgeText_APPROVED: { color: '#6ee7b7' },
  badgeText_CLAIMED: { color: '#7dd3fc' },
  badgeText_RETURNED: { color: '#a5b4fc' },
  badgeText_REJECTED: { color: '#fca5a5' },
  ticketItemName: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 15
  },
  ticketPurpose: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 4
  },
  qrPassBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#10b981',
    paddingVertical: 9,
    borderRadius: 8,
    marginTop: 12
  },
  qrPassBtnText: {
    color: '#022c22',
    fontWeight: '800',
    fontSize: 12
  },
  profileCard: {
    backgroundColor: '#0f172a',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 16
  },
  avatarHolder: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12
  },
  avatarText: {
    color: '#10b981',
    fontSize: 26,
    fontWeight: '900'
  },
  profileName: {
    color: '#ffffff',
    fontWeight: '900',
    fontSize: 18
  },
  profileIdentifier: {
    color: '#38bdf8',
    fontFamily: 'monospace',
    fontSize: 13,
    marginTop: 2
  },
  profileDept: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 4
  },
  profileEmail: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 2
  },
  infoSection: {
    backgroundColor: '#0f172a',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    marginBottom: 20
  },
  infoTitle: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 14,
    marginBottom: 8
  },
  infoParagraph: {
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 6
  },
  signOutFullBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.35)',
    marginBottom: 30
  },
  signOutFullText: {
    color: '#fca5a5',
    fontWeight: '800',
    fontSize: 13
  },
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: '#0f172a',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    paddingVertical: 8
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4
  },
  navLabel: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '700',
    marginTop: 3
  },
  navLabelActive: {
    color: '#10b981'
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    padding: 20
  },
  modalCard: {
    backgroundColor: '#0f172a',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)'
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#ffffff'
  },
  modalSubtitle: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 4,
    marginBottom: 16
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#1e293b',
    alignItems: 'center'
  },
  modalCancelText: {
    color: '#94a3b8',
    fontWeight: '700',
    fontSize: 13
  },
  modalConfirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#10b981',
    alignItems: 'center'
  },
  qrContainer: {
    backgroundColor: '#ffffff',
    padding: 16,
    borderRadius: 16,
    marginVertical: 16
  },
  qrItemLabel: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 16,
    textAlign: 'center'
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40
  },
  emptyText: {
    color: '#64748b',
    fontSize: 13,
    marginTop: 10
  }
});