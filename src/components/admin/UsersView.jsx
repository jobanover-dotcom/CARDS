'use client';
import React, { useState, useEffect, useMemo } from 'react';
import SearchInput from '../ui/SearchInput';
import EmptyState from '../ui/EmptyState';
import PageSkeleton from '../ui/PageSkeleton';
import TableScrollSentinel from '../ui/TableScrollSentinel';
import { useAdminData } from '../../context/AdminDataContext';
import { useAuth } from '../../context/AuthContext';
import { getUsers } from '../../../actions/users';
import { useInfiniteRows } from '../../hooks/useInfiniteRows';

const ROLE_OPTIONS = [
  { value: 'Warehouse', label: 'Warehouse' },
  { value: 'Admin', label: 'Purchaser (Admin)' },
];

function UsersView() {
  const { warehouses, userVersion, addUser, deleteUser, assignWarehouse, addWarehouse, deleteWarehouse } = useAdminData();
  const { adminResetPassword } = useAuth();
  const [userSearchInput, setUserSearchInput] = useState('');
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserUsername, setNewUserUsername] = useState('');
  const [newUserRole, setNewUserRole] = useState('Warehouse');
  const [newUserWarehouse, setNewUserWarehouse] = useState(warehouses[0] || '');
  const [showAddWarehouseModal, setShowAddWarehouseModal] = useState(false);
  const [newWarehouseName, setNewWarehouseName] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setUserSearchQuery(userSearchInput), 300);
    return () => clearTimeout(t);
  }, [userSearchInput]);

  const queryParams = useMemo(() => ({
    search: userSearchQuery || undefined,
  }), [userSearchQuery]);

  const { rows: filteredUsers, total: totalUsers, initialLoading, loadingMore, hasMore, loadMore } =
    useInfiniteRows(getUsers, queryParams, userVersion);

  const handleAddUser = async () => {
    if (!newUserName || !newUserUsername) {
      alert('Please fill all required fields');
      return;
    }
    if (newUserRole === 'Warehouse' && !newUserWarehouse) {
      alert('Please assign a warehouse');
      return;
    }
    try {
      await addUser({
        name: newUserName,
        username: newUserUsername,
        role: newUserRole,
        warehouse: newUserRole === 'Warehouse' ? newUserWarehouse : null,
      });
      setShowAddUserModal(false);
      setNewUserName('');
      setNewUserUsername('');
      setNewUserRole('Warehouse');
      setNewUserWarehouse(warehouses[0] || '');
    } catch (e) {
      alert('Failed to create user: ' + e.message);
    }
  };

  const handleDeleteUser = async (username) => {
    if (window.confirm('Delete this user and their login access?')) {
      await deleteUser(username);
    }
  };

  const handleResetPassword = async (username) => {
    const result = await adminResetPassword(username);
    if (result.success) {
      alert(`Password reset to "${username}" (username)`);
    }
  };

  const handleAssignWarehouse = async (username, warehouse) => {
    await assignWarehouse(username, warehouse);
  };

  const handleAddWarehouse = async () => {
    const trimmed = newWarehouseName.trim();
    if (!trimmed) { alert('Please enter a warehouse name'); return; }
    const formatted = trimmed.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    if (warehouses.some(w => w.toLowerCase() === formatted.toLowerCase())) {
      alert('Warehouse already exists (case-insensitive check)');
      return;
    }
    await addWarehouse(formatted);
    setNewWarehouseName('');
    setShowAddWarehouseModal(false);
  };

  const handleDeleteWarehouse = async (name) => {
    if (warehouses.length <= 1) { alert('You must have at least one warehouse in the system.'); return; }
    if (window.confirm(`Are you sure you want to delete "${name}"?`)) {
      await deleteWarehouse(name);
    }
  };

  if (initialLoading) {
    return (
      <div className="bg-white rounded-lg p-8">
        <h2 className="m-0 text-3xl text-[#333] mb-4">Users &amp; Warehouses</h2>
        <PageSkeleton statCards={0} />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg p-8">
      <h2 className="m-0 text-3xl text-[#333] mb-4">Users & Warehouses</h2>
      <div className="flex justify-between items-center max-md:flex-col max-md:items-stretch gap-4 mb-6">
        <div className="flex gap-3">
          <button className="bg-white text-[#0288d1] border-2 border-[#7ec8e3] py-2.5 px-5 rounded-md text-sm font-semibold cursor-pointer hover:bg-[#f0f8fc]" onClick={() => setShowAddUserModal(true)}>
            Add User
          </button>
          <button className="bg-white text-[#2e7d32] border-2 border-[#a5d6a7] py-2.5 px-5 rounded-md text-sm font-semibold cursor-pointer hover:bg-[#e8f5e9]" onClick={() => setShowAddWarehouseModal(true)}>
            Add Warehouse
          </button>
        </div>
        <SearchInput placeholder="Search user by name..." value={userSearchInput} onChange={(e) => setUserSearchInput(e.target.value)} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead className="bg-gradient-to-r from-[#e3f2fd] to-[#bbdefb] sticky top-0">
            <tr>
              <th className="p-4 text-left font-bold text-[#1e3c72]">Name</th>
              <th className="p-4 text-left font-bold text-[#1e3c72]">Username</th>
              <th className="p-4 text-left font-bold text-[#1e3c72]">Role</th>
              <th className="p-4 text-left font-bold text-[#1e3c72]">Warehouse</th>
              <th className="p-4 text-left font-bold text-[#1e3c72]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.length > 0 ? (
              <>
                {filteredUsers.map(u => (
                  <tr key={u.id} className="border-b border-gray-200 hover:bg-[#f0f8fc]/50">
                    <td className="p-4 text-[#333]">{u.name}</td>
                    <td className="p-4 text-[#333]">{u.username}</td>
                    <td className="p-4 text-[#333]">{u.role === 'Admin' ? 'Purchaser (Admin)' : 'Warehouse'}</td>
                    <td className="p-4 text-[#333]">{u.warehouse || '-'}</td>
                    <td className="p-4 flex items-center gap-2 flex-wrap">
                      <button className="text-[#f57c00] text-xs border border-[#f57c00] px-2 py-0.5 rounded hover:bg-[#f57c00]/10" onClick={() => handleResetPassword(u.username)}>
                        Reset Password
                      </button>
                      {u.role === 'Warehouse' && (
                        <select value={u.warehouse} onChange={(e) => handleAssignWarehouse(u.username, e.target.value)} className="p-1 border rounded text-xs">
                          {warehouses.map(w => <option key={w} value={w}>{w}</option>)}
                        </select>
                      )}
                      <button className="text-[#d32f2f] text-xs" onClick={() => handleDeleteUser(u.username)}>Delete</button>
                    </td>
                  </tr>
                ))}
                <TableScrollSentinel colSpan={5} onLoadMore={loadMore} isLoadingMore={loadingMore} disabled={!hasMore} />
              </>
            ) : (
              <EmptyState colSpan={5} message="No users found" />
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-right text-xs text-[#999]">Loaded {filteredUsers.length} of {totalUsers} users</p>

      <div className="mt-10 border-t pt-8">
        <h3 className="m-0 text-xl font-bold text-[#1e3c72] mb-4">Active Warehouses List</h3>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
          {warehouses.map(w => (
            <div key={w} className="flex justify-between items-center bg-[#f0f8fc] border border-[#7ec8e3]/30 p-3.5 rounded-lg hover:shadow-sm transition-shadow">
              <span className="text-sm font-semibold text-[#333]">{w}</span>
              <button className="bg-none border-none text-[#d32f2f] hover:text-[#c62828] cursor-pointer text-xs font-semibold" onClick={() => handleDeleteWarehouse(w)}>
                Delete
              </button>
            </div>
          ))}
        </div>
      </div>

      {showAddUserModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] animate-fade-in">
          <div className="bg-white rounded-xl w-full max-w-[500px] p-6 shadow-[0_10px_30px_rgba(0,0,0,0.15)] animate-slide-in">
            <div className="flex justify-between items-center border-b pb-3 mb-4">
              <h2 className="m-0 text-lg font-bold text-[#333]">Add User</h2>
              <button className="bg-none border-none text-2xl cursor-pointer" onClick={() => setShowAddUserModal(false)}>&times;</button>
            </div>
            <div className="flex flex-col gap-4">
              <input type="text" placeholder="Full Name" value={newUserName} onChange={(e) => setNewUserName(e.target.value)} className="py-2.5 px-3 border rounded-md" />
              <input type="text" placeholder="Username" value={newUserUsername} onChange={(e) => setNewUserUsername(e.target.value)} className="py-2.5 px-3 border rounded-md" />
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500 font-semibold">Role</label>
                <select value={newUserRole} onChange={(e) => setNewUserRole(e.target.value)} className="py-2.5 px-3 border rounded-md">
                  {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              {newUserRole === 'Warehouse' && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-500 font-semibold">Assign Warehouse</label>
                  <select value={newUserWarehouse} onChange={(e) => setNewUserWarehouse(e.target.value)} className="py-2.5 px-3 border rounded-md">
                    {warehouses.map(w => <option key={w} value={w}>{w}</option>)}
                  </select>
                </div>
              )}
              <div className="text-xs text-gray-400">
                Default password: <span className="font-mono font-semibold">{newUserUsername || '(username)'}</span>
              </div>
              <div className="flex justify-end gap-2">
                <button className="px-4 py-2 bg-gray-200 rounded" onClick={() => setShowAddUserModal(false)}>Cancel</button>
                <button className="px-4 py-2 bg-[#0288d1] text-white rounded" onClick={handleAddUser}>Add User</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAddWarehouseModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] animate-fade-in">
          <div className="bg-white rounded-xl w-full max-w-[500px] p-6 shadow-[0_10px_30px_rgba(0,0,0,0.15)] animate-slide-in">
            <div className="flex justify-between items-center border-b pb-3 mb-4">
              <h2 className="m-0 text-lg font-bold text-[#333]">Add New Warehouse</h2>
              <button className="bg-none border-none text-2xl cursor-pointer" onClick={() => setShowAddWarehouseModal(false)}>&times;</button>
            </div>
            <div className="flex flex-col gap-4">
              <input type="text" placeholder="Warehouse Name (e.g. Davao Warehouse)" value={newWarehouseName} onChange={(e) => setNewWarehouseName(e.target.value)} className="py-2.5 px-3 border rounded-md" />
              <div className="flex justify-end gap-2">
                <button className="px-4 py-2 bg-gray-200 rounded" onClick={() => setShowAddWarehouseModal(false)}>Cancel</button>
                <button className="px-4 py-2 bg-[#2e7d32] text-white rounded" onClick={handleAddWarehouse}>Add Warehouse</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default UsersView;
