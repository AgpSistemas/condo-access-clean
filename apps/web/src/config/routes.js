import {
  Activity,
  BadgeCheck,
  Building2,
  Car,
  ClipboardList,
  CreditCard,
  Home,
  KeySquare,
  PhoneCall,
  RadioTower,
  ServerCog,
  ShieldCheck,
  UserRound,
  Users
} from "lucide-react";

const sections = [
  { id: "dashboard", label: "Dashboard", icon: Activity },
  { id: "condominiums", label: "Condominios", icon: Building2 },
  { id: "remotePorter", label: "Portaria Remota", icon: PhoneCall },
  { id: "telephony", label: "Ramais", icon: PhoneCall }
];

const condoSections = [
  { id: "syndic", label: "Sindico e Porteiros", icon: ShieldCheck },
  { id: "units", label: "Unidades", icon: Home },
  { id: "residents", label: "Pessoas", icon: UserRound },
  { id: "devices", label: "Equipamentos", icon: RadioTower },
  { id: "credentials", label: "Credenciais", icon: BadgeCheck },
  { id: "permissions", label: "Permissoes", icon: KeySquare },
  { id: "resources", label: "Recursos", icon: ClipboardList },
  { id: "sdk", label: "SDK equipamentos", icon: ServerCog }
];

const settingsSections = [
  { id: "companies", label: "Empresas e planos", icon: Building2 },
  { id: "payments", label: "Pagamentos", icon: CreditCard }
];

const equipmentIntegrationResources = [
  ["events", "Ler eventos", Activity],
  ["credentials", "Buscar credenciais", BadgeCheck],
  ["schedules", "Horarios", ClipboardList],
  ["faces", "Faciais", UserRound],
  ["vehicleTags", "Tags veiculares", Car],
  ["users", "Usuarios", Users]
];

export { sections, condoSections, settingsSections, equipmentIntegrationResources };
