'use client';
import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';

function SettingsView() {
  const { user, getUserInfo, changePassword } = useAuth();
  const [userInfo, setUserInfo] = useState(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState(null);

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
    const result = changePassword(user.username, currentPassword, newPassword);
    if (result.error) {
      setMessage({ type: 'error', text: result.error });
    } else {
      setMessage({ type: 'success', text: 'Password changed successfully' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }
  };

  return (
    <div className="bg-white rounded-lg p-8 text-left max-w-2xl">
      <h2 className="m-0 text-3xl text-[#333] mb-6 font-bold">Settings</h2>

      <div className="bg-[#f0f8fc] border border-[#7ec8e3]/30 rounded-xl p-6 mb-8">
        <h3 className="m-0 text-lg font-bold text-[#1e3c72] mb-4">Account Information</h3>
        <div className="grid grid-cols-[140px_1fr] gap-y-3 text-sm">
          <span className="text-gray-500 font-semibold">Name:</span>
          <span className="text-[#333] font-medium">{userInfo?.name || '-'}</span>
          <span className="text-gray-500 font-semibold">Username:</span>
          <span className="text-[#333] font-medium">{user?.username || '-'}</span>
          <span className="text-gray-500 font-semibold">Warehouse:</span>
          <span className="text-[#333] font-medium">{user?.warehouse || '-'}</span>
          <span className="text-gray-500 font-semibold">User ID:</span>
          <span className="text-[#333] font-medium">{userInfo?.userId || '-'}</span>
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

export default SettingsView;
