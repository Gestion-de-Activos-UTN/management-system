import { Building2, MapPin, Boxes, Camera } from 'lucide-react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import type { SidebarItem } from '@/components/layout/Sidebar';

// Placeholder routes matching documentation/09-frontend-architecture.md §9.1 —
// pages don't exist yet, add as each modules/<domain> ships.
const navItems: SidebarItem[] = [
  { label: 'Organizations', href: '/organizations', icon: <Building2 size={16} /> },
  { label: 'Offices', href: '/offices', icon: <MapPin size={16} /> },
  { label: 'Assets', href: '/assets', icon: <Boxes size={16} /> },
  { label: 'Snapshots', href: '/snapshots', icon: <Camera size={16} /> },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardShell navItems={navItems}>{children}</DashboardShell>;
}
