'use client';
import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getRoleLabel } from '../../lib/roleLabel';
import { systemReset } from '../../../actions/archive';

function SuperadminSettingsView() {
  const { user, getUserInfo, changePassword } = useAuth();
  const [userInfo, setUserInfo] = useState(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState(null);

  const [showResetModal, setShowResetModal] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState(null);
  const [resetError, setResetError] = useState(null);

  useEffect(() => {
    if (user?.username) {
      getUserInfo(user.username).then(setUserInfo);
    }
  }, [user, getUserInfo]);

  const handlePasswordChange = () => {
    setMessage(null);
    if (!currentPassword || !newPassword || !confirmPassword) {
      setMessage({ type: 'error', text: 'Please fill all password fields' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'New password and confirm password do not match' });
      return;
    }
    if (newPassword.length < 4) {
      setMessage({ type: 'error', text: 'Password must be at least 4 characters' });
      return;
    }
    changePassword(user.username, currentPassword, newPassword).then((result) => {
      if (result && result.error) {
        setMessage({ type: 'error', text: result.error });
      } else {
        setMessage({ type: 'success', text: 'Password changed successfully' });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }
    });
  };

  const handleSystemReset = async () => {
    setResetting(true);
    setResetError(null);
    try {
      const result = await systemReset();
      setResetResult(result);
      setShowResetModal(false);
      setResetConfirmText('');
    } catch (e) {
      setResetError(e.message || 'System reset failed');
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="bg-white rounded-lg p-8 text-left max-w-2xl">
      <h2 className="m-0 text-3xl text-[#333] mb-6 font-bold">Settings</h2>

      <div className="bg-[#f0f8fc] border border-[#7ec8e3]/30 rounded-xl p-6 mb-6">
        <h3 className="m-0 text-lg font-bold text-[#1e3c72] mb-4">Account Information</h3>
        <div className="grid grid-cols-[140px_1fr] gap-y-3 text-sm">
          <span className="text-gray-500 font-semibold">Name:</span>
          <span className="text-[#333] font-medium">{userInfo?.name || '-'}</span>
          <span className="text-gray-500 font-semibold">Username:</span>
          <span className="text-[#333] font-medium">{user?.username || '-'}</span>
          <span className="text-gray-500 font-semibold">Role:</span>
          <span className="text-[#333] font-medium">{getRoleLabel(user) || '-'}</span>
          <span className="text-gray-500 font-semibold">User ID:</span>
          <span className="text-[#333] font-medium">{userInfo?.userId || '-'}</span>
        </div>
      </div>

      {user?.role === 'Superadmin' && (
        <div className="border-2 border-red-300 bg-[#fff5f5] rounded-xl p-6 mb-6">
          <h3 className="m-0 text-lg font-bold text-[#c62828] mb-2">Danger Zone — System Reset</h3>
          <p className="mt-0 mx-0 mb-3 text-[13px] text-[#666] leading-relaxed">
            Clears <strong>all purchase orders and requests</strong> for every warehouse. Each warehouse's data is
            safely stored in the <strong>Archive</strong> beforehand (labelled &quot;Cleared&quot; with the date), and can be restored
            or downloaded from there. Users and warehouses are kept — active warehouses simply start with fresh data.
            Recommended every year or month-end clearing cycle.
          </p>

          {resetResult && (
            <div className="mb-4 px-4 py-2.5 rounded-lg text-[13px] font-medium bg-[#e8f5e9] text-[#2e7d32] border border-[#a5d6a7]">
              System reset complete — archived data of <strong>{resetResult.archived}</strong> warehouse(s); cleared{' '}
              <strong>{resetResult.clearedPOs}</strong> purchase order(s) and <strong>{resetResult.clearedRequests}</strong>{' '}
              request(s). Visit the Archive page to restore or download.
            </div>
          )}
          {resetError && (
            <div className="mb-4 px-4 py-2.5 rounded-lg text-[13px] font-medium bg-[#ffebee] text-[#c62828] border border-[#ef9a9a]">
              {resetError}
            </div>
          )}

          <button
            onClick={() => { setShowResetModal(true); setResetConfirmText(''); }}
            className="px-6 py-2.5 bg-[#d32f2f] text-white rounded-md text-sm font-semibold hover:bg-[#b71c1c] cursor-pointer transition-colors"
          >
            Reset System Data
          </button>
        </div>
      )}

      <div className="border border-gray-200 rounded-xl p-6">
        <h3 className="m-0 text-lg font-bold text-[#1e3c72] mb-4">Change Password</h3>
        {message && (
          <div className={`mb-4 px-4 py-2.5 rounded-lg text-sm font-medium ${
            message.type === 'success'
              ? 'bg-[#e8f5e9] text-[#2e7d32] border border-[#a5d6a7]'
              : 'bg-[#ffebee] text-[#c62828] border border-[#ef9a9a]'
          }`}>
            {message.text}
          </div>
        )}
        <div className="flex flex-col gap-4 max-w-sm">
          <input type="password" placeholder="Current Password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="py-2.5 px-3 border rounded-md text-sm" />
          <input type="password" placeholder="New Password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="py-2.5 px-3 border rounded-md text-sm" />
          <input type="password" placeholder="Confirm New Password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="py-2.5 px-3 border rounded-md text-sm" />
          <button className="self-start px-6 py-2.5 bg-[#0288d1] text-white rounded-md text-sm font-semibold hover:bg-[#0277bd] cursor-pointer" onClick={handlePasswordChange}>
            Save Changes
          </button>
        </div>
      </div>

      {showResetModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] animate-fade-in">
          <div className="bg-white rounded-xl w-full max-w-[440px] shadow-[0_10px_30px_rgba(0,0,0,0.15)] animate-slide-in p-6 text-left">
            <h2 className="m-0 text-lg font-bold text-[#c62828] mb-3">Confirm System Reset</h2>
            <p className="mt-0 mx-0 mb-4 text-[13px] text-[#555] leading-relaxed">
              This will archive and permanently clear <strong>all purchase orders and requests</strong> across all warehouses.
              Archived data remains recoverable via the Archive page. This action cannot be undone for records already overwritten.
            </p>
            <p className="mt-0 mx-0 mb-2 text-xs text-[#888]">Type <strong>RESET</strong> to confirm:</p>
            <input
              type="text"
              value={resetConfirmText}
              onChange={(e) => setResetConfirmText(e.target.value)}
              placeholder="RESET"
              className="w-full py-2.5 px-3 border border-gray-300 rounded-md text-sm mb-5"
              disabled={resetting}
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowResetModal(false)}
                disabled={resetting}
                className="py-2.5 px-5 rounded-md text-sm font-semibold cursor-pointer bg-white text-[#555] border border-[#ccc] hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSystemReset}
                disabled={resetting || resetConfirmText !== 'RESET'}
                className="py-2.5 px-5 rounded-md text-sm font-semibold cursor-pointer bg-[#d32f2f] text-white border-none hover:bg-[#b71c1c] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {resetting ? 'Resetting…' : 'Yes, Reset System'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SuperadminSettingsView;
