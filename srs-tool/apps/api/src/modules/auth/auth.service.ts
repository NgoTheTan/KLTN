import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '../../db/database.service';
import { users } from '../../db/schema';
import { eq } from 'drizzle-orm';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly dbService: DatabaseService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Quick development login / token generation.
   */
  async loginDev(email: string = 'dev@srs-tool.local') {
    let user: any;

    if (this.dbService.isConnected && this.dbService.db) {
      try {
        const found = await this.dbService.db.select().from(users).where(eq(users.email, email)).limit(1);
        if (found.length > 0) {
          user = found[0];
        } else {
          const newUser = {
            id: crypto.randomUUID(),
            email,
            plan: 'standard',
            locale: 'vi',
            dailyLimitTokens: 100000,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          await this.dbService.db.insert(users).values(newUser);
          user = newUser;
        }
      } catch {
        user = this.getOrSetMemUser(email);
      }
    } else {
      user = this.getOrSetMemUser(email);
    }

    const payload = { id: user.id, email: user.email, plan: user.plan, locale: user.locale };
    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      user,
    };
  }

  /**
   * OAuth callback handler.
   */
  async handleOAuthCallback(provider: 'google' | 'github', profile: { email: string; name?: string }) {
    return this.loginDev(profile.email);
  }

  /**
   * Get user profile.
   */
  async getProfile(userId: string) {
    if (this.dbService.isConnected && this.dbService.db) {
      try {
        const found = await this.dbService.db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (found.length > 0) return found[0];
      } catch {}
    }
    return this.dbService.memUsers.get(userId) || {
      id: userId,
      email: 'dev@srs-tool.local',
      plan: 'standard',
      locale: 'vi',
      dailyLimitTokens: 100000,
    };
  }

  /**
   * Update user settings (e.g. locale).
   */
  async updateProfile(userId: string, data: { locale?: string; plan?: string }) {
    if (this.dbService.isConnected && this.dbService.db) {
      try {
        await this.dbService.db.update(users).set({ ...data, updatedAt: new Date() }).where(eq(users.id, userId));
      } catch {}
    }
    const memUser = this.dbService.memUsers.get(userId);
    if (memUser) {
      Object.assign(memUser, data);
      memUser.updatedAt = new Date();
    }
    return this.getProfile(userId);
  }

  private getOrSetMemUser(email: string) {
    for (const u of this.dbService.memUsers.values()) {
      if (u.email === email) return u;
    }
    const id = crypto.randomUUID();
    const newUser = {
      id,
      email,
      plan: 'standard',
      locale: 'vi',
      dailyLimitTokens: 100000,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.dbService.memUsers.set(id, newUser);
    return newUser;
  }
}
