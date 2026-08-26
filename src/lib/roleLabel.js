export function getRoleLabel(user) {
  if (!user) return '';
  if (user.role === 'Superadmin') return 'Superadmin';
  if (user.role === 'Admin') return 'Purchaser (Admin)';
  return user.warehouse || 'Warehouse';
}

export default getRoleLabel;
