'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { login as serverLogin, logout as serverLogout, getSession, changePassword as serverChangePassword, adminResetPassword as serverAdminResetPassword, getProfileByUsername } from '../../actions/auth';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    initSession();
  }, []);

  const initSession = async () => {
    try {
      const session = await getSession();
      if (session) {
        setUser(session);
        setIsLoggedIn(true);
      }
    } catch (e) {
    } finally {
      setLoading(false);
    }
  };

  const login = useCallback(async ({ username, password }) => {
    const result = await serverLogin(username, password);
    if (result.error) return { error: result.error };
    setUser(result.user);
    setIsLoggedIn(true);
    return { success: true };
  }, []);

  const logout = useCallback(async () => {
    await serverLogout();
    setUser(null);
    setIsLoggedIn(false);
  }, []);

  const changePassword = useCallback(async (username, currentPassword, newPassword) => {
    return serverChangePassword(username, currentPassword, newPassword);
  }, []);

  const adminResetPassword = useCallback(async (username) => {
    return serverAdminResetPassword(username);
  }, []);

  const getUserInfo = useCallback(async (username) => {
    return getProfileByUsername(username);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoggedIn, loading, login, logout, changePassword, adminResetPassword, getUserInfo }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
