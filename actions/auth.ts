'use server';

import { createServerSupabase, createAdminSupabase } from '@/lib/supabase-server';
import { prisma } from '@/lib/prisma';

const EMAIL_DOMAIN = '@cards.app';

function getAuthErrorMessage(error: unknown): string {
  const status = (error as { status?: number } | null)?.status;
  if (status === 400) return 'Invalid username or password';
  if (!status || status >= 500) {
    return 'Unable to connect to the authentication service. Check your internet connection and try again.';
  }
  if (status === 429) return 'Too many login attempts. Please wait a moment and try again.';
  return (error as { message?: string })?.message ?? 'An unexpected error occurred. Please try again.';
}

export async function getCurrentUser() {
  const supabase = await createServerSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  return prisma.profile.findUnique({ where: { id: session.user.id } });
}

export async function login(username: string, password: string) {
  const supabase = await createServerSupabase();
  const email = username.includes('@') ? username : `${username}${EMAIL_DOMAIN}`;

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: getAuthErrorMessage(error) };

  let profile = null;
  try {
    profile = await prisma.profile.findUnique({ where: { username } });
  } catch {
    await supabase.auth.signOut();
    return { error: 'Database temporarily unavailable. Please try again.' };
  }

  if (!profile) {
    await supabase.auth.signOut();
    return { error: 'Profile not found' };
  }

  const user = { id: profile.id, username: profile.username, name: profile.name, role: profile.role, warehouse: profile.warehouse };

  return { success: true, user };
}

export async function logout() {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  return { success: true };
}

export async function getSession() {
  const supabase = await createServerSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const profile = await prisma.profile.findUnique({ where: { id: session.user.id } });
  if (!profile) return null;

  return { id: profile.id, username: profile.username, name: profile.name, role: profile.role, warehouse: profile.warehouse };
}

export async function changePassword(username: string, currentPassword: string, newPassword: string) {
  const supabase = await createServerSupabase();
  const email = `${username}${EMAIL_DOMAIN}`;

  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
  if (signInError) return { error: 'Current password is incorrect' };

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) return { error: updateError.message };

  return { success: true };
}

export async function adminResetPassword(username: string) {
  const caller = await getCurrentUser();
  if (!caller || (caller.role !== 'Admin' && caller.role !== 'Superadmin')) {
    return { error: 'Unauthorized: only purchasers and superadmins can reset passwords' };
  }

  const profile = await prisma.profile.findUnique({ where: { username } });
  if (!profile) return { error: 'User not found' };

  const supabase = await createAdminSupabase();
  const email = `${username}${EMAIL_DOMAIN}`;

  const { error } = await supabase.auth.admin.updateUserById(profile.id, { password: username });
  if (error) return { error: error.message };

  return { success: true };
}

export async function getProfileByUsername(username: string) {
  return prisma.profile.findUnique({ where: { username } });
}
