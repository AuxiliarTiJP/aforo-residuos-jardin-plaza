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
  zone?: string | null;
  floor?: string | null;
  routeOrder?: number | null;
};

export type VisitResult = "delivered" | "closed";
export type CaptureMethod = "qr" | "manual";
export type RouteStatus = "active" | "completed";

export type RouteRun = {
  id: string;
  visitDate: string;
  routeNumber: number;
  status: RouteStatus;
  startedAt: string;
  completedAt?: string | null;
  startedBy: string;
  completedBy?: string | null;
};

export type VisitRecord = {
  id: string;
  routeId: string;
  brandId: string;
  operatorId: string;
  result: VisitResult;
  captureMethod: CaptureMethod;
  scannedAt: string;
  confirmedAt: string;
  visitDate: string;
  observations?: string | null;
  photoPath?: string | null;
};

export type RouteProgressItem = {
  brandId: string;
  result: VisitResult;
};
