import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '../../db/database.service';
import { users } from '../../db/schema';
import { eq } from 'drizzle-orm';
import * as crypto from 'crypto';

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
    if (!email || !email.includes('@')) {
      throw new BadRequestException('A valid email address is required');
    }

    let user: any;

    if (this.dbService.isConnected && this.dbService.db) {
      const found = await this.dbService.db.select().from(users).where(eq(users.email, email)).limit(1);
      if (found.length > 0) {
        user = found[0];
      } else {
        const newUser = {
          id: email === 'dev@srs-tool.local' ? '00000000-0000-0000-0000-000000000001' : crypto.randomUUID(),
          email,
          plan: 'standard',
          locale: 'vi',
          dailyLimitTokens: 100000,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        await this.dbService.db
          .insert(users)
          .values(newUser)
          .onConflictDoNothing({ target: users.id });
        const reloaded = await this.dbService.db.select().from(users).where(eq(users.email, email)).limit(1);
        user = reloaded[0] ?? newUser;
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
  async handleOAuthCallback(_provider: 'google' | 'github', profile: { email: string; name?: string }) {
    return this.loginDev(profile.email);
  }

  /**
   * Get user profile.
   */
  async getProfile(userId: string) {
    if (this.dbService.isConnected && this.dbService.db) {
      const found = await this.dbService.db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (found.length > 0) return found[0];
    }
    return (
      this.dbService.memUsers.get(userId) || {
        id: userId,
        email: 'dev@srs-tool.local',
        plan: 'standard',
        locale: 'vi',
        dailyLimitTokens: 100000,
      }
    );
  }

  /**
   * Update user settings (restricted strictly to locale 'vi' | 'en').
   */
  async updateProfile(userId: string, data: { locale?: string; plan?: string }) {
    if (data.plan !== undefined) {
      throw new ForbiddenException('Plan tier cannot be modified directly by the user');
    }

    if (data.locale !== undefined && data.locale !== 'vi' && data.locale !== 'en') {
      throw new BadRequestException("Supported locales are 'vi' and 'en'");
    }

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (data.locale) updates['locale'] = data.locale;

    if (this.dbService.isConnected && this.dbService.db) {
      await this.dbService.db.update(users).set(updates).where(eq(users.id, userId));
    } else {
      const memUser = this.dbService.memUsers.get(userId);
      if (memUser) {
        Object.assign(memUser, updates);
      }
    }

    return this.getProfile(userId);
  }

  private getOrSetMemUser(email: string) {
    for (const u of this.dbService.memUsers.values()) {
      if (u.email === email) return u;
    }
    const id = email === 'dev@srs-tool.local' ? '00000000-0000-0000-0000-000000000001' : crypto.randomUUID();
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
