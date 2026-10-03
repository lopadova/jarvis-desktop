/**
 * Maps the lucide icon *names* used in data (e.g. `Suggestion.icon`) to components.
 * An explicit map keeps the bundle small (no whole-library import); unknown names get a neutral glyph.
 */
import {
  Activity,
  AlarmClock,
  Bell,
  BookUser,
  Brain,
  Bug,
  CalendarDays,
  ChefHat,
  ClipboardList,
  CloudSun,
  Eraser,
  ExternalLink,
  FileSearch,
  FolderSync,
  Globe,
  Hammer,
  Keyboard,
  Languages,
  type LucideIcon,
  type LucideProps,
  Mail,
  Repeat,
  Scale,
  ScanEye,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  SpellCheck,
  Sunrise,
  Timer,
  Users,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  activity: Activity,
  'alarm-clock': AlarmClock,
  bell: Bell,
  'book-user': BookUser,
  brain: Brain,
  bug: Bug,
  'calendar-days': CalendarDays,
  'chef-hat': ChefHat,
  'clipboard-list': ClipboardList,
  'cloud-sun': CloudSun,
  eraser: Eraser,
  'external-link': ExternalLink,
  'file-search': FileSearch,
  'folder-sync': FolderSync,
  globe: Globe,
  hammer: Hammer,
  keyboard: Keyboard,
  languages: Languages,
  mail: Mail,
  repeat: Repeat,
  scale: Scale,
  'scan-eye': ScanEye,
  'shield-check': ShieldCheck,
  'shopping-cart': ShoppingCart,
  'spell-check': SpellCheck,
  sunrise: Sunrise,
  timer: Timer,
  users: Users,
};

export function Icon({ name, ...props }: { name: string } & LucideProps) {
  const C = ICONS[name] ?? Sparkles;
  return <C aria-hidden="true" {...props} />;
}
