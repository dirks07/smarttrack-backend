import React, { useState } from 'react';

// --- SUB-COMPONENT 1: THE DASHBOARD CARD ---
function CustodianCard({ onOpenScreen }) {
  return (
    <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0b1329] p-6 text-slate-100 shadow-xl font-sans">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
          Custodian Terminal
        </span>
        <span className="rounded-md border border-slate-700 bg-slate-800/60 px-2.5 py-1 text-[11px] font-bold tracking-wider text-slate-300 uppercase">
          Desktop Counter
        </span>
      </div>

      <h2 className="text-xl font-bold text-white mb-2">
        Physical Dispatch & Return Desk
      </h2>
      <p className="text-sm text-slate-400 leading-relaxed mb-6">
        Open the dedicated counter screen for scanning student IDs, dispatching reserved items, and grading returns.
      </p>

      <div className="rounded-xl border border-slate-800/80 bg-[#070d1e] p-4 space-y-2.5 mb-6 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Database Backend:</span>
          <span className="font-semibold text-emerald-400">Supabase PostgreSQL</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400">API Gateway:</span>
          <span className="font-medium text-slate-200">Render v614</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Role Enforced:</span>
          <span className="font-medium text-slate-200">Admin / Authorized Only</span>
        </div>
      </div>

      <button
        onClick={onOpenScreen}
        className="w-full rounded-xl border border-slate-700 bg-slate-800/80 py-3 px-4 text-center text-sm font-semibold text-white transition-all hover:bg-slate-700 active:scale-[0.99] flex items-center justify-center gap-1.5 shadow-sm"
      >
        Open Custodian Dispatcher Screen &rarr;
      </button>
    </div>
  );
}

