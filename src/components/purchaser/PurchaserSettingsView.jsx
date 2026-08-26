'use client';
import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getMyPOCount } from '../../../actions/pos';

function PurchaserSettingsView() {
  const { user, getUserInfo, changePassword } = useAuth();
  const [userInfo, setUserInfo] = useState(null);
  const [myPOCount, setMyPOCount] = useState(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState(null);

  useEffect(() => {
    if (user?.username) {
      getUserInfo(user.username).then(setUserInfo);
    }
    getMyPOCount()
      .then(setMyPOCount)
      .catch(() => setMyPOCount(0));
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
          <span className="text-[#333] font-medium">Purchaser</span>
          <span className="text-gray-500 font-semibold">User ID:</span>
          <span className="text-[#333] font-medium">{userInfo?.userId || '-'}</span>
        </div>
      </div>

      <div className="border border-gray-200 rounded-xl p-6 mb-6">
        <h3 className="m-0 text-lg font-bold text-[#1e3c72] mb-4">My Activity</h3>
        <div className="flex items-center gap-4">
          <div className="bg-gradient-to-br from-[#e3f2fd] to-[#bbdefb] border border-[#1e3c72]/20 rounded-xl px-8 py-5 text-center">
            <div className="text-4xl font-extrabold text-[#1e3c72]">{myPOCount ?? '…'}</div>
            <div className="text-xs text-[#666] mt-1">Purchase orders created by you</div>
          </div>
        </div>
      </div>

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
    </div>
  );
}

export default PurchaserSettingsView;
