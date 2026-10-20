import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  FlatList,
  Modal,
  Alert,
  ActivityIndicator,
  StatusBar,
  SafeAreaView,
  Platform,
} from 'react-native';

const API_BASE_URL = 'https://smarttrack-backend-v6l4.onrender.com';

export default function App() {
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('inventory'); // 'inventory' | 'tickets'

  // Auth form states
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loginId, setLoginId] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [regName, setRegName] = useState('');
  const [regId, setRegId] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regDept, setRegDept] = useState('BSIT');
  const [regPassword, setRegPassword] = useState('');

  // Forgot password modal
  const [forgotModalVisible, setForgotModalVisible] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');

  // UI state
  const [loading, setLoading] = useState(false);
  const [showActivationModal, setShowActivationModal] = useState(false);
  const [activationEmailSent, setActivationEmailSent] = useState('');

  // Data states
  const [inventory, setInventory] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [tickets, setTickets] = useState([]);

  // Borrow Modal state
  const [borrowModalVisible, setBorrowModalVisible] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [borrowQty, setBorrowQty] = useState('1');
  const [borrowPurpose, setBorrowPurpose] = useState('');

  useEffect(() => {
    if (user) {
      fetchInventory();
      fetchTickets();
    }
  }, [user]);

  // SAFE REQUEST HELPER: Handles cold starts and non-JSON responses cleanly
  // SAFE REQUEST HELPER: Handles cold starts and non-JSON responses cleanly
  const safeFetch = async (url, options = {}) => {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
      });

      const contentType = response.headers.get('content-type') || '';
      let data = null;

      if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        const rawText = await response.text();
        throw new Error(
          response.status === 404
            ? 'Endpoint route not found on server (404).'
            : `Server returned non-JSON (${response.status}): ${rawText.slice(0, 100)}`
        );
      }

      if (!response.ok) {
        throw new Error(data?.error || data?.message || `Request failed (${response.status})`);
      }

      return data;
    } catch (err) {
      throw err;
    }
  };

  // ----------------- AUTH HANDLERS -----------------
  const handleLogin = async () => {
    if (!loginId.trim() || !loginPassword.trim()) {
      Alert.alert('Required Fields', 'Please enter your ID and password.');
      return;
    }

    setLoading(true);
    try {
      const data = await safeFetch(`${API_BASE_URL}/api/borrowers/login`, {
        method: 'POST',
        body: JSON.stringify({
          identifier: loginId.trim(),
          password: loginPassword.trim(),
        }),
      });

      setUser(data.user);
    } catch (err) {
      Alert.alert('Sign In Failed', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!regName.trim() || !regId.trim() || !regEmail.trim() || !regPassword.trim()) {
      Alert.alert('Required Fields', 'Please fill in all registration fields.');
      return;
    }

    setLoading(true);
    try {
      await safeFetch(`${API_BASE_URL}/api/borrowers/register`, {
        method: 'POST',
        body: JSON.stringify({
          full_name: regName.trim(),
          identifier: regId.trim(),
          email: regEmail.trim().toLowerCase(),
          department: regDept.trim() || 'BSIT',
          password: regPassword.trim(),
        }),
      });

      setActivationEmailSent(regEmail.trim().toLowerCase());
      setShowActivationModal(true);
    } catch (err) {
      Alert.alert('Registration Notice', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!forgotEmail.trim()) {
      Alert.alert('Required', 'Please enter your registered email address.');
      return;
    }

    setLoading(true);
    try {
      await safeFetch(`${API_BASE_URL}/api/auth/forgot-password`, {
        method: 'POST',
        body: JSON.stringify({ email: forgotEmail.trim().toLowerCase() }),
      });

      Alert.alert('Temporary Password Sent', 'Check your Gmail inbox for your temporary password.');
      setForgotModalVisible(false);
      setForgotEmail('');
    } catch (err) {
      Alert.alert('Reset Failed', err.message);
    } finally {
      setLoading(false);
    }
  };

  // ----------------- DATA HANDLERS -----------------
  const fetchInventory = async () => {
    try {
      const data = await safeFetch(`${API_BASE_URL}/api/public/inventory`);
      const items = Array.isArray(data) ? data : data.items || [];
      setInventory(items);
    } catch (err) {
      console.warn('Inventory fetch error:', err.message);
    }
  };

  const fetchTickets = async () => {
    if (!user) return;
    try {
      const data = await safeFetch(`${API_BASE_URL}/api/public/requests?identifier=${encodeURIComponent(user.identifier)}`);
      const requests = Array.isArray(data) ? data : data.tickets || [];
      setTickets(requests);
    } catch (err) {
      console.warn('Tickets fetch error:', err.message);
    }
  };

  const submitBorrowRequest = async () => {
    if (!selectedItem) return;
    const qty = parseInt(borrowQty, 10);
    if (isNaN(qty) || qty <= 0 || qty > selectedItem.quantity) {
      Alert.alert('Invalid Quantity', `Available items: ${selectedItem.quantity}`);
      return;
    }

    setLoading(true);
    try {
      await safeFetch(`${API_BASE_URL}/api/public/requests`, {
        method: 'POST',
        body: JSON.stringify({
          requester_name: user.full_name,
          identifier: user.identifier,
          item_id: selectedItem.id,
          item_name: selectedItem.name,
          quantity: qty,
          purpose: borrowPurpose.trim() || 'Laboratory Work',
        }),
      });

      Alert.alert('Success', 'Borrow ticket requested successfully!');
      setBorrowModalVisible(false);
      setSelectedItem(null);
      setBorrowPurpose('');
      setBorrowQty('1');
      fetchInventory();
      fetchTickets();
      setActiveTab('tickets');
    } catch (err) {
      Alert.alert('Submission Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const categories = ['All', 'Equipment', 'Laboratory', 'Audio/Visual'];
  const filteredInventory = inventory.filter(item => {
    const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;
    const matchesSearch =
      (item.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.asset_code || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.category || '').toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  // ----------------- AUTH SCREENS -----------------
  if (!user) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" backgroundColor="#0B0F17" />
        <ScrollView contentContainerStyle={styles.authScroll} keyboardShouldPersistTaps="handled">
          <View style={styles.brandHeader}>
            <Text style={styles.brandTitle}>CDM SMARTTRACK</Text>
            <Text style={styles.brandSubtitle}>Colegio de Montalban</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {isRegisterMode ? 'Borrower Registration' : 'Borrower Sign In'}
            </Text>

            {isRegisterMode ? (
              <>
                <Text style={styles.inputLabel}>Full Name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Mae Morales"
                  placeholderTextColor="#484F58"
                  value={regName}
                  onChangeText={setRegName}
                />

                <Text style={styles.inputLabel}>Student / Faculty ID</Text>
                <TextInput
                  style={styles.input}
                  placeholder="2022-00123"
                  placeholderTextColor="#484F58"
                  value={regId}
                  onChangeText={setRegId}
                  autoCapitalize="characters"
                />

                <Text style={styles.inputLabel}>Gmail Address</Text>
                <TextInput
                  style={styles.input}
                  placeholder="student@gmail.com"
                  placeholderTextColor="#484F58"
                  value={regEmail}
                  onChangeText={setRegEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />

                <Text style={styles.inputLabel}>Department</Text>
                <View style={styles.deptRow}>
                  {['BSIT', 'BSBA', 'BSED', 'BSHM'].map(dept => (
                    <TouchableOpacity
                      key={dept}
                      style={[styles.deptChip, regDept === dept && styles.deptChipSelected]}
                      onPress={() => setRegDept(dept)}
                    >
                      <Text style={[styles.deptChipText, regDept === dept && styles.deptChipTextSelected]}>
                        {dept}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.inputLabel}>Password</Text>
                <View style={styles.passwordWrapper}>
                  <TextInput
                    style={styles.passwordInput}
                    placeholder="••••••••"
                    placeholderTextColor="#484F58"
                    secureTextEntry={!showPassword}
                    value={regPassword}
                    onChangeText={setRegPassword}
                  />
                  <TouchableOpacity
                    style={styles.eyeButton}
                    onPress={() => setShowPassword(!showPassword)}
                  >
                    <Text style={styles.eyeIcon}>{showPassword ? '👁' : '👁‍🗨'}</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={[styles.primaryButton, loading && styles.buttonDisabled]}
                  onPress={handleRegister}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Send Activation Email</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.switchButton}
                  onPress={() => setIsRegisterMode(false)}
                >
                  <Text style={styles.switchButtonText}>Already registered? Sign In</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.inputLabel}>Student / Faculty ID</Text>
                <TextInput
                  style={styles.input}
                  placeholder="2022-00123"
                  placeholderTextColor="#484F58"
                  value={loginId}
                  onChangeText={setLoginId}
                  autoCapitalize="characters"
                />

                <Text style={styles.inputLabel}>Password</Text>
                <View style={styles.passwordWrapper}>
                  <TextInput
                    style={styles.passwordInput}
                    placeholder="••••••••"
                    placeholderTextColor="#484F58"
                    secureTextEntry={!showPassword}
                    value={loginPassword}
                    onChangeText={setLoginPassword}
                  />
                  <TouchableOpacity
                    style={styles.eyeButton}
                    onPress={() => setShowPassword(!showPassword)}
                  >
                    <Text style={styles.eyeIcon}>{showPassword ? '👁' : '👁‍🗨'}</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={styles.forgotBtn}
                  onPress={() => setForgotModalVisible(true)}
                >
                  <Text style={styles.forgotBtnText}>Forgot Password?</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.primaryButton, loading && styles.buttonDisabled]}
                  onPress={handleLogin}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Sign In</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.switchButton}
                  onPress={() => setIsRegisterMode(true)}
                >
                  <Text style={styles.switchButtonText}>New Borrower? Register with Gmail &rarr;</Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          {/* FORGOT PASSWORD MODAL */}
          <Modal
            visible={forgotModalVisible}
            transparent
            animationType="fade"
            onRequestClose={() => setForgotModalVisible(false)}
          >
            <View style={styles.modalOverlay}>
              <View style={styles.modalCard}>
                <Text style={styles.modalHeader}>Reset Password</Text>
                <Text style={styles.modalMessage}>
                  Enter your registered Gmail. We will generate and email a temporary password to your inbox.
                </Text>
                <TextInput
                  style={[styles.input, { width: '100%', marginBottom: 14 }]}
                  placeholder="student@gmail.com"
                  placeholderTextColor="#484F58"
                  value={forgotEmail}
                  onChangeText={setForgotEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  style={[styles.modalButton, loading && styles.buttonDisabled]}
                  onPress={handleForgotPassword}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.modalButtonText}>Send Temporary Password</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={() => setForgotModalVisible(false)}
                >
                  <Text style={styles.cancelButtonText}>Back to Sign In</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>

          {/* ACTIVATION CONFIRMATION MODAL */}
          <Modal
            visible={showActivationModal}
            transparent
            animationType="fade"
            onRequestClose={() => setShowActivationModal(false)}
          >
            <View style={styles.modalOverlay}>
              <View style={styles.modalCard}>
                <Text style={styles.modalIcon}>📬</Text>
                <Text style={styles.modalHeader}>Activation Link Sent!</Text>
                <Text style={styles.modalMessage}>We sent an activation link to:</Text>
                <Text style={styles.modalEmail}>{activationEmailSent}</Text>
                <Text style={styles.modalSubMessage}>
                  Please open your Gmail and tap the "Activate My Account" button to complete registration.
                </Text>

                <TouchableOpacity
                  style={styles.modalButton}
                  onPress={() => {
                    setShowActivationModal(false);
                    setIsRegisterMode(false);
                  }}
                >
                  <Text style={styles.modalButtonText}>I Understand, Proceed to Sign In</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ----------------- MAIN APP DASHBOARD -----------------
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0B0F17" />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>CDM SMARTTRACK</Text>
          <Text style={styles.headerSubtitle}>
            {user.full_name} • {user.identifier} ({user.department || 'BSIT'})
          </Text>
        </View>
        <TouchableOpacity style={styles.logoutButton} onPress={() => setUser(null)}>
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      {/* Tab Navigation */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'inventory' && styles.activeTab]}
          onPress={() => {
            setActiveTab('inventory');
            fetchInventory();
          }}
        >
          <Text style={[styles.tabText, activeTab === 'inventory' && styles.activeTabText]}>
            Available Items
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'tickets' && styles.activeTab]}
          onPress={() => {
            setActiveTab('tickets');
            fetchTickets();
          }}
        >
          <Text style={[styles.tabText, activeTab === 'tickets' && styles.activeTabText]}>
            My Requests ({tickets.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Inventory Tab */}
      {activeTab === 'inventory' ? (
        <View style={styles.flexOne}>
          {/* Live Search Bar */}
          <View style={styles.searchContainer}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search by equipment name, code, or category..."
              placeholderTextColor="#484F58"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryBar}>
            {categories.map(cat => (
              <TouchableOpacity
                key={cat}
                style={[styles.categoryTag, selectedCategory === cat && styles.categoryTagActive]}
                onPress={() => setSelectedCategory(cat)}
              >
                <Text style={[styles.categoryText, selectedCategory === cat && styles.categoryTextActive]}>
                  {cat}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <FlatList
            data={filteredInventory}
            keyExtractor={item => item.id.toString()}
            contentContainerStyle={styles.listPadding}
            renderItem={({ item }) => (
              <View style={styles.itemCard}>
                <View style={styles.itemInfo}>
                  <Text style={styles.itemCode}>{item.asset_code}</Text>
                  <Text style={styles.itemName}>{item.name}</Text>
                  <Text style={styles.itemCategory}>{item.category}</Text>
                </View>
                <View style={styles.itemAction}>
                  <Text style={styles.itemQty}>{item.quantity} available</Text>
                  <TouchableOpacity
                    style={[styles.borrowBtn, item.quantity === 0 && styles.buttonDisabled]}
                    disabled={item.quantity === 0}
                    onPress={() => {
                      setSelectedItem(item);
                      setBorrowQty('1');
                      setBorrowPurpose('');
                      setBorrowModalVisible(true);
                    }}
                  >
                    <Text style={styles.borrowBtnText}>
                      {item.quantity === 0 ? 'Out of Stock' : 'Borrow'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
        </View>
      ) : (
        /* Tickets Tab */
        <FlatList
          data={tickets}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={styles.listPadding}
          renderItem={({ item }) => {
            const rawStatus = (item.status || 'PENDING').toUpperCase();
            return (
              <View style={styles.ticketCard}>
                <View style={styles.ticketTopRow}>
                  <Text style={styles.ticketId}>Ticket #{item.id}</Text>
                  <View
                    style={[
                      styles.statusPill,
                      rawStatus === 'APPROVED' && styles.statusApproved,
                      rawStatus === 'CLAIMED' && styles.statusClaimed,
                      rawStatus === 'RETURNED' && styles.statusReturned,
                    ]}
                  >
                    <Text style={styles.statusPillText}>{rawStatus}</Text>
                  </View>
                </View>
                <Text style={styles.ticketItemName}>
                  {item.item_name} ({item.quantity} unit)
                </Text>
                <Text style={styles.ticketPurpose}>Purpose: {item.purpose}</Text>
                <Text style={styles.ticketDate}>Date: {item.created_at}</Text>
              </View>
            );
          }}
        />
      )}

      {/* Borrow Modal */}
      <Modal
        visible={borrowModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setBorrowModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalHeader}>Request Item</Text>
            <Text style={styles.modalSubHeader}>{selectedItem?.name}</Text>

            <Text style={styles.inputLabel}>Quantity</Text>
            <TextInput
              style={styles.input}
              value={borrowQty}
              onChangeText={setBorrowQty}
              keyboardType="numeric"
            />

            <Text style={styles.inputLabel}>Purpose of Borrowing</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="e.g. Capstone laboratory testing"
              placeholderTextColor="#484F58"
              value={borrowPurpose}
              onChangeText={setBorrowPurpose}
              multiline
            />

            <TouchableOpacity
              style={[styles.primaryButton, loading && styles.buttonDisabled]}
              onPress={submitBorrowRequest}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryButtonText}>Submit Borrow Request</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setBorrowModalVisible(false)}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0B0F17',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  flexOne: {
    flex: 1,
  },
  authScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  brandHeader: {
    alignItems: 'center',
    marginBottom: 28,
  },
  brandTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#10B981',
    letterSpacing: 1.5,
  },
  brandSubtitle: {
    fontSize: 13,
    color: '#8B949E',
    marginTop: 4,
  },
  card: {
    backgroundColor: '#161B22',
    borderRadius: 14,
    padding: 22,
    borderWidth: 1,
    borderColor: '#30363D',
  },
  cardTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 18,
    textAlign: 'center',
  },
  inputLabel: {
    color: '#8B949E',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    backgroundColor: '#0D1117',
    borderWidth: 1,
    borderColor: '#30363D',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#FFFFFF',
    fontSize: 15,
  },
  passwordWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0D1117',
    borderWidth: 1,
    borderColor: '#30363D',
    borderRadius: 8,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#FFFFFF',
    fontSize: 15,
  },
  eyeButton: {
    paddingHorizontal: 12,
  },
  eyeIcon: {
    fontSize: 16,
  },
  forgotBtn: {
    alignSelf: 'flex-end',
    marginTop: 8,
  },
  forgotBtnText: {
    color: '#58A6FF',
    fontSize: 12,
    fontWeight: '600',
  },
  deptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  deptChip: {
    flex: 1,
    backgroundColor: '#0D1117',
    borderWidth: 1,
    borderColor: '#30363D',
    borderRadius: 6,
    paddingVertical: 8,
    marginHorizontal: 3,
    alignItems: 'center',
  },
  deptChipSelected: {
    borderColor: '#10B981',
    backgroundColor: '#10B98122',
  },
  deptChipText: {
    color: '#8B949E',
    fontSize: 12,
    fontWeight: '600',
  },
  deptChipTextSelected: {
    color: '#10B981',
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  primaryButton: {
    backgroundColor: '#10B981',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  switchButton: {
    marginTop: 18,
    alignItems: 'center',
  },
  switchButtonText: {
    color: '#58A6FF',
    fontSize: 13,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: '#161B22',
    borderRadius: 14,
    padding: 24,
    borderWidth: 1,
    borderColor: '#30363D',
    alignItems: 'center',
  },
  modalIcon: {
    fontSize: 42,
    marginBottom: 12,
  },
  modalHeader: {
    fontSize: 19,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  modalSubHeader: {
    fontSize: 14,
    color: '#10B981',
    fontWeight: '600',
    marginBottom: 16,
  },
  modalMessage: {
    fontSize: 14,
    color: '#8B949E',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 20,
  },
  modalEmail: {
    fontSize: 15,
    fontWeight: '700',
    color: '#10B981',
    marginBottom: 8,
    textAlign: 'center',
  },
  modalSubMessage: {
    fontSize: 13,
    color: '#8B949E',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 18,
  },
  modalButton: {
    backgroundColor: '#10B981',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    width: '100%',
    alignItems: 'center',
  },
  modalButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  cancelButton: {
    marginTop: 12,
    paddingVertical: 8,
  },
  cancelButtonText: {
    color: '#8B949E',
    fontSize: 14,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#21262D',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#10B981',
    letterSpacing: 1,
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#8B949E',
    marginTop: 2,
  },
  logoutButton: {
    backgroundColor: '#21262D',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  logoutText: {
    color: '#F85149',
    fontSize: 12,
    fontWeight: '600',
  },
  tabContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#21262D',
  },
  tab: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: '#10B981',
  },
  tabText: {
    color: '#8B949E',
    fontSize: 14,
    fontWeight: '600',
  },
  activeTabText: {
    color: '#FFFFFF',
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  searchInput: {
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#30363D',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#FFFFFF',
    fontSize: 14,
  },
  categoryBar: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    maxHeight: 56,
  },
  categoryTag: {
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#30363D',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
  },
  categoryTagActive: {
    backgroundColor: '#10B981',
    borderColor: '#10B981',
  },
  categoryText: {
    color: '#8B949E',
    fontSize: 13,
    fontWeight: '500',
  },
  categoryTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  listPadding: {
    padding: 16,
    paddingBottom: 40,
  },
  itemCard: {
    backgroundColor: '#161B22',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#30363D',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemInfo: {
    flex: 1,
  },
  itemCode: {
    color: '#8B949E',
    fontSize: 11,
    fontWeight: '700',
  },
  itemName: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 2,
  },
  itemCategory: {
    color: '#10B981',
    fontSize: 12,
    marginTop: 2,
  },
  itemAction: {
    alignItems: 'flex-end',
    marginLeft: 12,
  },
  itemQty: {
    color: '#8B949E',
    fontSize: 12,
    marginBottom: 8,
  },
  borrowBtn: {
    backgroundColor: '#10B981',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  borrowBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  ticketCard: {
    backgroundColor: '#161B22',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#30363D',
  },
  ticketTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  ticketId: {
    color: '#58A6FF',
    fontSize: 13,
    fontWeight: '700',
  },
  statusPill: {
    backgroundColor: '#D29922',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusApproved: {
    backgroundColor: '#1F6FEB',
  },
  statusClaimed: {
    backgroundColor: '#10B981',
  },
  statusReturned: {
    backgroundColor: '#8B949E',
  },
  statusPillText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  ticketItemName: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  ticketPurpose: {
    color: '#8B949E',
    fontSize: 13,
    marginTop: 4,
  },
  ticketDate: {
    color: '#484F58',
    fontSize: 11,
    marginTop: 6,
  },
});