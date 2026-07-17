export type UserRole = "admin" | "operator";

export type AppUser = {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
  active: boolean;
  lastAccess?: string | null;
};

export type Brand = {
  id: string;
  qrCode: string;
  name: string;
  local: string;
  active: boolean;
};

export type VisitResult = "delivered" | "closed";

export type VisitRecord = {
  id: string;
  brandId: string;
  operatorId: string;
  result: VisitResult;
  scannedAt: string;
  confirmedAt: string;
  shift: "morning" | "night";
  visitDate: string;
};
