import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');
        if (!secret) {
          throw new Error('JWT_SECRET environment variable is required');
        }
        if (secret.length < 32) {
          throw new Error('JWT_SECRET must contain at least 32 characters');
        }
        const issuer = config.get<string>('JWT_ISSUER', 'venue-wrangler-enterprise');
        const audience = config.get<string>('JWT_AUDIENCE', 'venue-wrangler-mobile');
        return {
          secret,
          signOptions: { expiresIn: '8h', issuer, audience, algorithm: 'HS256' },
          verifyOptions: { issuer, audience, algorithms: ['HS256'] },
        };
      },
    }),
  ],
  providers: [AuthGuard, AuthService],
  exports: [AuthGuard, JwtModule, AuthService],
})
export class AuthModule {}
