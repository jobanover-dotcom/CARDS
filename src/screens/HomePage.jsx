import React from 'react';
import { useAuth } from '../context/AuthContext';
import AdminDashboard from '../components/dashboards/AdminDashboard';
import WarehouseDashboard from '../components/dashboards/WarehouseDashboard';

function HomePage() {
  const { user, logout } = useAuth();

  const getRoleDashboard = () => {
    switch(user.role) {
      case 'Admin':
        return {
          title: 'Admin Dashboard',
          description: 'Manage users, projects, and system settings',
          features: ['User Management', 'Project Oversight', 'Reports & Analytics', 'System Settings']
        };
      case 'Manager':
        return {
          title: 'Manager Dashboard',
          description: 'Manage team and project progress',
          features: ['Team Management', 'Project Tracking', 'Task Assignment', 'Team Reports']
        };
      case 'Supervisor':
        return {
          title: 'Supervisor Dashboard',
          description: 'Oversee daily operations and site activities',
          features: ['Daily Reports', 'Safety Monitoring', 'Work Schedule', 'Issue Tracking']
        };
      case 'Worker':
        return {
          title: 'Worker Dashboard',
          description: 'View assignments and log work hours',
          features: ['My Tasks', 'Time Tracking', 'Safety Checklist', 'Communication']
        };
      case 'Viewer':
        return {
          title: 'Viewer Dashboard',
          description: 'View project information and reports',
          features: ['Project View', 'Reports', 'Timeline', 'Documentation']
        };
      default:
        return {
          title: 'Dashboard',
          description: 'Welcome to your dashboard',
          features: []
        };
    }
  };

  const dashboard = getRoleDashboard();

  if (user.role === 'Admin' || user.role?.includes('Admin') || user.role?.includes('Purchaser')) {
    return <AdminDashboard />;
  }

  if (user.role === 'Warehouse') {
    return <WarehouseDashboard />;
  }

  return (
    <div className="flex flex-col min-h-screen bg-[#f5f7fa]">
      <nav className="bg-gradient-to-br from-[#1e3c72] to-[#2a5298] text-white py-4 px-6 flex justify-between items-center shadow-[0_2px_8px_rgba(0,0,0,0.1)] sticky top-0 z-[100] max-md:flex-col max-md:gap-3 max-md:items-start">
        <div className="flex items-center gap-3 text-xl max-sm:text-base font-bold tracking-wider">
          <img src="/clogo.jpg" alt="CARWILL Logo" className="h-10 w-auto object-contain" />
          <span>CARWILL CONSTRUCTION</span>
        </div>
        <div className="flex items-center gap-5 max-md:w-full max-md:justify-end max-md:gap-3">
          <span className="text-sm max-sm:text-xs text-white/90">{user.email}</span>
          <span className="bg-white/20 py-1.5 px-3 rounded text-[13px] font-semibold uppercase tracking-wider">{user.role}</span>
          <button onClick={logout} className="bg-white/20 text-white border border-white/30 py-2 px-4 rounded cursor-pointer font-semibold text-[13px] transition-all duration-300 hover:bg-white/30 hover:border-white/50">
            Logout
          </button>
        </div>
      </nav>

      <div className="flex-1 py-8 px-6 max-md:py-5 max-md:px-4 max-w-[1200px] mx-auto w-full">
        <div className="mb-10">
          <h1 className="text-[#1e3c72] text-3xl max-md:text-2xl max-sm:text-xl m-0 mb-3 font-bold">{dashboard.title}</h1>
          <p className="text-[#666] text-base max-sm:text-sm m-0">{dashboard.description}</p>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] max-md:grid-cols-1 gap-5">
          {dashboard.features.map((feature, index) => (
            <div key={index} className="bg-white rounded-lg p-6 shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-all duration-300 cursor-pointer border-2 border-transparent hover:-translate-y-1 hover:shadow-[0_8px_20px_rgba(0,0,0,0.12)] hover:border-[#2a5298]">
              <div className="text-4xl mb-3">📋</div>
              <h3 className="text-[#1e3c72] text-lg m-0 mb-2 font-semibold">{feature}</h3>
              <p className="text-[#999] text-sm m-0">Coming soon...</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default HomePage;
