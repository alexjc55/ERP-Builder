import {
  LayoutDashboard, Layout, Home, Users, User, UserCog, UserPlus, UserCheck,
  Shield, ShieldCheck, Lock, Key, Settings, SlidersHorizontal, Languages, Globe,
  Database, Table, Table2, Columns3, List, ListChecks, Clipboard, ClipboardList,
  ClipboardCheck, File, FileText, Files, Folder, FolderOpen, FolderTree,
  HardDrive, Inbox, Archive, Package, Box, Boxes, Truck, ShoppingCart,
  ShoppingBag, Store, Tag, Tags, CreditCard, Wallet, DollarSign, Banknote,
  Receipt, Percent, BarChart3, LineChart, PieChart, TrendingUp, Activity, Gauge,
  Target, Calendar, CalendarDays, Clock, Bell, BellRing, Mail, Send,
  MessageSquare, Phone, MapPin, Map, Navigation, Building, Building2, Briefcase,
  Factory, Warehouse, Wrench, Hammer, Cog, Puzzle, Layers, Grid3x3, Bookmark,
  Book, BookOpen, GraduationCap, Award, Star, Heart, Flag, Check, CheckCircle2,
  Circle, CircleDot, XCircle, AlertCircle, AlertTriangle, Info, HelpCircle, Eye,
  Search, Filter, Plus, Minus, Pencil, Trash2, Copy, Save, Download, Upload,
  Share2, Link, ExternalLink, RefreshCw, RotateCw, Power, Zap, Flame, Droplet,
  Sun, Moon, Cloud, Wifi, Cpu, Server, Monitor, Smartphone, Laptop, Printer,
  Camera, Image, Video, Music, Mic, Headphones, Car, Plane, Ship, Bike, Coffee,
  Utensils, Pizza, Gift, Palette, Brush, PenTool, Scissors, Ruler, Calculator,
  Network, GitBranch, Code, Terminal, Bug, Rocket, Lightbulb, Thermometer,
  Stethoscope, Pill, HeartPulse, Leaf, TreePine, Sprout, PawPrint, Contact,
  Newspaper, Megaphone, Trophy, Crown, Gem, Coins, PiggyBank, Landmark, Scale,
  Gavel, FolderKanban, Workflow,
} from "lucide-react";

export type IconComponent = React.ComponentType<{ className?: string }>;

/**
 * Curated registry of selectable icons, keyed by their kebab-case name. The
 * same map drives both the visual icon picker and the sidebar renderer, so any
 * icon a user can pick will also render in the navigation. Keys are searchable
 * text in the picker.
 */
export const ICON_REGISTRY: Record<string, IconComponent> = {
  "layout-dashboard": LayoutDashboard, "layout": Layout, "home": Home,
  "users": Users, "user": User, "user-cog": UserCog, "user-plus": UserPlus,
  "user-check": UserCheck, "shield": Shield, "shield-check": ShieldCheck,
  "lock": Lock, "key": Key, "settings": Settings, "sliders": SlidersHorizontal,
  "languages": Languages, "globe": Globe, "database": Database, "table": Table,
  "table-2": Table2, "columns": Columns3, "list": List, "list-checks": ListChecks,
  "clipboard": Clipboard, "clipboard-list": ClipboardList,
  "clipboard-check": ClipboardCheck, "file": File, "file-text": FileText,
  "files": Files, "folder": Folder, "folder-open": FolderOpen,
  "folder-tree": FolderTree, "hard-drive": HardDrive, "inbox": Inbox,
  "archive": Archive, "package": Package, "box": Box, "boxes": Boxes,
  "truck": Truck, "shopping-cart": ShoppingCart, "shopping-bag": ShoppingBag,
  "store": Store, "tag": Tag, "tags": Tags, "credit-card": CreditCard,
  "wallet": Wallet, "dollar-sign": DollarSign, "banknote": Banknote,
  "receipt": Receipt, "percent": Percent, "bar-chart": BarChart3,
  "line-chart": LineChart, "pie-chart": PieChart, "trending-up": TrendingUp,
  "activity": Activity, "gauge": Gauge, "target": Target, "calendar": Calendar,
  "calendar-days": CalendarDays, "clock": Clock, "bell": Bell,
  "bell-ring": BellRing, "mail": Mail, "send": Send,
  "message-square": MessageSquare, "phone": Phone, "map-pin": MapPin, "map": Map,
  "navigation": Navigation, "building": Building, "building-2": Building2,
  "briefcase": Briefcase, "factory": Factory, "warehouse": Warehouse,
  "wrench": Wrench, "hammer": Hammer, "cog": Cog, "puzzle": Puzzle,
  "layers": Layers, "grid": Grid3x3, "bookmark": Bookmark, "book": Book,
  "book-open": BookOpen, "graduation-cap": GraduationCap, "award": Award,
  "star": Star, "heart": Heart, "flag": Flag, "check": Check,
  "check-circle": CheckCircle2, "circle": Circle, "circle-dot": CircleDot,
  "x-circle": XCircle, "alert-circle": AlertCircle,
  "alert-triangle": AlertTriangle, "info": Info, "help-circle": HelpCircle,
  "eye": Eye, "search": Search, "filter": Filter, "plus": Plus, "minus": Minus,
  "pencil": Pencil, "trash": Trash2, "copy": Copy, "save": Save,
  "download": Download, "upload": Upload, "share": Share2, "link": Link,
  "external-link": ExternalLink, "refresh": RefreshCw, "rotate": RotateCw,
  "power": Power, "zap": Zap, "flame": Flame, "droplet": Droplet, "sun": Sun,
  "moon": Moon, "cloud": Cloud, "wifi": Wifi, "cpu": Cpu, "server": Server,
  "monitor": Monitor, "smartphone": Smartphone, "laptop": Laptop,
  "printer": Printer, "camera": Camera, "image": Image, "video": Video,
  "music": Music, "mic": Mic, "headphones": Headphones, "car": Car,
  "plane": Plane, "ship": Ship, "bike": Bike, "coffee": Coffee,
  "utensils": Utensils, "pizza": Pizza, "gift": Gift, "palette": Palette,
  "brush": Brush, "pen-tool": PenTool, "scissors": Scissors, "ruler": Ruler,
  "calculator": Calculator, "network": Network, "git-branch": GitBranch,
  "code": Code, "terminal": Terminal, "bug": Bug, "rocket": Rocket,
  "lightbulb": Lightbulb, "thermometer": Thermometer, "stethoscope": Stethoscope,
  "pill": Pill, "heart-pulse": HeartPulse, "leaf": Leaf, "tree": TreePine,
  "sprout": Sprout, "paw-print": PawPrint, "contact": Contact,
  "newspaper": Newspaper, "megaphone": Megaphone, "trophy": Trophy,
  "crown": Crown, "gem": Gem, "coins": Coins, "piggy-bank": PiggyBank,
  "landmark": Landmark, "scale": Scale, "gavel": Gavel,
  "folder-kanban": FolderKanban, "workflow": Workflow,
};

export const ICON_NAMES: string[] = Object.keys(ICON_REGISTRY);

/** Resolve a stored icon name to its component, falling back to a default. */
export function getIconComponent(
  name: string | null | undefined,
  fallback: IconComponent = LayoutDashboard,
): IconComponent {
  if (!name) return fallback;
  return ICON_REGISTRY[name] ?? fallback;
}
