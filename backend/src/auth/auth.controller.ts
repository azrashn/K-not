import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

import type { AuthUser, RequestWithContext } from '../common/request-context';
import { notFound } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, Public } from './auth.decorators';
import { AuthService } from './auth.service';

export class LoginDto {
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @MinLength(1) @MaxLength(1024) password!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly prisma: PrismaService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: LoginDto, @Req() req: RequestWithContext) {
    return this.auth.login(body.email, body.password, req.ip ?? 'unknown');
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const u = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!u) throw notFound('User');
    return { id: u.id, email: u.email, display_name: u.displayName, role: u.role };
  }
}
