'use client';

import {
  LayoutDashboard,
  KanbanSquare,
  ClipboardCheck,
  HeartPulse,
  ListOrdered,
  Stethoscope,
  CalendarDays,
  CalendarClock,
  CalendarPlus,
  FileSignature,
  UploadCloud,
  MapPin,
  Users,
  Building2,
  FileText,
  Wallet,
  Package,
  ShoppingCart,
  TicketPercent,
  PlugZap,
  RefreshCw,
  CheckCheck,
  Megaphone,
  BarChart3,
  UserCog,
  Settings,
  ScrollText,
  MonitorSmartphone,
  Tv,
  Circle,
} from 'lucide-react';

const MAP = {
  LayoutDashboard,
  KanbanSquare,
  ClipboardCheck,
  HeartPulse,
  ListOrdered,
  Stethoscope,
  CalendarDays,
  CalendarClock,
  CalendarPlus,
  FileSignature,
  UploadCloud,
  MapPin,
  Users,
  Building2,
  FileText,
  Wallet,
  Package,
  ShoppingCart,
  TicketPercent,
  PlugZap,
  RefreshCw,
  CheckCheck,
  Megaphone,
  BarChart3,
  UserCog,
  Settings,
  ScrollText,
  MonitorSmartphone,
  Tv,
} as const;

export type IconName = keyof typeof MAP;

export function NavIcon({ name, className }: { name: string; className?: string }) {
  const Component = MAP[name as IconName] ?? Circle;
  return <Component className={className} aria-hidden />;
}
