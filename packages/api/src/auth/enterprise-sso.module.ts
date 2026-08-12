import { Module } from '@nestjs/common';
import { EnterpriseSsoAdminController } from './enterprise-sso-admin.controller';
import { EnterpriseSsoController } from './enterprise-sso.controller';
import { EnterpriseSsoService } from './enterprise-sso.service';

@Module({
  controllers: [EnterpriseSsoController, EnterpriseSsoAdminController],
  providers: [EnterpriseSsoService],
})
export class EnterpriseSsoModule {}
