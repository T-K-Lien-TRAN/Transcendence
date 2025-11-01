// src/types/user.ts
interface User {
  id: number;
  username: string;
  password: string;
  email: string;
  twofa_secret?: string | null;
}