// --- SUB-COMPONENT 2: THE DISPATCH TERMINAL SCREEN ---
function CustodianTerminal({ onClose }) {
  const [activeTab, setActiveTab] = useState('queue');
  const [queue, setQueue] = useState([
    {
      id: 4,
      ticketNo: '#4',
      borrowerName: 'dirk shane',
      borrowerId: '23-00689',
      department: 'Student • ICS',
      item: 'Epson Projector EB-X06',
      assetTag: 'CDM-EQ-001',
      category: 'Equipment',
      quantity: 2,
      availableStock: 10,
      purpose: 'presentation',
    },
  ]);

  const [activeTicket, setActiveTicket] = useState(null);
  const [assetTagInput, setAssetTagInput] = useState('');
  const [verifiedAsset, setVerifiedAsset] = useState(null);
  const [releaseQuantity, setReleaseQuantity] = useState('');
  const [borrowerDetails, setBorrowerDetails] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalMessage, setModalMessage] = useState(null);

  const handleProcessTicket = (ticket) => {
    setActiveTicket(ticket);
    setAssetTagInput(ticket.assetTag);
    setVerifiedAsset({
      tag: ticket.assetTag,
      name: ticket.item,
      category: ticket.category,
      availableStock: ticket.availableStock,
      status: 'Available',
    });
    setReleaseQuantity(ticket.quantity.toString());
    setBorrowerDetails(`${ticket.borrowerName} (${ticket.borrowerId})`);
    setActiveTab('dispatch');
  };

  const handleDeleteTicket = (ticketId) => {
    setQueue((prev) => prev.filter((item) => item.id !== ticketId));
  };

  const handleVerifyTag = () => {
    if (!assetTagInput.trim()) return;
    if (assetTagInput.toUpperCase() === 'CDM-EQ-001') {
      setVerifiedAsset({
        tag: 'CDM-EQ-001',
        name: 'Epson Projector EB-X06',
        category: 'Equipment',
        availableStock: 10,
        status: 'Available',
      });
    } else {
      alert('Asset tag not found in inventory.');
    }
  };

  const handleConfirmRelease = async () => {
    if (!verifiedAsset || !releaseQuantity || !borrowerDetails) {
      alert('Please complete all dispatch details.');
      return;
    }

    const qty = parseInt(releaseQuantity, 10);
    if (isNaN(qty) || qty <= 0 || qty > verifiedAsset.availableStock) {
      alert('Invalid release quantity or insufficient stock.');
      return;
    }

    setIsSubmitting(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 600));

      if (activeTicket) {
        setQueue((prev) => prev.filter((item) => item.id !== activeTicket.id));
      }

      setModalMessage(
        `Dispatched ${qty} unit(s) of ${verifiedAsset.name} to ${borrowerDetails}`
      );
    } catch (err) {
      alert('Failed to process dispatch: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetDispatchForm = () => {
    setModalMessage(null);
    setVerifiedAsset(null);
    setActiveTicket(null);
    setAssetTagInput('');
    setReleaseQuantity('');
    setBorrowerDetails('');
    setActiveTab('queue');
  };

  return (
    <div className="w-full max-w-xl mx-auto rounded-3xl bg-[#0b1329] border border-slate-800 text-slate-100 shadow-2xl p-6 font-sans">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-4 mb-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">
            Custodian Terminal
          </h1>
          <p className="text-xs text-slate-400">Physical Dispatch & Return Desk</p>
        </div>
        <button
          onClick={onClose}
          className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 transition"
        >
          &larr; Back to Dashboard
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6 bg-[#070d1e] p-1.5 rounded-2xl border border-slate-800/80">
        <button
          onClick={() => setActiveTab('queue')}
          className={`py-2.5 rounded-xl text-xs font-bold tracking-wide uppercase transition ${
            activeTab === 'queue'
              ? 'bg-[#1e293b] text-emerald-400 shadow'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Ready for Pickup ({queue.length})
        </button>
        <button
          onClick={() => setActiveTab('dispatch')}
          className={`py-2.5 rounded-xl text-xs font-bold tracking-wide uppercase transition ${
            activeTab === 'dispatch'
              ? 'bg-[#1e293b] text-emerald-400 shadow'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Asset Dispatch
        </button>
      </div>

      {activeTab === 'queue' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-slate-400 px-1">
            <span className="font-semibold uppercase tracking-wider">
              Pickup Queue ({queue.length})
            </span>
            <button
              onClick={() =>
                setQueue([
                  {
                    id: 4,
                    ticketNo: '#4',
                    borrowerName: 'dirk shane',
                    borrowerId: '23-00689',
                    department: 'Student • ICS',
                    item: 'Epson Projector EB-X06',
                    assetTag: 'CDM-EQ-001',
                    category: 'Equipment',
                    quantity: 2,
                    availableStock: 10,
                    purpose: 'presentation',
                  },
                ])
              }
              className="text-emerald-400 hover:underline font-semibold"
            >
              Refresh List
            </button>
          </div>

          {queue.length === 0 ? (
            <div className="text-center py-16 text-slate-500 text-sm border border-dashed border-slate-800 rounded-2xl bg-[#070d1e]">
              No approved requests awaiting pickup.
            </div>
          ) : (
            queue.map((req) => (
              <div
                key={req.id}
                className="rounded-2xl border border-slate-800/90 bg-[#070d1e] p-5 shadow-inner"
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h3 className="font-bold text-base text-white capitalize">
                      {req.borrowerName}
                    </h3>
                    <p className="text-xs text-slate-400 font-medium">
                      {req.department}
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-slate-400 bg-slate-800/70 border border-slate-700/60 px-2 py-0.5 rounded-md">
                    {req.ticketNo}
                  </span>
                </div>

                <div className="my-3 space-y-1 text-xs">
                  <p className="text-slate-300">
                    <span className="text-slate-400">Item: </span>
                    <span className="font-semibold text-white">{req.item}</span>{' '}
                    <span className="text-slate-400">(x{req.quantity})</span>
                  </p>
                  <p className="text-slate-400 capitalize">
                    Purpose: {req.purpose}
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-2.5 pt-2">
                  <button
                    onClick={() => handleProcessTicket(req)}
                    className="col-span-2 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition shadow-sm"
                  >
                    Process Dispatch &rarr;
                  </button>
                  <button
                    onClick={() => handleDeleteTicket(req.id)}
                    className="col-span-1 py-2.5 px-3 rounded-xl bg-rose-950/40 border border-rose-800/40 text-rose-300 hover:bg-rose-900/60 font-semibold text-xs transition"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'dispatch' && (
        <div className="space-y-4">
          {activeTicket && (
            <div className="text-center py-2 px-3 rounded-xl bg-emerald-950/40 border border-emerald-800/40 text-xs font-semibold text-emerald-300 tracking-wide">
              Processing Approved Ticket {activeTicket.ticketNo}
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Asset Tag / Barcode
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={assetTagInput}
                onChange={(e) => setAssetTagInput(e.target.value)}
                placeholder="e.g. CDM-EQ-001"
                className="flex-1 rounded-xl bg-[#070d1e] border border-slate-800 px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-slate-600 font-mono"
              />
              <button
                onClick={handleVerifyTag}
                className="px-4 py-2.5 bg-slate-800 border border-slate-700 hover:bg-slate-700 rounded-xl text-xs font-semibold text-white transition"
              >
                Verify Tag
              </button>
            </div>
          </div>

          {verifiedAsset && (
            <div className="rounded-2xl border border-slate-800 bg-[#070d1e] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-950/50 border border-emerald-800/40 px-2 py-0.5 rounded">
                  {verifiedAsset.tag}
                </span>
                <span className="text-[11px] font-bold bg-emerald-500 text-slate-950 px-2.5 py-0.5 rounded-full">
                  {verifiedAsset.status}
                </span>
              </div>
              <div>
                <h4 className="text-base font-bold text-white">
                  {verifiedAsset.name}
                </h4>
                <p className="text-xs text-slate-400">
                  Category: {verifiedAsset.category}
                </p>
                <p className="text-xs text-slate-400">
                  Available in Stock:{' '}
                  <span className="text-white font-semibold">
                    {verifiedAsset.availableStock}
                  </span>
                </p>
              </div>

              <div className="space-y-1 pt-1">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">
                  Quantity to Release
                </label>
                <input
                  type="number"
                  value={releaseQuantity}
                  onChange={(e) => setReleaseQuantity(e.target.value)}
                  className="w-full rounded-xl bg-[#0b1329] border border-slate-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-slate-600 font-bold"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">
                  Borrower Name / Details
                </label>
                <input
                  type="text"
                  value={borrowerDetails}
                  onChange={(e) => setBorrowerDetails(e.target.value)}
                  placeholder="e.g. John Doe (23-12345)"
                  className="w-full rounded-xl bg-[#0b1329] border border-slate-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-slate-600"
                />
              </div>

              <div className="pt-2 space-y-2">
                <button
                  onClick={handleConfirmRelease}
                  disabled={isSubmitting}
                  className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold text-sm transition shadow-lg"
                >
                  {isSubmitting ? 'Communicating...' : 'Confirm Release to Borrower'}
                </button>
                <button
                  onClick={resetDispatchForm}
                  className="w-full py-2 text-center text-xs text-slate-400 hover:text-white transition"
                >
                  Cancel & Reset
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {modalMessage && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-sm rounded-2xl bg-white text-slate-900 p-6 shadow-2xl text-center space-y-4">
            <h3 className="text-lg font-bold">Release Confirmed</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              {modalMessage}
            </p>
            <button
              onClick={resetDispatchForm}
              className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm transition"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- MAIN ADMIN PAGE COMPONENT ---
export default function AdminPage() {
  const [showTerminal, setShowTerminal] = useState(false);

  return (
    <div className="min-h-screen bg-[#070d1e] p-8 text-white">
      <div className="max-w-6xl mx-auto">
        <header className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">Admin Dashboard</h1>
          <p className="text-sm text-slate-400">Inventory & Dispatch Management</p>
        </header>

        <main className="flex justify-center">
          {!showTerminal ? (
            <CustodianCard onOpenScreen={() => setShowTerminal(true)} />
          ) : (
            <CustodianTerminal onClose={() => setShowTerminal(false)} />
          )}
        </main>
      </div>
    </div>
  );
}